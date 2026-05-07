import os
import json
import uuid
import base64
import asyncio
from pathlib import Path
from typing import Optional

import aiohttp
import aiofiles
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

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


@app.post("/api/upload-photo")
async def upload_photo(file: UploadFile = File(...)):
    ext = Path(file.filename or "photo.jpg").suffix or ".jpg"
    file_id = str(uuid.uuid4())
    filename = f"{file_id}{ext}"
    filepath = UPLOADS_DIR / filename

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
                status = data.get("status")
                if status == "completed":
                    return data.get("output", [])
                if status == "failed":
                    raise HTTPException(
                        status_code=500,
                        detail=f"Generation failed: {data.get('error', 'unknown')}",
                    )
            await asyncio.sleep(2)

    raise HTTPException(status_code=504, detail="Generation timed out")


async def download_result(url: str, result_id: str) -> str:
    filename = f"{result_id}.png"
    filepath = RESULTS_DIR / filename
    async with aiohttp.ClientSession() as session:
        async with session.get(url) as resp:
            if resp.status == 200:
                async with aiofiles.open(filepath, "wb") as f:
                    await f.write(await resp.read())
    return filename


@app.post("/api/try-on")
async def try_on(
    model_photo_id: str = Form(...),
    dress_id: Optional[str] = Form(None),
    dress_file: Optional[UploadFile] = File(None),
):
    if not FASHN_API_KEY:
        raise HTTPException(status_code=500, detail="FASHN API key not configured")

    model_path = None
    for f in UPLOADS_DIR.iterdir():
        if f.stem == model_photo_id:
            model_path = f
            break
    if not model_path or not model_path.exists():
        raise HTTPException(status_code=404, detail="Model photo not found")

    if dress_file and dress_file.filename:
        ext = Path(dress_file.filename).suffix or ".jpg"
        dress_path = UPLOADS_DIR / f"dress_{uuid.uuid4()}{ext}"
        async with aiofiles.open(dress_path, "wb") as f:
            await f.write(await dress_file.read())
    elif dress_id:
        catalog = load_catalog()
        dress_item = next((d for d in catalog if d["id"] == dress_id), None)
        if not dress_item:
            raise HTTPException(status_code=404, detail="Dress not found in catalog")
        dress_path = CATALOG_DIR / dress_item["image"]
    else:
        raise HTTPException(status_code=400, detail="Must provide dress_id or dress_file")

    model_b64 = await image_to_base64(model_path)
    product_b64 = await image_to_base64(dress_path)

    prediction_id = await submit_tryon(model_b64, product_b64)
    output_urls = await poll_result(prediction_id)

    if not output_urls:
        raise HTTPException(status_code=500, detail="No output images received")

    result_id = str(uuid.uuid4())
    result_filename = await download_result(output_urls[0], result_id)

    return {
        "result_id": result_id,
        "result_url": f"/results/{result_filename}",
    }


@app.get("/api/health")
async def health():
    return {"status": "ok", "api_key_set": bool(FASHN_API_KEY)}


# Serve frontend static files (must be last)
app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
