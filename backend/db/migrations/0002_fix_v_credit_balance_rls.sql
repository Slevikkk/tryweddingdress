-- =============================================================================
-- 0002_fix_v_credit_balance_rls.sql
-- =============================================================================
-- Fix RLS leak on v_credit_balance.
--
-- The view was originally created without `security_invoker = true`, so it
-- runs with the *definer's* privileges (the role that created the view) and
-- bypasses RLS on credit_ledger. Effect: any authenticated user could read
-- the balance of every other user via this view.
--
-- Setting `security_invoker = true` makes the view honour the caller's RLS
-- policies. credit_ledger already has `credit_ledger_self_select` restricting
-- SELECT to `auth.uid() = user_id`, so users will now only see their own row.
--
-- Idempotent: ALTER VIEW SET reloptions is safe to re-run.
-- Requires Postgres 15+ (Supabase default since 2023).
-- =============================================================================

alter view public.v_credit_balance set (security_invoker = true);
