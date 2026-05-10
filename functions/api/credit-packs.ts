import type { Env } from "../../lib/env";
import { json } from "../../lib/http";
import { CREDIT_PACKS, packAmountCents } from "../../lib/packs";

export const onRequestGet: PagesFunction<Env> = () => {
    const packs = Object.values(CREDIT_PACKS).map((p) => ({
        id: p.id,
        name: p.name,
        credits: p.credits,
        amount_rub: p.amountRub,
        amount_cents: packAmountCents(p),
        currency: "RUB",
        description: p.description,
    }));
    return json(packs);
};
