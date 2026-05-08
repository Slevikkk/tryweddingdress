-- =============================================================================
-- 0004_fix_credit_ledger_reason_constraint.sql
-- =============================================================================
-- The live DB's credit_ledger reason CHECK constraint only allows
-- 'signup_bonus' and 'purchase' — verified empirically: insert with
-- reason='generation' returns 23514 even though 0001 declares those
-- values valid. Either 0001 was applied from an older snapshot, or the
-- constraint was hand-edited in Studio at some point. Either way, we
-- need every value 0001 promised so the backend's generate / refund
-- flow can write to the ledger.
--
-- Drop and recreate with the full list. Idempotent re-runs are safe:
-- the constraint name is stable across drop/create.
-- =============================================================================

alter table public.credit_ledger
    drop constraint if exists credit_ledger_reason_check;

alter table public.credit_ledger
    add constraint credit_ledger_reason_check
    check (reason in (
        'signup_bonus',
        'purchase',
        'generation',
        'refund',
        'promo',
        'admin_adjustment',
        'reversal'
    ));
