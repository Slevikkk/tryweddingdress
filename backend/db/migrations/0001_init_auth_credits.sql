-- =============================================================================
-- 0001_init_auth_credits.sql
-- =============================================================================
-- Initial schema for Try Wedding Dress: user profiles, generation history,
-- payments, credit ledger, and usage logs. Designed for Supabase (Postgres
-- + Auth + Storage + RLS).
--
-- Idempotent: safe to re-run. The Supabase project at
--   https://uqevnxxorffumbzwldkx.supabase.co
-- already has this schema applied; this file is committed so future
-- environments can recreate it.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
-- One row per authenticated user, keyed to auth.users.id. A trigger inserts
-- a row automatically on signup so the rest of the app can always assume a
-- profile exists.

create table if not exists public.profiles (
    id               uuid        primary key references auth.users(id) on delete cascade,
    email            text        not null,
    full_name        text,
    avatar_url       text,
    marketing_opt_in boolean     not null default false,
    created_at       timestamptz not null default now(),
    updated_at       timestamptz not null default now()
);

create index if not exists profiles_email_idx on public.profiles (email);

-- updated_at trigger
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
    before update on public.profiles
    for each row execute function public.set_updated_at();

-- Auto-create profile on signup
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

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- generations
-- ---------------------------------------------------------------------------
-- One row per try-on attempt (queued / running / completed / failed).
create table if not exists public.generations (
    id                uuid        primary key default gen_random_uuid(),
    user_id           uuid        not null references auth.users(id) on delete cascade,
    dress_id          text        not null,
    dress_name        text        not null,
    dress_image_url   text        not null,
    input_photo_url   text,
    result_photo_url  text,
    status            text        not null default 'pending'
                                  check (status in ('pending','running','completed','failed','canceled')),
    error_message     text,
    duration_ms       integer,
    fashn_request_id  text,
    created_at        timestamptz not null default now(),
    completed_at      timestamptz,
    deleted_at        timestamptz
);

create index if not exists generations_user_idx
    on public.generations (user_id, created_at desc);
create index if not exists generations_status_idx
    on public.generations (status);

-- ---------------------------------------------------------------------------
-- payments
-- ---------------------------------------------------------------------------
-- Audit log of every payment processor event we receive (Stripe / LemonSqueezy
-- / etc). Idempotent on (processor, processor_id) to safely accept webhook
-- replays.
create table if not exists public.payments (
    id               uuid        primary key default gen_random_uuid(),
    user_id          uuid        not null references auth.users(id) on delete cascade,
    processor        text        not null,
    processor_id     text        not null,
    amount_cents     integer     not null,
    currency         text        not null default 'USD',
    credits_granted  integer     not null default 0,
    status           text        not null
                                 check (status in ('pending','succeeded','failed','refunded')),
    raw_event        jsonb,
    created_at       timestamptz not null default now(),
    constraint payments_processor_unique unique (processor, processor_id)
);

create index if not exists payments_user_idx on public.payments (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- credit_ledger
-- ---------------------------------------------------------------------------
-- Append-only ledger. Positive amounts grant credits (purchase, signup bonus,
-- promo). Negative amounts spend them (a successful generation). Current
-- balance = sum(amount). Never UPDATE/DELETE rows here; always insert a
-- compensating entry instead.
create table if not exists public.credit_ledger (
    id            uuid        primary key default gen_random_uuid(),
    user_id       uuid        not null references auth.users(id) on delete cascade,
    amount        integer     not null,
    reason        text        not null
                              check (reason in (
                                  'signup_bonus','purchase','generation','refund',
                                  'promo','admin_adjustment','reversal'
                              )),
    reference_id  uuid,
    notes         text,
    created_at    timestamptz not null default now()
);

create index if not exists credit_ledger_user_idx on public.credit_ledger (user_id, created_at desc);
create index if not exists credit_ledger_reference_idx on public.credit_ledger (reference_id);

-- View exposing current credit balance per user.
create or replace view public.v_credit_balance as
    select user_id, coalesce(sum(amount), 0)::int as balance
      from public.credit_ledger
     group by user_id;

-- ---------------------------------------------------------------------------
-- usage_logs
-- ---------------------------------------------------------------------------
-- Lightweight analytics / abuse-protection log. user_id is nullable for
-- anonymous events. ip_hash is a salted hash, never the raw IP.
create table if not exists public.usage_logs (
    id          uuid        primary key default gen_random_uuid(),
    user_id     uuid        references auth.users(id) on delete set null,
    event       text        not null,
    metadata    jsonb       not null default '{}'::jsonb,
    ip_hash     text,
    user_agent  text,
    created_at  timestamptz not null default now()
);

create index if not exists usage_logs_user_idx on public.usage_logs (user_id, created_at desc);
create index if not exists usage_logs_event_idx on public.usage_logs (event, created_at desc);

-- ===========================================================================
-- Row-Level Security
-- ===========================================================================
alter table public.profiles      enable row level security;
alter table public.generations   enable row level security;
alter table public.payments      enable row level security;
alter table public.credit_ledger enable row level security;
alter table public.usage_logs    enable row level security;

-- profiles: a user can read & update only their own row. Inserts go through
-- the on_auth_user_created trigger (security definer), so no INSERT policy.
drop policy if exists profiles_self_select on public.profiles;
create policy profiles_self_select on public.profiles
    for select using (auth.uid() = id);

drop policy if exists profiles_self_update on public.profiles;
create policy profiles_self_update on public.profiles
    for update using (auth.uid() = id) with check (auth.uid() = id);

-- generations: the owning user can read their own; writes go through the
-- backend with the service role.
drop policy if exists generations_self_select on public.generations;
create policy generations_self_select on public.generations
    for select using (auth.uid() = user_id and deleted_at is null);

-- payments: read-only to the owning user.
drop policy if exists payments_self_select on public.payments;
create policy payments_self_select on public.payments
    for select using (auth.uid() = user_id);

-- credit_ledger: read-only to the owning user.
drop policy if exists credit_ledger_self_select on public.credit_ledger;
create policy credit_ledger_self_select on public.credit_ledger
    for select using (auth.uid() = user_id);

-- usage_logs: not readable from the client at all. The backend (service role)
-- bypasses RLS, so no SELECT policy is needed here.

-- ===========================================================================
-- Storage buckets
-- ===========================================================================
-- Two private buckets:
--   inputs/<user_id>/...   uploaded model photo
--   results/<user_id>/...  generated try-on result
-- Both are private (signed URLs only). Already created in the live project;
-- the inserts below are idempotent.
insert into storage.buckets (id, name, public)
values ('inputs', 'inputs', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('results', 'results', false)
on conflict (id) do nothing;

-- A user can read/write only objects under their own user-id prefix.
drop policy if exists storage_user_owns_inputs on storage.objects;
create policy storage_user_owns_inputs on storage.objects
    for all to authenticated
    using (
        bucket_id = 'inputs'
        and auth.uid()::text = split_part(name, '/', 1)
    )
    with check (
        bucket_id = 'inputs'
        and auth.uid()::text = split_part(name, '/', 1)
    );

drop policy if exists storage_user_owns_results on storage.objects;
create policy storage_user_owns_results on storage.objects
    for select to authenticated
    using (
        bucket_id = 'results'
        and auth.uid()::text = split_part(name, '/', 1)
    );
