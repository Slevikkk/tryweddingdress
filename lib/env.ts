// =============================================================================
// Shared Env shape for Pages Functions.
//
// Wrangler injects these into the `context.env` object every request; we
// type them centrally so functions can `import type { Env } from '../lib/env'`
// instead of redefining the shape ad-hoc per file.
// =============================================================================
export interface Env {
    // Supabase
    SUPABASE_URL: string;
    SUPABASE_SERVICE_ROLE_KEY: string;
    SUPABASE_ANON_KEY?: string; // optional; service-role works as a fallback

    // FASHN
    FASHN_API_KEY: string;

    // YooKassa (optional until moderation lands)
    YOOKASSA_SHOP_ID?: string;
    YOOKASSA_SECRET_KEY?: string;
    YOOKASSA_WEBHOOK_IPS_ALLOWLIST?: string; // CSV, overrides defaults
    YOOKASSA_DISABLE_IP_CHECK?: string; // "1" to bypass (dev only)

    // R2 binding for FASHN result images
    RESULTS_BUCKET: R2Bucket;
}
