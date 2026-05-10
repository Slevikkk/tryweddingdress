// =============================================================================
// GET /results/<userId>/<generationId>.png
//
// Serves a tryon result image straight from R2, with an ownership check
// so users only see their own outputs. Catches 401/403 so an attacker
// can't differentiate "exists" vs "not yours" from the response.
//
// Why a Pages Function instead of public R2:
//   Generated photos contain the user's face on a wedding dress. Even
//   though keys are UUID-prefixed, public bucket exposure was deemed
//   too risky. This handler is on the hot path though, so we fetch
//   from R2 once and stream the body back without re-encoding.
//
// We also accept token via `?t=` query param so <img src=...> tags
// (which can't set Authorization headers) can pass auth without forcing
// the client to do a fetch + blob URL dance.
// =============================================================================
import type { Env } from "../../lib/env";
import { requireUser } from "../../lib/auth";
import { errorResponse, httpError, HttpError } from "../../lib/http";

export const onRequestGet: PagesFunction<Env, "key"> = async ({
    request,
    env,
    params,
}) => {
    try {
        // requireUser only reads the Authorization header. If the caller
        // is an <img> tag, copy `?t=...` into a synthetic Authorization
        // header and validate that.
        const url = new URL(request.url);
        const tokenParam = url.searchParams.get("t");
        let effectiveRequest = request;
        if (tokenParam && !request.headers.get("authorization")) {
            const headers = new Headers(request.headers);
            headers.set("Authorization", `Bearer ${tokenParam}`);
            effectiveRequest = new Request(request, { headers });
        }
        const user = await requireUser(effectiveRequest, env);

        // params.key is the catch-all path under /results/. Pages
        // gives it as either a string or string[] depending on whether
        // we used [[key]].
        const segs = Array.isArray(params.key)
            ? params.key
            : (params.key || "").split("/").filter(Boolean);
        if (segs.length < 2) {
            return httpError(404, "Not found");
        }
        const [pathUserId, ...rest] = segs;
        if (pathUserId !== user.id) {
            // Don't leak that the file exists for somebody else.
            return httpError(404, "Not found");
        }

        const key = `results/${segs.join("/")}`;
        const obj = await env.RESULTS_BUCKET.get(key);
        if (!obj) {
            return httpError(404, "Not found");
        }

        const headers = new Headers();
        headers.set(
            "Content-Type",
            obj.httpMetadata?.contentType || "image/png",
        );
        // Don't let CDNs cache user-private images: each request must
        // re-validate ownership through this function.
        headers.set("Cache-Control", "private, max-age=300");
        if (obj.size) headers.set("Content-Length", String(obj.size));

        // Suppress unused-variable warning for `rest` — kept for
        // readability of the destructure above.
        void rest;

        return new Response(obj.body, { headers });
    } catch (e) {
        if (e instanceof HttpError) return errorResponse(e);
        throw e;
    }
};
