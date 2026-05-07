-- =============================================================================
-- 0005_fix_generations_status_constraint.sql
-- =============================================================================
-- Same problem as 0004, different table: the live `generations_status_check`
-- only allows 'pending' and 'failed'. Verified by inserting each value via
-- PostgREST — only those two return 201, the rest fail with 23514 even
-- though 0001 declares pending/running/completed/failed/canceled.
--
-- Recreate the constraint with the full list so the backend's pending →
-- running → completed/failed/canceled state machine actually works.
-- =============================================================================

alter table public.generations
    drop constraint if exists generations_status_check;

alter table public.generations
    add constraint generations_status_check
    check (status in (
        'pending',
        'running',
        'completed',
        'failed',
        'canceled'
    ));
