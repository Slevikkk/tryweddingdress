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
//                completed                    → download to R2, mark
//                                              'completed', return result_url
//                failed                       → refund credit, mark
//                                              'failed', return error
//   completed → return cached result_photo_url
//   failed   → return cached error_message
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
    error?: string;
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
            const url = pred.output[0];
            if (!url) {
                return httpError(502, "FASHN reported completed without output");
            }
            const resultUrl = await downloadResultToR2(env, {
                url,
                userId: user.id,
                generationId: row.id,
            });
            await updateGeneration(env, row.id, {
                status: "completed",
                result_photo_url: resultUrl,
                completed_at: new Date().toISOString(),
            });
            const resp: PollResponse = {
                status: "completed",
                result_url: resultUrl,
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
