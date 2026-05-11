// =============================================================================
// GET /api/try-on/<generation_id>
//
// Returns the current status of a generation. The frontend polls this
// every ~2s after starting a try-on via POST /api/try-on.
//
// Status transitions:
//   pending  → never seen here (POST /api/try-on flips to running before
//              returning 202).
//   running  → query FASHN /status/<prediction_id>:
//                processing/in_queue/starting → return { status: "running" }
//                completed                    → download all variants to R2,
//                                              mark 'completed', return
//                                              result_url + result_urls
//                failed                       → refund credit, mark
//                                              'failed', return error
//   completed → return cached result_photo_url (+ derived result_urls)
//   failed   → return cached error_message
//
// POST /api/try-on/<generation_id>
//
// Body: { variant_index: number }
//
// Lets the user pick which of the multi-sample variants becomes the
// "canonical" result (i.e. what shows up in the dashboard / gallery).
// We don't move bytes around — both variants stay in R2 under
// `results/<user>/<gen>_{0,1}.png`; we just flip `result_photo_url`.
//
// Auth: required + ownership check.
// =============================================================================
import type { Env } from "../../../lib/env";
import { requireUser } from "../../../lib/auth";
import { errorResponse, httpError, HttpError, json } from "../../../lib/http";
import {
    getGeneration,
    insertCredit,
    updateGeneration,
} from "../../../lib/db";
import {
    downloadResultToR2,
    fetchPrediction,
} from "../../../lib/fashn";

interface PollResponse {
    status: "running" | "completed" | "failed";
    result_url?: string;
    result_urls?: string[];
    error?: string;
}

// How many variants we ask FASHN for per generation. Kept here so the
// "list cached variants for a completed row" branch below doesn't have
// to scan R2 — the keys are deterministic.
const VARIANT_COUNT = 2;

function variantKeyPath(userId: string, generationId: string, idx: number): string {
    return `/results/${userId}/${generationId}_${idx}.png`;
}

export const onRequestGet: PagesFunction<Env, "id"> = async ({
    request,
    env,
    params,
}) => {
    try {
        const user = await requireUser(request, env);

        const id = typeof params.id === "string" ? params.id : "";
        if (!id) {
            return httpError(400, "Generation id is required");
        }

        const row = await getGeneration(env, id);
        if (!row) {
            return httpError(404, "Generation not found");
        }
        if (row.user_id !== user.id) {
            // Don't leak ownership: 404 looks the same as a missing row.
            return httpError(404, "Generation not found");
        }

        // Already-finished cases: return the stored state without
        // hitting FASHN again.
        if (row.status === "completed") {
            const resp: PollResponse = {
                status: "completed",
                result_url: row.result_photo_url || undefined,
            };
            // For multi-sample rows the chosen variant path ends in
            // `_<n>.png`. Derive the full set so the frontend can still
            // show the picker after a page reload.
            const m = row.result_photo_url
                ? row.result_photo_url.match(/_(\d+)\.png$/)
                : null;
            if (m) {
                resp.result_urls = Array.from(
                    { length: VARIANT_COUNT },
                    (_, i) => variantKeyPath(row.user_id, row.id, i),
                );
            }
            return json(resp);
        }
        if (row.status === "failed") {
            const resp: PollResponse = {
                status: "failed",
                error: row.error_message || "Generation failed",
            };
            return json(resp);
        }

        // running / pending: poll FASHN
        if (!row.fashn_request_id) {
            return httpError(500, "Generation has no FASHN request id");
        }
        const pred = await fetchPrediction(env, row.fashn_request_id);

        if (pred.status === "completed") {
            if (!pred.output.length) {
                return httpError(502, "FASHN reported completed without output");
            }
            // Download every variant in parallel. We keep the suffixed
            // keys (_0, _1, …) so the user can switch between them
            // without re-running FASHN.
            const stored = await Promise.all(
                pred.output.map((u, idx) =>
                    downloadResultToR2(env, {
                        url: u,
                        userId: user.id,
                        generationId: row.id,
                        variantIndex: idx,
                    }),
                ),
            );
            // Default the canonical result to the first variant — the
            // user can flip it via POST /api/try-on/<id> if they prefer
            // the other render. Set this synchronously so a refresh
            // before the user picks still shows something.
            const defaultUrl = stored[0];
            await updateGeneration(env, row.id, {
                status: "completed",
                result_photo_url: defaultUrl,
                completed_at: new Date().toISOString(),
            });
            const resp: PollResponse = {
                status: "completed",
                result_url: defaultUrl,
                result_urls: stored,
            };
            return json(resp);
        }

        if (pred.status === "failed") {
            const errMsg = pred.error?.message || "Generation failed";
            await insertCredit(env, {
                userId: user.id,
                amount: 1,
                reason: "refund",
                referenceId: row.id,
                notes: `Refund for failed generation: ${errMsg}`.slice(0, 500),
            });
            await updateGeneration(env, row.id, {
                status: "failed",
                error_message: errMsg.slice(0, 500),
                completed_at: new Date().toISOString(),
            });
            const resp: PollResponse = {
                status: "failed",
                error: errMsg,
            };
            return json(resp);
        }

        // starting / in_queue / processing / unknown — keep polling
        const resp: PollResponse = { status: "running" };
        return json(resp);
    } catch (e) {
        if (e instanceof HttpError) return errorResponse(e);
        throw e;
    }
};

interface SelectVariantBody {
    variant_index?: number;
}

export const onRequestPost: PagesFunction<Env, "id"> = async ({
    request,
    env,
    params,
}) => {
    try {
        const user = await requireUser(request, env);

        const id = typeof params.id === "string" ? params.id : "";
        if (!id) {
            return httpError(400, "Generation id is required");
        }

        let body: SelectVariantBody;
        try {
            body = (await request.json()) as SelectVariantBody;
        } catch {
            return httpError(400, "Expected JSON body");
        }
        const idx = Number(body.variant_index);
        if (!Number.isInteger(idx) || idx < 0 || idx >= VARIANT_COUNT) {
            return httpError(400, `variant_index must be 0..${VARIANT_COUNT - 1}`);
        }

        const row = await getGeneration(env, id);
        if (!row) {
            return httpError(404, "Generation not found");
        }
        if (row.user_id !== user.id) {
            return httpError(404, "Generation not found");
        }
        if (row.status !== "completed") {
            return httpError(409, "Generation is not completed yet");
        }

        const newUrl = variantKeyPath(row.user_id, row.id, idx);
        if (row.result_photo_url !== newUrl) {
            await updateGeneration(env, row.id, { result_photo_url: newUrl });
        }
        return json({ status: "ok", result_url: newUrl });
    } catch (e) {
        if (e instanceof HttpError) return errorResponse(e);
        throw e;
    }
};
