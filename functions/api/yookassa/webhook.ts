// =============================================================================
// POST /api/yookassa/webhook
//
// YooKassa does NOT sign webhooks. Verification has three layers:
//   1. Source-IP allowlist (lib/yookassa-ip.ts).
//   2. Re-fetch the payment over a server-to-server GET — we don't trust the
//      body's `status` field.
//   3. Idempotency at the DB layer: payments has UNIQUE(processor, processor_id),
//      and we look up an existing credit_ledger 'purchase' row by
//      reference_id before granting.
//
// Mirrors backend/main.py::yookassa_webhook.
// =============================================================================
import type { Env } from "../../../lib/env";
import {
    getCreditBalance,
    getPaymentByProcessorId,
    hasPurchaseGrant,
    insertCredit,
    insertPayment,
    updatePaymentStatus,
} from "../../../lib/db";
import { errorResponse, httpError, HttpError, json } from "../../../lib/http";
import { CREDIT_PACKS, packAmountCents } from "../../../lib/packs";
import { fetchPayment } from "../../../lib/yookassa";
import { clientIp, isYooKassaIp } from "../../../lib/yookassa-ip";

interface YooKassaEvent {
    event?: string;
    object?: {
        id?: string;
        status?: string;
        metadata?: { user_id?: string; pack_id?: string };
    };
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
    try {
        const ip = clientIp(request);
        if (!isYooKassaIp(env, ip)) {
            console.warn(`Rejecting YooKassa webhook from non-allowlisted IP: ${ip}`);
            return httpError(403, "Source IP not in YooKassa allowlist");
        }

        const event = (await request.json().catch(() => ({}))) as YooKassaEvent;
        const ykId = event?.object?.id;
        if (!ykId) {
            return httpError(400, "Webhook body missing object.id");
        }
        const eventType = event.event || "";

        // We don't trust the webhook body's status — re-fetch.
        const payment = await fetchPayment(env, ykId);
        const userId = payment.metadata?.user_id;
        const packId = payment.metadata?.pack_id;
        if (!userId || !packId) {
            console.warn(`Webhook for ${ykId} missing user_id/pack_id metadata`);
            return json({ ok: true, ignored: "missing metadata" });
        }
        const pack = CREDIT_PACKS[packId];
        if (!pack) {
            console.warn(`Webhook for ${ykId} references unknown pack ${packId}`);
            return json({ ok: true, ignored: "unknown pack" });
        }

        // Find / insert the payments row.
        let paymentRow = await getPaymentByProcessorId(env, "yookassa", ykId);
        if (!paymentRow) {
            const newId = await insertPayment(env, {
                userId,
                processor: "yookassa",
                processorId: ykId,
                amountCents: packAmountCents(pack),
                creditsGranted: 0,
                statusValue: payment.status,
                rawEvent: event,
            });
            if (!newId) {
                // Concurrent webhook beat us; re-read.
                paymentRow = await getPaymentByProcessorId(env, "yookassa", ykId);
            } else {
                paymentRow = await getPaymentByProcessorId(env, "yookassa", ykId);
            }
        } else {
            await updatePaymentStatus(env, paymentRow.id, {
                statusValue: payment.status,
                rawEvent: event,
            });
        }
        if (!paymentRow) {
            return httpError(500, "Could not resolve payments row for webhook");
        }

        const isSucceeded = payment.status === "succeeded"
            || eventType === "payment.succeeded";
        if (!isSucceeded) {
            return json({ ok: true, status: payment.status });
        }

        // Grant credits — once.
        const already = await hasPurchaseGrant(env, userId, paymentRow.id);
        if (already) {
            return json({ ok: true, granted: false, reason: "already granted" });
        }

        await insertCredit(env, {
            userId,
            amount: pack.credits,
            reason: "purchase",
            referenceId: paymentRow.id,
            notes: `YooKassa ${ykId} (${pack.id})`,
        });
        await updatePaymentStatus(env, paymentRow.id, {
            statusValue: "succeeded",
            creditsGranted: pack.credits,
        });

        const balance = await getCreditBalance(env, userId);
        return json({ ok: true, granted: true, credits_added: pack.credits, balance });
    } catch (e) {
        if (e instanceof HttpError) return errorResponse(e);
        console.error("Webhook handler error:", e);
        return errorResponse(e);
    }
};
