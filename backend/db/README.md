# Database

Schema for the Try Wedding Dress backend, hosted on **Supabase**
(`https://uqevnxxorffumbzwldkx.supabase.co`).

## Layout

```
migrations/
  0001_init_auth_credits.sql   profiles, generations, payments,
                               credit_ledger, usage_logs, storage buckets,
                               RLS policies
```

## Applying

The current production database has migration `0001` already applied.
To apply to a fresh Supabase project:

1. Open Supabase Studio → SQL Editor.
2. Paste the contents of each migration file in order.
3. Execute.

Every migration is **idempotent** (`create ... if not exists`,
`drop policy if exists ... ; create policy ...`), so re-running is safe.

## Tables

| table           | purpose                                                           |
|-----------------|-------------------------------------------------------------------|
| `profiles`      | One row per Supabase Auth user (auto-created via trigger).         |
| `generations`   | History of try-on attempts (status / result URL / FASHN request). |
| `payments`      | Audit log of payment-processor events (Stripe etc.).              |
| `credit_ledger` | Append-only ledger of credit grants and spends.                    |
| `usage_logs`    | Lightweight events log (analytics, abuse protection).             |

`v_credit_balance` exposes the current credit balance per user as
`sum(credit_ledger.amount)`.

## Row-Level Security

All `public.*` tables have RLS **enabled**. Clients (browser, anon /
authenticated key) can:

- read & update their own `profiles` row;
- read their own non-deleted `generations`;
- read their own `payments` and `credit_ledger`;
- never read `usage_logs` from the browser.

All writes (inserts to `generations`, `payments`, `credit_ledger`,
`usage_logs`) happen on the backend with the **service role** key, which
bypasses RLS. Never put the service role key in client code.

## Storage

Two private buckets, both keyed by user id under the path prefix:

```
inputs/<user_id>/<photo_id>.jpg
results/<user_id>/<generation_id>.png
```

Signed URLs are issued on demand. RLS policies in
`0001_init_auth_credits.sql` restrict each user to their own prefix.
