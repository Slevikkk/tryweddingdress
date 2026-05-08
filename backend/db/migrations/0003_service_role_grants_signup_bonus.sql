-- =============================================================================
-- 0003_service_role_grants_signup_bonus.sql
-- =============================================================================
-- Two fixes the backend needs before it can do anything useful:
--
-- 1. Grant `service_role` object-level privileges on the `public` tables.
--    `service_role` already bypasses RLS, but Postgres still enforces
--    table-level GRANTs. Without these, every backend INSERT/SELECT against
--    profiles / generations / credit_ledger / payments / usage_logs / the
--    v_credit_balance view returns `42501 permission denied` (verified live
--    on the project).
--
-- 2. Auto-grant a signup bonus of 3 credits to every new user. We do this
--    by extending the existing `handle_new_user` trigger so the same
--    `security definer` function that creates the profile row also writes
--    the ledger entry, atomically.
--
-- Idempotent: re-running is safe.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Service-role GRANTs
-- ---------------------------------------------------------------------------
grant usage on schema public to service_role;

grant select, insert, update, delete on public.profiles      to service_role;
grant select, insert, update, delete on public.generations   to service_role;
grant select, insert, update, delete on public.payments      to service_role;
grant select, insert, update, delete on public.credit_ledger to service_role;
grant select, insert, update, delete on public.usage_logs    to service_role;
grant select                          on public.v_credit_balance to service_role;

-- Future-proof: tables created later in `public` will be granted to service_role
-- automatically (saves us from forgetting on every new migration).
alter default privileges in schema public
    grant select, insert, update, delete on tables to service_role;

-- ---------------------------------------------------------------------------
-- 2. Signup bonus
-- ---------------------------------------------------------------------------
-- Each new auth.users row triggers `handle_new_user`, which already inserts
-- a `profiles` row. Extend it to also drop a 3-credit signup_bonus into
-- `credit_ledger`. Function runs as `security definer`, so it bypasses RLS
-- and doesn't need the user's own privileges.
--
-- The credit_ledger insert is guarded by a NOT EXISTS so re-running on an
-- existing user (e.g. via manual replay) doesn't double-grant.

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
    insert into public.profiles (id, email, full_name, avatar_url)
    values (
        new.id,
        new.email,
        coalesce(new.raw_user_meta_data->>'full_name', null),
        coalesce(new.raw_user_meta_data->>'avatar_url', null)
    )
    on conflict (id) do nothing;

    insert into public.credit_ledger (user_id, amount, reason, notes)
    select new.id, 3, 'signup_bonus', 'Welcome to Try Wedding Dress'
    where not exists (
        select 1 from public.credit_ledger
        where user_id = new.id and reason = 'signup_bonus'
    );

    return new;
end;
$$;
-- Trigger `on_auth_user_created` from 0001 keeps pointing at this function;
-- replacing the function body is enough — no DROP / CREATE TRIGGER needed.

-- ---------------------------------------------------------------------------
-- 3. Backfill existing users who pre-date the bonus
-- ---------------------------------------------------------------------------
-- For users created before this migration who never got a signup_bonus,
-- grant one now so the staging test user (slavaplaybug) plus any future
-- ones added during dev have a known starting balance.
insert into public.credit_ledger (user_id, amount, reason, notes)
select u.id, 3, 'signup_bonus', 'Backfill: signup bonus added retroactively'
  from auth.users u
 where not exists (
        select 1 from public.credit_ledger l
         where l.user_id = u.id and l.reason = 'signup_bonus'
 );
