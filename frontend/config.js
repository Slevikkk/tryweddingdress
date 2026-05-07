// =============================================================================
// Public Supabase config for the browser.
//
// SAFE TO COMMIT. The anon key is a JWT signed with role="anon" and is
// designed to be served to every browser visitor — Supabase enforces access
// via Row-Level Security policies in backend/db/migrations/. Rotating the
// anon key requires updating it everywhere it is embedded.
//
// NEVER put the SERVICE_ROLE key in frontend code — it bypasses RLS.
// =============================================================================
window.TWD_CONFIG = {
    SUPABASE_URL: 'https://uqevnxxorffumbzwldkx.supabase.co',
    SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVxZXZueHhvcmZmdW1iendsZGt4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgxNjE3NzgsImV4cCI6MjA5MzczNzc3OH0.XtTEVjZ2vUYz6EDaEUAhLduVW9UvrjDuykUn2tmde88',
};
