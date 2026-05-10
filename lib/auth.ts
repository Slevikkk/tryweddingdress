// =============================================================================
// Supabase JWT verification.
//
// Mirrors backend/auth.py: instead of validating the JWT signature locally
// (which would force us to hold the project's JWT secret in env), we ask
// Supabase to do it via /auth/v1/user. One extra ~50ms HTTP hop in exchange
// for not having to manage another secret.
// =============================================================================
import type { Env } from "./env";
import { httpError } from "./http";

export interface AuthedUser {
    id: string;
    email: string;
    accessToken: string;
}

export async function requireUser(
    request: Request,
    env: Env,
): Promise<AuthedUser> {
    const authHeader = request.headers.get("authorization") || "";
    if (!authHeader) {
        return httpError(401, "Missing Authorization header");
    }

    const m = authHeader.match(/^Bearer\s+(.+)$/i);
    if (!m || !m[1]?.trim()) {
        return httpError(401, "Authorization header must be 'Bearer <token>'");
    }
    const token = m[1].trim();

    // The `apikey` header is just project identification on /auth/v1/user;
    // anon and service-role both work. Prefer anon if present, fall back
    // to service-role to keep prod env minimal.
    const apiKey = env.SUPABASE_ANON_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
    if (!apiKey || !env.SUPABASE_URL) {
        return httpError(500, "Auth not configured on the server");
    }

    let resp: Response;
    try {
        resp = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
            headers: {
                Authorization: `Bearer ${token}`,
                apikey: apiKey,
            },
            // Cloudflare default is no timeout; we let the platform wall
            // limit (30s on Pages Functions paid) act as the upper bound.
        });
    } catch (e) {
        return httpError(503, `Auth backend unavailable: ${e}`);
    }

    if (resp.status === 401) {
        return httpError(401, "Invalid or expired session");
    }
    if (!resp.ok) {
        const body = await resp.text();
        return httpError(401, `Auth check failed: ${body.slice(0, 200)}`);
    }

    const data = (await resp.json()) as { id?: string; email?: string };
    if (!data.id) {
        return httpError(401, "Token did not resolve to a user");
    }

    return {
        id: data.id,
        email: data.email || "",
        accessToken: token,
    };
}
