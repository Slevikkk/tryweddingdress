// =============================================================================
// Credit packs — locked at W3.5. Mirrors backend/payments.py::CREDIT_PACKS.
// =============================================================================
import { httpError } from "./http";

export interface CreditPack {
    readonly id: string;
    readonly name: string;
    readonly credits: number;
    readonly amountRub: number; // full rubles, no kopecks
    readonly description: string;
}

export const CREDIT_PACKS: Readonly<Record<string, CreditPack>> = {
    starter: {
        id: "starter",
        name: "Старт",
        credits: 5,
        amountRub: 1490,
        description: "5 примерок свадебных платьев на Try Wedding Dress",
    },
    bride: {
        id: "bride",
        name: "Невеста",
        credits: 20,
        amountRub: 2290,
        description: "20 примерок свадебных платьев на Try Wedding Dress",
    },
    full: {
        id: "full",
        name: "Полный",
        credits: 60,
        amountRub: 4690,
        description: "60 примерок свадебных платьев на Try Wedding Dress",
    },
};

export function getPack(packId: string): CreditPack {
    const p = CREDIT_PACKS[packId];
    if (!p) return httpError(400, `Unknown credit pack: ${packId}`);
    return p;
}

/** Kopecks (RUB * 100), used as `payments.amount_cents` in Postgres. */
export function packAmountCents(p: CreditPack): number {
    return p.amountRub * 100;
}

/** Stringified decimal with two fractional digits, as YooKassa wants. */
export function packYookassaAmount(p: CreditPack): string {
    return `${p.amountRub}.00`;
}
