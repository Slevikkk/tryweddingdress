// =============================================================================
// JSON / error response helpers shared by every endpoint.
// =============================================================================

export function json(body: unknown, init: ResponseInit = {}): Response {
    const headers = new Headers(init.headers);
    headers.set("Content-Type", "application/json; charset=utf-8");
    return new Response(JSON.stringify(body), { ...init, headers });
}

export class HttpError extends Error {
    public status: number;
    public detail: string;

    constructor(status: number, detail: string) {
        super(detail);
        this.status = status;
        this.detail = detail;
    }
}

export function httpError(status: number, detail: string): never {
    throw new HttpError(status, detail);
}

export function errorResponse(err: unknown): Response {
    if (err instanceof HttpError) {
        return json({ detail: err.detail }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : String(err);
    return json({ detail: `Internal server error: ${message}` }, { status: 500 });
}
