// =============================================================================
// YooKassa client (HTTP Basic; idempotent POST via Idempotence-Key).
// Mirrors backend/payments.py.
// =============================================================================
import type { Env } from "./env";
import { httpError } from "./http";
import type { CreditPack } from "./packs";
import { packYookassaAmount } from "./packs";

const YOOKASSA_API_URL = "https://api.yookassa.ru/v3";

export function yookassaConfigured(env: Env): boolean {
    return Boolean(env.YOOKASSA_SHOP_ID && env.YOOKASSA_SECRET_KEY);
}

function basicAuthHeader(env: Env): string {
    if (!yookassaConfigured(env)) {
        return httpError(503, "Payment provider is not configured yet");
    }
    const raw = `${env.YOOKASSA_SHOP_ID}:${env.YOOKASSA_SECRET_KEY}`;
    // Workers don't have Buffer; use btoa on a UTF-8 string. shop_id and
    // secret_key are ASCII so a plain btoa is safe here.
    return "Basic " + btoa(raw);
}

interface RequestOptions {
    method: "GET" | "POST";
    path: string;
    body?: unknown;
    idempotenceKey?: string;
}

async function ykRequest<T = unknown>(env: Env, opts: RequestOptions): Promise<T> {
    const headers: Record<string, string> = {
        Authorization: basicAuthHeader(env),
        "Content-Type": "application/json",
    };
    if (opts.idempotenceKey) headers["Idempotence-Key"] = opts.idempotenceKey;

    const init: RequestInit = { method: opts.method, headers };
    if (opts.body !== undefined) init.body = JSON.stringify(opts.body);

    const resp = await fetch(`${YOOKASSA_API_URL}${opts.path}`, init);
    const text = await resp.text();
    if (resp.status >= 400) {
        return httpError(502, `YooKassa error (${resp.status}): ${text.slice(0, 300)}`);
    }
    try {
        return JSON.parse(text) as T;
    } catch {
        return httpError(502, `YooKassa returned non-JSON body: ${text.slice(0, 200)}`);
    }
}

export interface CreatePaymentArgs {
    pack: CreditPack;
    userId: string;
    userEmail: string;
    returnUrl: string;
}

export interface YooKassaPayment {
    id: string;
    status: string;
    amount: { value: string; currency: string };
    confirmation?: { type: string; confirmation_url?: string };
    metadata?: Record<string, string>;
}

export async function createPayment(env: Env, a: CreatePaymentArgs): Promise<YooKassaPayment> {
    const payload: Record<string, unknown> = {
        amount: { value: packYookassaAmount(a.pack), currency: "RUB" },
        capture: true,
        confirmation: { type: "redirect", return_url: a.returnUrl },
        description: a.pack.description,
        metadata: {
            user_id: a.userId,
            pack_id: a.pack.id,
            credits: String(a.pack.credits),
        },
    };
    if (a.userEmail) {
        payload.receipt = {
            customer: { email: a.userEmail },
            items: [
                {
                    description: a.pack.description.slice(0, 128),
                    quantity: "1.00",
                    amount: { value: packYookassaAmount(a.pack), currency: "RUB" },
                    vat_code: 1,
                    payment_mode: "full_prepayment",
                    payment_subject: "service",
                },
            ],
        };
    }

    return ykRequest<YooKassaPayment>(env, {
        method: "POST",
        path: "/payments",
        body: payload,
        idempotenceKey: crypto.randomUUID(),
    });
}

export async function fetchPayment(env: Env, paymentId: string): Promise<YooKassaPayment> {
    return ykRequest<YooKassaPayment>(env, {
        method: "GET",
        path: `/payments/${encodeURIComponent(paymentId)}`,
    });
}
