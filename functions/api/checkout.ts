// =============================================================================
// POST /api/checkout
//
// Body: { pack_id: string, return_url: string }
// Returns: { confirmation_url, payment_id, pack: {...}, status }
//
// Mirrors backend/main.py::checkout. We deliberately don't insert the
// `payments` row here — the webhook handler is the source of truth so we
// can't double-grant credits if the user closes the YooKassa redirect tab
// without paying.
// =============================================================================
import type { Env } from "../../lib/env";
import { requireUser } from "../../lib/auth";
import { errorResponse, httpError, HttpError, json } from "../../lib/http";
import { getPack, packAmountCents } from "../../lib/packs";
import { createPayment } from "../../lib/yookassa";

interface CheckoutBody {
    pack_id?: unknown;
    return_url?: unknown;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
    try {
        const user = await requireUser(request, env);
        const body = (await request.json().catch(() => ({}))) as CheckoutBody;
        if (typeof body.pack_id !== "string" || !body.pack_id) {
            return httpError(400, "pack_id is required");
        }
        if (typeof body.return_url !== "string" || !body.return_url) {
            return httpError(400, "return_url is required");
        }
        try {
            new URL(body.return_url);
        } catch {
            return httpError(400, "return_url must be a valid URL");
        }

        const pack = getPack(body.pack_id);
        const payment = await createPayment(env, {
            pack,
            userId: user.id,
            userEmail: user.email,
            returnUrl: body.return_url,
        });

        const confirmationUrl = payment.confirmation?.confirmation_url;
        if (!confirmationUrl) {
            return httpError(502, "YooKassa response did not include confirmation_url");
        }

        return json({
            confirmation_url: confirmationUrl,
            payment_id: payment.id,
            status: payment.status,
            pack: {
                id: pack.id,
                name: pack.name,
                credits: pack.credits,
                amount_rub: pack.amountRub,
                amount_cents: packAmountCents(pack),
            },
        });
    } catch (e) {
        if (e instanceof HttpError) return errorResponse(e);
        throw e;
    }
};
