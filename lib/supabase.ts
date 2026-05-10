// =============================================================================
// Thin async client for the Supabase Postgres REST API (PostgREST).
//
// Uses the SERVICE_ROLE key — bypasses RLS — so callers must verify
// the user's JWT first via lib/auth.ts before doing anything on their behalf.
//
// Mirrors backend/db.py.
// =============================================================================
import type { Env } from "./env";
import { httpError } from "./http";

function serviceHeaders(env: Env): Record<string, string> {
    if (!env.SUPABASE_SERVICE_ROLE_KEY) {
        return httpError(500, "SUPABASE_SERVICE_ROLE_KEY not configured");
    }
    return {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
    };
}

interface RequestOptions {
    method: "GET" | "POST" | "PATCH" | "DELETE";
    path: string;
    params?: Record<string, string>;
    body?: unknown;
    prefer?: string;
}

export async function pgrest<T = unknown>(
    env: Env,
    opts: RequestOptions,
): Promise<T> {
    const headers = serviceHeaders(env);
    if (opts.prefer) headers["Prefer"] = opts.prefer;

    const url = new URL(`${env.SUPABASE_URL}${opts.path}`);
    if (opts.params) {
        for (const [k, v] of Object.entries(opts.params)) {
            url.searchParams.set(k, v);
        }
    }

    const init: RequestInit = {
        method: opts.method,
        headers,
    };
    if (opts.body !== undefined) {
        init.body = JSON.stringify(opts.body);
    }

    const resp = await fetch(url.toString(), init);
    const text = await resp.text();

    // Special-case unique-violation so the caller can detect idempotent replays.
    if (resp.status === 409 || text.includes("23505")) {
        const err = new UniqueViolationError(text.slice(0, 300));
        throw err;
    }

    if (resp.status >= 400) {
        return httpError(500, `DB error (${resp.status}): ${text.slice(0, 300)}`);
    }
    if (!text) {
        return undefined as T;
    }
    try {
        return JSON.parse(text) as T;
    } catch {
        return text as unknown as T;
    }
}

export class UniqueViolationError extends Error {
    constructor(detail: string) {
        super(`UNIQUE constraint violation: ${detail}`);
    }
}
