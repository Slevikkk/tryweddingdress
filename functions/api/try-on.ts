// =============================================================================
// POST /api/try-on
//
// Body: multipart/form-data
//   - model_photo_id: required, the file_id returned by /api/upload-photo
//   - dress_id:       optional, catalog id
//   - dress_file:     optional, custom dress upload (image/*)
//
// At least one of dress_id / dress_file must be present.
//
// Returns:
//   202 { generation_id, status: "running" }
//
// The endpoint kicks off the FASHN prediction and returns immediately;
// the client polls GET /api/try-on/<id> for completion. This pattern
// keeps each Pages Function under the platform CPU/wall budget no
// matter how slow FASHN is on a given run.
//
// Credit accounting:
//   - Verify >= 1 credit before doing anything expensive.
//   - Insert generation row in 'pending' state.
//   - Deduct 1 credit, referencing the generation row.
//   - On submitTryon failure: refund the credit + mark generation
//     'failed'. On success: status moves to 'running' with the FASHN
//     prediction id stored in fashn_request_id.
// =============================================================================
import type { Env } from "../../lib/env";
import { requireUser } from "../../lib/auth";
import { errorResponse, httpError, HttpError, json } from "../../lib/http";
import {
    getCreditBalance,
    insertCredit,
    insertGeneration,
    updateGeneration,
} from "../../lib/db";
import {
    findUploadKey,
    r2ObjectToDataUrl,
    submitTryon,
} from "../../lib/fashn";

interface CatalogItem {
    id: string;
    name: string;
    name_ru?: string;
    image: string;
    image_url: string;
}

const ALLOWED_DRESS_MIME = new Set([
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/webp",
]);
const MAX_DRESS_BYTES = 10 * 1024 * 1024;

function extFromMime(mime: string): string {
    if (mime === "image/png") return "png";
    if (mime === "image/webp") return "webp";
    return "jpg";
}

async function loadCatalog(request: Request): Promise<CatalogItem[]> {
    // Pages serves /api/catalog.json as a static file from frontend/api/.
    // We fetch via the request's own origin so the same code works on
    // production, preview branches, and `wrangler pages dev`.
    const u = new URL("/api/catalog.json", request.url);
    const resp = await fetch(u.toString(), { cf: { cacheTtl: 60 } });
    if (!resp.ok) {
        return httpError(500, `Catalog unavailable (${resp.status})`);
    }
    return (await resp.json()) as CatalogItem[];
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
    try {
        const user = await requireUser(request, env);

        if (!env.FASHN_API_KEY) {
            return httpError(500, "FASHN API key not configured");
        }

        let form: FormData;
        try {
            form = await request.formData();
        } catch {
            return httpError(400, "Expected multipart/form-data body");
        }

        const modelPhotoId = form.get("model_photo_id");
        if (typeof modelPhotoId !== "string" || !modelPhotoId) {
            return httpError(400, "model_photo_id is required");
        }

        // ----- Resolve the model photo key in R2 -------------------------------
        const modelKey = await findUploadKey(env, user.id, modelPhotoId);
        if (!modelKey) {
            return httpError(404, "Загруженное фото не найдено — попробуйте загрузить ещё раз");
        }

        // ----- Resolve the dress source ---------------------------------------
        // Workers types pretend get() returns string|null but file
        // fields actually come through as File at runtime.
        const dressFile = form.get("dress_file") as unknown as File | string | null;
        const dressId = form.get("dress_id");

        let dressLabelId = "custom";
        let dressLabelName = "Custom upload";
        let dressLabelImageUrl = "";
        let productImage: string;

        if (dressFile instanceof File && dressFile.size > 0) {
            const mime = (dressFile.type || "").toLowerCase();
            if (!ALLOWED_DRESS_MIME.has(mime)) {
                return httpError(415, "Платье должно быть JPG, PNG или WEBP");
            }
            if (dressFile.size > MAX_DRESS_BYTES) {
                return httpError(413, "Файл платья больше 10 МБ");
            }
            const ext = extFromMime(mime);
            const dressKey = `dresses/${user.id}/${crypto.randomUUID()}.${ext}`;
            await env.RESULTS_BUCKET.put(dressKey, dressFile.stream(), {
                httpMetadata: { contentType: mime },
            });
            productImage = await r2ObjectToDataUrl(env, dressKey);
        } else if (typeof dressId === "string" && dressId) {
            const catalog = await loadCatalog(request);
            const dress = catalog.find((d) => d.id === dressId);
            if (!dress) {
                return httpError(404, "Платье не найдено в каталоге");
            }
            dressLabelId = dress.id;
            dressLabelName = dress.name_ru || dress.name;
            dressLabelImageUrl = dress.image_url;
            // Catalog images are public static assets — pass FASHN the URL
            // and skip the base64 detour entirely.
            const u = new URL(dress.image_url, request.url);
            productImage = u.toString();
        } else {
            return httpError(400, "Need dress_id or dress_file");
        }

        // ----- Credit check (cheap fail-fast) ---------------------------------
        const balance = await getCreditBalance(env, user.id);
        if (balance < 1) {
            return httpError(402, "Out of credits");
        }

        // ----- Record + deduct ------------------------------------------------
        const generationId = await insertGeneration(env, {
            userId: user.id,
            dressId: dressLabelId,
            dressName: dressLabelName,
            dressImageUrl: dressLabelImageUrl,
            // input_photo_url left null on purpose — we don't expose
            // /uploads/ publicly, so storing a path here would just be a
            // dead link in the dashboard.
            statusValue: "pending",
        });

        await insertCredit(env, {
            userId: user.id,
            amount: -1,
            reason: "generation",
            referenceId: generationId,
            notes: "Try-on generation request",
        });

        // ----- Submit to FASHN ------------------------------------------------
        let predictionId: string;
        try {
            const modelImage = await r2ObjectToDataUrl(env, modelKey);
            // Ask FASHN for two variants so the user can pick the better
            // one (helps when one render has anatomy glitches like extra
            // limbs). Default prompt nudges away from the worst hallucs.
            predictionId = await submitTryon(env, {
                modelImage,
                productImage,
                numImages: 2,
            });
        } catch (e) {
            // Refund the credit and mark the generation 'failed' so the
            // dashboard reflects the truth.
            const detail = e instanceof HttpError ? e.detail : String(e);
            await insertCredit(env, {
                userId: user.id,
                amount: 1,
                reason: "refund",
                referenceId: generationId,
                notes: `Refund for failed generation: ${detail}`.slice(0, 500),
            });
            await updateGeneration(env, generationId, {
                status: "failed",
                error_message: detail.slice(0, 500),
            });
            if (e instanceof HttpError) return errorResponse(e);
            throw e;
        }

        await updateGeneration(env, generationId, {
            status: "running",
            fashn_request_id: predictionId,
        });

        return json(
            {
                generation_id: generationId,
                status: "running",
                credits_remaining: balance - 1,
            },
            { status: 202 },
        );
    } catch (e) {
        if (e instanceof HttpError) return errorResponse(e);
        throw e;
    }
};
