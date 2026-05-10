// =============================================================================
// POST /api/upload-photo
//
// Body: multipart/form-data with a single `file` field (image/*, <=10MB).
// Returns: { file_id, filename }
//
// The file lands in R2 at `uploads/<userId>/<fileId>.<ext>`. We reuse the
// RESULTS_BUCKET binding so we don't have to create a second bucket; the
// path prefix keeps uploads, custom-dress uploads, and tryon results in
// distinct keyspaces.
//
// Auth: required. The Supabase JWT is verified against /auth/v1/user
// inside requireUser; this also guarantees the user_id we use in the
// storage path is real.
// =============================================================================
import type { Env } from "../../lib/env";
import { requireUser } from "../../lib/auth";
import { errorResponse, httpError, HttpError, json } from "../../lib/http";

const ALLOWED_MIME = new Set([
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/webp",
]);
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB — keeps base64 payload to FASHN under ~14 MB

function extFromMime(mime: string): string {
    if (mime === "image/png") return "png";
    if (mime === "image/webp") return "webp";
    return "jpg"; // jpeg / jpg / fallback
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
    try {
        const user = await requireUser(request, env);

        let form: FormData;
        try {
            form = await request.formData();
        } catch {
            return httpError(400, "Expected multipart/form-data body");
        }

        // Workers types declare FormData.get() as `string | null`, but
        // the runtime returns File for file fields. Cast through unknown
        // to keep the type system off our back.
        const file = form.get("file") as unknown as File | string | null;
        if (!(file instanceof File)) {
            return httpError(400, "Missing 'file' field");
        }
        if (file.size === 0) {
            return httpError(400, "File is empty");
        }
        if (file.size > MAX_BYTES) {
            return httpError(413, "Файл больше 10 МБ");
        }
        const mime = (file.type || "").toLowerCase();
        if (!ALLOWED_MIME.has(mime)) {
            return httpError(415, "Загрузите JPG, PNG или WEBP");
        }

        const fileId = crypto.randomUUID();
        const ext = extFromMime(mime);
        const key = `uploads/${user.id}/${fileId}.${ext}`;

        await env.RESULTS_BUCKET.put(key, file.stream(), {
            httpMetadata: { contentType: mime },
            // customMetadata is searchable in R2 and useful when debugging
            // a specific user's upload from the dashboard.
            customMetadata: {
                userId: user.id,
                originalName: (file.name || "").slice(0, 200),
            },
        });

        return json({ file_id: fileId, filename: `${fileId}.${ext}` });
    } catch (e) {
        if (e instanceof HttpError) return errorResponse(e);
        throw e;
    }
};
