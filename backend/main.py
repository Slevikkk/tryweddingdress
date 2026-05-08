import os
import json
import uuid
import base64
import asyncio
from pathlib import Path
from typing import Optional

import aiohttp
import aiofiles
from fastapi import Depends, FastAPI, UploadFile, File, Form, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from backend.auth import AuthedUser, require_user
from backend import db

app = FastAPI(title="Wedding Dress Try-On API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

BASE_DIR = Path(__file__).resolve().parent.parent
CATALOG_DIR = BASE_DIR / "catalog"
EXAMPLES_DIR = BASE_DIR / "website_examples"
UPLOADS_DIR = BASE_DIR / "backend" / "uploads"
RESULTS_DIR = BASE_DIR / "backend" / "results"

FASHN_API_URL = "https://api.fashn.ai/v1"
FASHN_API_KEY = os.environ.get("FASHN_API_KEY", "")

UPLOADS_DIR.mkdir(exist_ok=True)
RESULTS_DIR.mkdir(exist_ok=True)

FRONTEND_DIR = BASE_DIR / "frontend"

app.mount("/catalog-images", StaticFiles(directory=str(CATALOG_DIR)), name="catalog-images")
app.mount("/results", StaticFiles(directory=str(RESULTS_DIR)), name="results")
app.mount("/examples", StaticFiles(directory=str(EXAMPLES_DIR)), name="examples")


def load_catalog():
    catalog_file = CATALOG_DIR / "catalog.json"
    with open(catalog_file) as f:
        return json.load(f)


@app.get("/api/catalog")
async def get_catalog():
    catalog = load_catalog()
    for item in catalog:
        item["image_url"] = f"/catalog-images/{item['image']}"
    return catalog


@app.get("/api/examples")
async def get_examples():
    examples = []
    if EXAMPLES_DIR.exists():
        for d in sorted(EXAMPLES_DIR.iterdir()):
            if d.is_dir():
                examples.append({
                    "id": d.name,
                    "before": f"/examples/{d.name}/before.png",
                    "after": f"/examples/{d.name}/after.png",
                    "dress": f"/examples/{d.name}/dress.jpg",
                })
    return examples


def _user_uploads_dir(user_id: str) -> Path:
    """Per-user subfolder under UPLOADS_DIR.

    Keeps photos namespaced so we can:
      a) list a user's uploads without scanning the whole tree, and
      b) clean up easily on account deletion.
    """
    p = UPLOADS_DIR / user_id
    p.mkdir(parents=True, exist_ok=True)
    return p


def _user_results_dir(user_id: str) -> Path:
    p = RESULTS_DIR / user_id
    p.mkdir(parents=True, exist_ok=True)
    return p


@app.post("/api/upload-photo")
async def upload_photo(
    file: UploadFile = File(...),
    user: AuthedUser = Depends(require_user),
):
    ext = Path(file.filename or "photo.jpg").suffix or ".jpg"
    file_id = str(uuid.uuid4())
    filename = f"{file_id}{ext}"
    filepath = _user_uploads_dir(user.id) / filename

    async with aiofiles.open(filepath, "wb") as f:
        content = await file.read()
        await f.write(content)

    return {"file_id": file_id, "filename": filename}


async def image_to_base64(filepath: Path) -> str:
    async with aiofiles.open(filepath, "rb") as f:
        data = await f.read()
    ext = filepath.suffix.lower().lstrip(".")
    if ext == "jpg":
        ext = "jpeg"
    return f"data:image/{ext};base64,{base64.b64encode(data).decode()}"


async def submit_tryon(model_b64: str, product_b64: str) -> str:
    payload = {
        "model_name": "tryon-max",
        "inputs": {
            "product_image": product_b64,
            "model_image": model_b64,
            "generation_mode": "quality",
            "resolution": "1k",
            "output_format": "png",
        },
    }
    headers = {
        "Authorization": f"Bearer {FASHN_API_KEY}",
        "Content-Type": "application/json",
    }
    async with aiohttp.ClientSession() as session:
        async with session.post(
            f"{FASHN_API_URL}/run", json=payload, headers=headers
        ) as resp:
            if resp.status != 200:
                text = await resp.text()
                raise HTTPException(status_code=resp.status, detail=f"FASHN API error: {text}")
            data = await resp.json()
            if data.get("error"):
                raise HTTPException(status_code=500, detail=f"FASHN error: {data['error']}")
            return data["id"]


async def poll_result(prediction_id: str, max_wait: int = 120) -> list[str]:
    headers = {"Authorization": f"Bearer {FASHN_API_KEY}"}
    url = f"{FASHN_API_URL}/status/{prediction_id}"

    async with aiohttp.ClientSession() as session:
        for _ in range(max_wait // 2):
            async with session.get(url, headers=headers) as resp:
                data = await resp.json()
                status_value = data.get("status")
                if status_value == "completed":
                    return data.get("output", [])
                if status_value == "failed":
                    raise HTTPException(
                        status_code=500,
                        detail=f"Generation failed: {data.get('error', 'unknown')}",
                    )
            await asyncio.sleep(2)

    raise HTTPException(status_code=504, detail="Generation timed out")


async def download_result(url: str, user_id: str, result_id: str) -> str:
    """Save the generated image under results/<user_id>/<result_id>.png and
    return the URL path the frontend should fetch.
    """
    filename = f"{result_id}.png"
    filepath = _user_results_dir(user_id) / filename
    async with aiohttp.ClientSession() as session:
        async with session.get(url) as resp:
            if resp.status == 200:
                async with aiofiles.open(filepath, "wb") as f:
                    await f.write(await resp.read())
    return f"/results/{user_id}/{filename}"


def _find_user_upload(user_id: str, file_id: str) -> Optional[Path]:
    user_dir = UPLOADS_DIR / user_id
    if not user_dir.exists():
        return None
    for f in user_dir.iterdir():
        if f.stem == file_id:
            return f
    return None


@app.post("/api/try-on")
async def try_on(
    user: AuthedUser = Depends(require_user),
    model_photo_id: str = Form(...),
    dress_id: Optional[str] = Form(None),
    dress_file: Optional[UploadFile] = File(None),
):
    """Run a try-on for the authenticated user.

    Sequence:
      1. Validate FASHN config and inputs.
      2. Check the user has at least 1 credit.
      3. Insert a `generations` row in 'pending' state.
      4. Deduct 1 credit, referencing the generation row.
      5. Submit to FASHN, poll for completion, download the result.
      6. On success: mark the generation 'completed' with the result URL.
      7. On any failure after step 4: refund the credit and mark the
         generation 'failed' with the error message.
    """
    if not FASHN_API_KEY:
        raise HTTPException(status_code=500, detail="FASHN API key not configured")

    model_path = _find_user_upload(user.id, model_photo_id)
    if not model_path or not model_path.exists():
        raise HTTPException(status_code=404, detail="Model photo not found")

    # Resolve the dress source (catalog item or uploaded file) and capture
    # the metadata we'll write to the generations row.
    dress_path: Path
    dress_label_id: str
    dress_label_name: str
    dress_label_image_url: str

    if dress_file and dress_file.filename:
        ext = Path(dress_file.filename).suffix or ".jpg"
        dress_path = _user_uploads_dir(user.id) / f"dress_{uuid.uuid4()}{ext}"
        async with aiofiles.open(dress_path, "wb") as f:
            await f.write(await dress_file.read())
        dress_label_id = "custom"
        dress_label_name = "Custom upload"
        dress_label_image_url = ""
    elif dress_id:
        catalog = load_catalog()
        dress_item = next((d for d in catalog if d["id"] == dress_id), None)
        if not dress_item:
            raise HTTPException(status_code=404, detail="Dress not found in catalog")
        dress_path = CATALOG_DIR / dress_item["image"]
        dress_label_id = dress_item["id"]
        dress_label_name = dress_item.get("name", dress_item["id"])
        dress_label_image_url = f"/catalog-images/{dress_item['image']}"
    else:
        raise HTTPException(status_code=400, detail="Must provide dress_id or dress_file")

    # 2. Credit check (cheap fail-fast before doing any expensive work).
    balance = await db.get_credit_balance(user.id)
    if balance < 1:
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail="Out of credits",
        )

    # 3. Record the generation in 'pending' state up-front so the UI can
    #    surface it immediately and so we have a stable id to reference
    #    from the credit ledger.
    generation_id = await db.insert_generation(
        user_id=user.id,
        dress_id=dress_label_id,
        dress_name=dress_label_name,
        dress_image_url=dress_label_image_url,
        # input_photo_url left null: we don't expose /uploads via a public
        # static mount, so a stored path here would just be a dead link.
        # The dashboard only renders dress_image_url + result_photo_url.
        input_photo_url=None,
        status_value="pending",
    )

    # 4. Deduct a credit. Single ledger insert; if the user races multiple
    #    requests they may temporarily oversend, but a follow-up balance
    #    check on the next call will make them pay it back. Tightening
    #    this to a transactional spend is W3 work.
    await db.insert_credit(
        user_id=user.id,
        amount=-1,
        reason="generation",
        reference_id=generation_id,
        notes="Try-on generation request",
    )

    # 5. Run the generation. From here, any exception → refund + 'failed'.
    try:
        await db.update_generation(generation_id, status="running")

        model_b64 = await image_to_base64(model_path)
        product_b64 = await image_to_base64(dress_path)

        prediction_id = await submit_tryon(model_b64, product_b64)
        output_urls = await poll_result(prediction_id)
        if not output_urls:
            raise HTTPException(status_code=500, detail="No output images received")

        result_id = str(uuid.uuid4())
        result_url = await download_result(output_urls[0], user.id, result_id)

        await db.update_generation(
            generation_id,
            status="completed",
            result_photo_url=result_url,
            fashn_request_id=prediction_id,
            completed_at="now()",
        )

        return {
            "generation_id": generation_id,
            "result_id": result_id,
            "result_url": result_url,
            "credits_remaining": balance - 1,
        }

    except HTTPException as exc:
        # Refund and record the failure. We re-raise the original error so
        # the client sees the real reason (FASHN error, timeout, etc.).
        await db.insert_credit(
            user_id=user.id,
            amount=1,
            reason="refund",
            reference_id=generation_id,
            notes=f"Refund for failed generation: {exc.detail!s}"[:500],
        )
        await db.update_generation(
            generation_id,
            status="failed",
            error_message=str(exc.detail)[:500],
        )
        raise
    except Exception as exc:
        await db.insert_credit(
            user_id=user.id,
            amount=1,
            reason="refund",
            reference_id=generation_id,
            notes=f"Refund for unexpected error: {exc!s}"[:500],
        )
        await db.update_generation(
            generation_id,
            status="failed",
            error_message=str(exc)[:500],
        )
        raise HTTPException(status_code=500, detail=f"Generation failed: {exc}")


@app.get("/api/health")
async def health():
    return {"status": "ok", "api_key_set": bool(FASHN_API_KEY)}


# Serve frontend static files (must be last)
app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
