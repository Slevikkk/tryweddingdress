import type { Env } from "../../lib/env";
import { requireUser } from "../../lib/auth";
import { getCreditBalance } from "../../lib/db";
import { errorResponse, HttpError, json } from "../../lib/http";

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
    try {
        const user = await requireUser(request, env);
        const balance = await getCreditBalance(env, user.id);
        return json({ balance });
    } catch (e) {
        if (e instanceof HttpError) return errorResponse(e);
        throw e;
    }
};
