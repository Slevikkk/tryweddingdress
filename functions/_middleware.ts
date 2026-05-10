// =============================================================================
// Global request middleware: structured error handling + permissive CORS for
// preview branches.
//
// Pages serves frontend + functions on the SAME origin in prod
// (tryweddingdress.com), so most requests don't need CORS at all. We add
// allow-headers for two cases:
//   - localhost dev (uvicorn-style) cross-origin
//   - tryweddingdress.pages.dev preview branches hitting prod API
// =============================================================================
import type { Env } from "../lib/env";
import { errorResponse, HttpError } from "../lib/http";

const ALLOWED_ORIGINS = new Set([
    "https://tryweddingdress.com",
    "https://www.tryweddingdress.com",
    "http://localhost:8000",
    "http://127.0.0.1:8000",
    "http://localhost:8788",
    "http://127.0.0.1:8788",
]);
const PAGES_PREVIEW_REGEX = /^https:\/\/[a-z0-9-]+\.tryweddingdress\.pages\.dev$/;

function corsHeadersFor(origin: string | null): Record<string, string> {
    if (!origin) return {};
    if (!ALLOWED_ORIGINS.has(origin) && !PAGES_PREVIEW_REGEX.test(origin)) return {};
    return {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Credentials": "true",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
        "Vary": "Origin",
    };
}

export const onRequest: PagesFunction<Env> = async (context) => {
    const origin = context.request.headers.get("origin");
    const cors = corsHeadersFor(origin);

    if (context.request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: cors });
    }

    let resp: Response;
    try {
        resp = await context.next();
    } catch (e) {
        // Bubble HttpError as a clean JSON; surface anything else as 500.
        resp = e instanceof HttpError
            ? errorResponse(e)
            : (() => {
                console.error("Unhandled function error:", e);
                return errorResponse(e);
            })();
    }

    if (Object.keys(cors).length > 0) {
        const headers = new Headers(resp.headers);
        for (const [k, v] of Object.entries(cors)) headers.set(k, v);
        resp = new Response(resp.body, {
            status: resp.status,
            statusText: resp.statusText,
            headers,
        });
    }
    return resp;
};
