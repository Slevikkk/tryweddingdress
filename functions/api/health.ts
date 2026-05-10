import type { Env } from "../../lib/env";
import { json } from "../../lib/http";

export const onRequestGet: PagesFunction<Env> = () => {
    return json({ status: "ok", service: "tryweddingdress-api" });
};
