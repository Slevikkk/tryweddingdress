// =============================================================================
// FASHN AI client + R2 upload helper.
//
// Architecture differs from backend/main.py: instead of doing one long
// request that polls until completion, we expose two ops:
//   - submitTryon(): kicks off the prediction, returns prediction id
//   - fetchPrediction(): returns current status; called per browser poll
//
// This keeps individual Pages Function invocations short (well under the
// platform CPU/wall limits) regardless of how long FASHN actually takes.
// =============================================================================
import type { Env } from "./env";
import { httpError } from "./http";

const FASHN_API_URL = "https://api.fashn.ai/v1";

function authHeaders(env: Env): Record<string, string> {
    if (!env.FASHN_API_KEY) {
        return httpError(500, "FASHN API key not configured");
    }
    return {
        Authorization: `Bearer ${env.FASHN_API_KEY}`,
        "Content-Type": "application/json",
    };
}

export interface SubmitTryonArgs {
    /** Either a publicly fetchable URL or a `data:image/...;base64,...` string. */
    modelImage: string;
    productImage: string;
    /** Optional natural-language hint passed to FASHN to steer styling
     *  (e.g. "tuck in shirt", "open jacket"). Default "" lets FASHN use
     *  its own heuristics. */
    prompt?: string;
    /** How many variants to generate in one prediction. tryon-max
     *  accepts 1-4. Sent as `num_images` on the wire. */
    numImages?: number;
}

/** Returns the FASHN prediction id. */
export async function submitTryon(env: Env, args: SubmitTryonArgs): Promise<string> {
    const numImages = Math.max(1, Math.min(4, args.numImages ?? 1));
    const inputs: Record<string, unknown> = {
        product_image: args.productImage,
        model_image: args.modelImage,
        generation_mode: "quality",
        output_format: "png",
        return_base64: false,
        num_images: numImages,
        // Bump resolution from FASHN's default 1k to 2k. Costs slightly
        // more credits on FASHN's side but sharpens details (face,
        // lace, beading) noticeably.
        resolution: "2k",
    };
    // FASHN's prompt field is for styling adjustments ("tuck in shirt",
    // "open jacket"), not anatomy hints. Only forward it when the caller
    // has something meaningful to say so we don't override the default.
    if (args.prompt && args.prompt.trim()) {
        inputs.prompt = args.prompt;
    }
    const payload: Record<string, unknown> = {
        model_name: "tryon-max",
        inputs,
    };
    const resp = await fetch(`${FASHN_API_URL}/run`, {
        method: "POST",
        headers: authHeaders(env),
        body: JSON.stringify(payload),
    });
    const text = await resp.text();
    if (resp.status >= 400) {
        return httpError(502, `FASHN error (${resp.status}): ${text.slice(0, 300)}`);
    }
    const data = JSON.parse(text) as { id?: string };
    if (!data.id) return httpError(502, "FASHN /run did not return an id");
    return data.id;
}

export type PredictionStatus = "starting" | "in_queue" | "processing" | "completed" | "failed";

export interface PredictionResult {
    status: PredictionStatus | string;
    output: string[]; // CDN URLs of result images
    error: { name?: string; message?: string } | null;
}

export async function fetchPrediction(env: Env, predictionId: string): Promise<PredictionResult> {
    const resp = await fetch(`${FASHN_API_URL}/status/${encodeURIComponent(predictionId)}`, {
        headers: authHeaders(env),
    });
    const text = await resp.text();
    if (resp.status >= 400) {
        return httpError(502, `FASHN status error (${resp.status}): ${text.slice(0, 200)}`);
    }
    const data = JSON.parse(text) as { status?: string; output?: string[]; error?: unknown };
    return {
        status: data.status || "unknown",
        output: Array.isArray(data.output) ? data.output : [],
        error: (data.error as PredictionResult["error"]) ?? null,
    };
}

/**
 * Read an R2 object and return a `data:image/...;base64,...` string suitable
 * to pass to FASHN as either model_image or product_image.
 *
 * Workers / Pages Functions don't expose Buffer; we use the standard
 * btoa() pathway (atob/btoa work on binary strings only) by going through
 * Uint8Array → ascii string.
 */
export async function r2ObjectToDataUrl(
    env: Env,
    key: string,
): Promise<string> {
    const obj = await env.RESULTS_BUCKET.get(key);
    if (!obj) {
        return httpError(404, `R2 object missing: ${key}`);
    }
    const buf = await obj.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let binary = "";
    // Chunked to avoid blowing the call stack on big files. 32k chars
    // is well within argument limits and keeps memory flat.
    const CHUNK = 32 * 1024;
    for (let i = 0; i < bytes.length; i += CHUNK) {
        binary += String.fromCharCode.apply(
            null,
            Array.from(bytes.subarray(i, i + CHUNK)),
        );
    }
    const b64 = btoa(binary);
    const mime = obj.httpMetadata?.contentType || "image/jpeg";
    return `data:${mime};base64,${b64}`;
}

/**
 * Find the R2 key for a previously uploaded photo by file_id, regardless
 * of the extension we recorded on upload. Returns null if no match.
 */
export async function findUploadKey(
    env: Env,
    userId: string,
    fileId: string,
): Promise<string | null> {
    const list = await env.RESULTS_BUCKET.list({
        prefix: `uploads/${userId}/${fileId}.`,
        limit: 5,
    });
    if (!list.objects.length) return null;
    return list.objects[0].key;
}

/**
 * Pull a FASHN result image and persist to R2. Returns the public path the
 * frontend should fetch (`/results/<key>`).
 *
 * When `variantIndex` is provided we suffix the key (`..._0.png`,
 * `..._1.png`) so multi-sample generations don't clobber each other.
 * Falling back to the unsuffixed key keeps single-sample callers and
 * older rows compatible.
 */
export async function downloadResultToR2(
    env: Env,
    args: { url: string; userId: string; generationId: string; variantIndex?: number },
): Promise<string> {
    const resp = await fetch(args.url);
    if (!resp.ok || !resp.body) {
        return httpError(502, `Failed to download FASHN result (${resp.status})`);
    }
    const contentType = resp.headers.get("content-type") || "image/png";
    // Namespace under `results/` so the bucket can also hold `uploads/`
    // and `dresses/` from the upload-photo / custom-dress paths without
    // a key collision.
    const suffix = typeof args.variantIndex === "number" ? `_${args.variantIndex}` : "";
    const key = `results/${args.userId}/${args.generationId}${suffix}.png`;
    await env.RESULTS_BUCKET.put(key, resp.body, {
        httpMetadata: { contentType },
    });
    return `/${key}`;
}
