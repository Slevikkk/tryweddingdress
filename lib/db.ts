// =============================================================================
// Domain DB operations on top of lib/supabase.ts.
// Mirrors backend/db.py one-for-one so the FastAPI version stays usable
// for local dev / test rigs.
// =============================================================================
import type { Env } from "./env";
import { pgrest, UniqueViolationError } from "./supabase";

interface CreditLedgerRow {
    id: string;
    amount: number;
}

export async function getCreditBalance(env: Env, userId: string): Promise<number> {
    const rows = await pgrest<CreditLedgerRow[]>(env, {
        method: "GET",
        path: "/rest/v1/credit_ledger",
        params: {
            select: "amount",
            user_id: `eq.${userId}`,
        },
    });
    if (!rows || rows.length === 0) return 0;
    return rows.reduce((sum, r) => sum + Number(r.amount), 0);
}

interface InsertCreditOpts {
    userId: string;
    amount: number;
    reason: string;
    referenceId?: string | null;
    notes?: string | null;
}

export async function insertCredit(env: Env, o: InsertCreditOpts): Promise<string> {
    const body: Record<string, unknown> = {
        user_id: o.userId,
        amount: o.amount,
        reason: o.reason,
    };
    if (o.referenceId !== undefined && o.referenceId !== null) body.reference_id = o.referenceId;
    if (o.notes !== undefined && o.notes !== null) body.notes = o.notes;

    const rows = await pgrest<{ id: string }[]>(env, {
        method: "POST",
        path: "/rest/v1/credit_ledger",
        body,
        prefer: "return=representation",
    });
    return rows[0].id;
}

interface InsertGenerationOpts {
    userId: string;
    dressId: string;
    dressName: string;
    dressImageUrl: string;
    inputPhotoUrl?: string | null;
    statusValue?: string;
    fashnRequestId?: string | null;
}

export async function insertGeneration(env: Env, o: InsertGenerationOpts): Promise<string> {
    const body: Record<string, unknown> = {
        user_id: o.userId,
        dress_id: o.dressId,
        dress_name: o.dressName,
        dress_image_url: o.dressImageUrl,
        status: o.statusValue ?? "pending",
    };
    if (o.inputPhotoUrl !== undefined && o.inputPhotoUrl !== null) {
        body.input_photo_url = o.inputPhotoUrl;
    }
    if (o.fashnRequestId) {
        body.fashn_request_id = o.fashnRequestId;
    }

    const rows = await pgrest<{ id: string }[]>(env, {
        method: "POST",
        path: "/rest/v1/generations",
        body,
        prefer: "return=representation",
    });
    return rows[0].id;
}

export async function updateGeneration(
    env: Env,
    generationId: string,
    fields: Record<string, unknown>,
): Promise<void> {
    if (Object.keys(fields).length === 0) return;
    await pgrest<unknown>(env, {
        method: "PATCH",
        path: "/rest/v1/generations",
        params: { id: `eq.${generationId}` },
        body: fields,
        prefer: "return=minimal",
    });
}

export interface GenerationRow {
    id: string;
    user_id: string;
    dress_id: string;
    dress_name: string;
    dress_image_url: string;
    input_photo_url: string | null;
    result_photo_url: string | null;
    status: "pending" | "running" | "completed" | "failed" | "canceled" | string;
    error_message: string | null;
    duration_ms: number | null;
    fashn_request_id: string | null;
    created_at: string;
    completed_at: string | null;
}

export async function getGeneration(env: Env, id: string): Promise<GenerationRow | null> {
    const rows = await pgrest<GenerationRow[]>(env, {
        method: "GET",
        path: "/rest/v1/generations",
        params: { select: "*", id: `eq.${id}`, limit: "1" },
    });
    return rows && rows.length ? rows[0] : null;
}

// ---------------------------------------------------------------------------
// payments
// ---------------------------------------------------------------------------
export interface PaymentRow {
    id: string;
    user_id: string;
    processor: string;
    processor_id: string;
    amount_cents: number;
    currency: string;
    credits_granted: number;
    status: string;
    raw_event: unknown;
    created_at: string;
}

export async function getPaymentByProcessorId(
    env: Env,
    processor: string,
    processorId: string,
): Promise<PaymentRow | null> {
    const rows = await pgrest<PaymentRow[]>(env, {
        method: "GET",
        path: "/rest/v1/payments",
        params: {
            select: "*",
            processor: `eq.${processor}`,
            processor_id: `eq.${processorId}`,
            limit: "1",
        },
    });
    return rows && rows.length ? rows[0] : null;
}

interface InsertPaymentOpts {
    userId: string;
    processor: string;
    processorId: string;
    amountCents: number;
    creditsGranted: number;
    statusValue: string;
    currency?: string;
    rawEvent?: unknown;
}

/** Returns row id, or `null` on a unique-violation replay. */
export async function insertPayment(env: Env, o: InsertPaymentOpts): Promise<string | null> {
    const body: Record<string, unknown> = {
        user_id: o.userId,
        processor: o.processor,
        processor_id: o.processorId,
        amount_cents: o.amountCents,
        currency: o.currency ?? "RUB",
        credits_granted: o.creditsGranted,
        status: o.statusValue,
    };
    if (o.rawEvent !== undefined) body.raw_event = o.rawEvent;

    try {
        const rows = await pgrest<{ id: string }[]>(env, {
            method: "POST",
            path: "/rest/v1/payments",
            body,
            prefer: "return=representation",
        });
        return rows && rows.length ? rows[0].id : null;
    } catch (e) {
        if (e instanceof UniqueViolationError) {
            return null;
        }
        throw e;
    }
}

interface UpdatePaymentOpts {
    statusValue: string;
    rawEvent?: unknown;
    creditsGranted?: number;
}

export async function updatePaymentStatus(
    env: Env,
    paymentId: string,
    o: UpdatePaymentOpts,
): Promise<void> {
    const fields: Record<string, unknown> = { status: o.statusValue };
    if (o.rawEvent !== undefined) fields.raw_event = o.rawEvent;
    if (o.creditsGranted !== undefined) fields.credits_granted = o.creditsGranted;
    await pgrest<unknown>(env, {
        method: "PATCH",
        path: "/rest/v1/payments",
        params: { id: `eq.${paymentId}` },
        body: fields,
        prefer: "return=minimal",
    });
}

export async function hasPurchaseGrant(
    env: Env,
    userId: string,
    paymentRowId: string,
): Promise<boolean> {
    const rows = await pgrest<unknown[]>(env, {
        method: "GET",
        path: "/rest/v1/credit_ledger",
        params: {
            select: "id",
            user_id: `eq.${userId}`,
            reason: "eq.purchase",
            reference_id: `eq.${paymentRowId}`,
            limit: "1",
        },
    });
    return Boolean(rows && rows.length);
}
