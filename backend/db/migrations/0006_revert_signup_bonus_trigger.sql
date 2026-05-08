-- =============================================================================
-- 0006_revert_signup_bonus_trigger.sql
-- =============================================================================
-- Product decision (W2): no free trial credits at signup. Three credits per
-- new account is exploitable via gmail+alias farming and would burn FASHN
-- spend. Until W3 ships paid plans + payment-time CAPTCHA, every new user
-- starts at balance = 0 and can only generate after a manual admin grant.
--
-- This migration reverts ONLY the credit_ledger insert added in 0003. The
-- service_role GRANTs and the profile-row insert stay — those are still
-- needed and are unrelated to the trial-credit policy.
--
-- Existing users who already received a signup_bonus row (the test user, any
-- accounts created during W1/W2 development) keep their balance. We are not
-- clawing anything back; we just stop minting new free credits.
--
-- Idempotent: re-running is safe.
-- =============================================================================

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

    return new;
end;
$$;
