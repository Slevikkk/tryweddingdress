# Email Setup &mdash; Supabase Auth + Resend

This document is the source of truth for how Try Wedding Dress sends its
authentication emails (signup confirmation, password reset, magic link,
email change, invitations).

## Architecture

```
Supabase Auth  ──SMTP──▶  Resend  ──AWS SES──▶  recipient inbox
   (sender)                (relay)               (Gmail / Apple Mail / …)
```

* **Sender domain**: `tryweddingdress.com`
* **From address**: `noreply@tryweddingdress.com`
* **Friendly name**: `Try Wedding Dress`
* **Return-Path / bounces**: `send.tryweddingdress.com` (MX → SES feedback)
* **Auth records**: SPF + DKIM at the subdomain level, DMARC inherited
  from the parent domain.

## DNS records (Cloudflare)

The following records must exist on `tryweddingdress.com`. Proxy must be
**off** (gray cloud) for every record below — Cloudflare's proxy rewrites
TXT/CNAME content and breaks email auth.

| Type  | Name                             | Content                                                                                                              | Priority |
| ----- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------- | -------- |
| TXT   | `resend._domainkey`              | `p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQC7SfN2pyqI6sq7wRmxdS0tGzzlB4S54Dz1yEdxOxK/N0iNtp3Q5rCt5lAgoIdoGR/8j7wHblV4wSEKN8Zo18ZmyfrC/hO5npFZlrryxfGvK+ZkCPg6Vu17VuMJVH8ob/Ar0M+1VjXDCXuundvB528vbgghA1Jd2Z2ddpi0hpghlwIDAQAB` | —        |
| MX    | `send`                           | `feedback-smtp.us-east-1.amazonses.com`                                                                              | `10`     |
| TXT   | `send`                           | `v=spf1 include:amazonses.com ~all`                                                                                  | —        |

These are owned by Resend (the provider Supabase relays through). If we
rotate provider, all three change.

The pre-existing root SPF (`tryweddingdress.com TXT v=spf1 include:_spf.mx.cloudflare.net ~all`)
serves Cloudflare Email Routing for `info@…` and **must not be merged** with
the SES SPF — they live on different subdomains and authenticate different
envelope senders.

`_dmarc TXT v=DMARC1; p=none; …` is already in place at the apex; both the
root and `send` subdomains inherit a relaxed-alignment DMARC policy.

To verify propagation:

```bash
dig +short TXT  resend._domainkey.tryweddingdress.com  @1.1.1.1
dig +short MX   send.tryweddingdress.com               @1.1.1.1
dig +short TXT  send.tryweddingdress.com               @1.1.1.1
```

## Supabase configuration

### 1. SMTP credentials

`Authentication → Email → SMTP Settings`:

| Field                       | Value                              |
| --------------------------- | ---------------------------------- |
| Enable Custom SMTP          | **on**                             |
| Sender email address        | `noreply@tryweddingdress.com`      |
| Sender name                 | `Try Wedding Dress`                |
| Host                        | `smtp.resend.com`                  |
| Port                        | `465`                              |
| Minimum interval per user   | `60` seconds                       |
| Username                    | `resend`                           |
| Password                    | Resend API key (`re_…`), permission `Sending access` |

> Rotating the API key: create a new key in Resend, paste it into Supabase,
> save, then revoke the old key. Supabase keeps the password encrypted and
> never displays it again, so update procedures from a fresh secret.

### 2. Rate limits

`Authentication → Rate Limits → Email rate limit`: **30 / hour** (or
higher, up to Resend's free quota of 100/day, paid quota is 50k/month at
$20).

The default `3 / hour` is the legacy quota for Supabase's built-in mailer
and is irrelevant once Custom SMTP is enabled.

### 3. Email templates

Each HTML in [`backend/email_templates/`](../backend/email_templates/)
maps to a Dashboard slot at `Authentication → Email Templates`:

| File                    | Slot                  | Subject                                            |
| ----------------------- | --------------------- | -------------------------------------------------- |
| `confirmation.html`     | Confirm signup        | `Confirm your email — Try Wedding Dress`           |
| `recovery.html`         | Reset password        | `Reset your password — Try Wedding Dress`          |
| `magic_link.html`       | Magic link            | `Your sign-in link — Try Wedding Dress`            |
| `email_change.html`     | Change email address  | `Confirm your new email — Try Wedding Dress`       |
| `invite.html`           | Invite user           | `You're invited to Try Wedding Dress`              |

To deploy a template change:

1. Open the Dashboard slot.
2. Paste the **subject** from the table above.
3. Paste the contents of the matching `.html` file into the message body
   (replace the entire field — Supabase doesn't merge).
4. Save.
5. Trigger a real send (e.g. the recovery flow against a test mailbox)
   and inspect headers: `Authentication-Results` should show
   `dkim=pass`, `spf=pass`, and DMARC pass.

## Deliverability checklist

When you start sending from a brand-new domain, the first batch tends to
land in **Spam** even with perfect DNS. This is "Brand-New Domain"
penalty in Gmail's spam filter — it does not indicate a misconfigured
setup.

To accelerate domain warm-up:

1. Send the first ~50 emails to addresses you control, mark each
   "Not spam", and reply once if possible. Gmail trusts engagement
   signals more than any technical record.
2. Avoid promotional content in the first weeks. Stick to transactional
   only (confirmation, reset).
3. Watch the Resend → Logs page for any `bounce` or `complained` events
   — investigate immediately, both directly damage reputation.
4. Consider tightening DMARC from `p=none` to `p=quarantine` once you
   are confident SPF and DKIM are passing on every send (check headers
   for at least a week first).

For diagnostics, view a delivered message in Gmail and use **Show
original** — you want to see:

```
Authentication-Results: mx.google.com;
       dkim=pass header.i=@tryweddingdress.com header.s=resend …
       spf=pass (google.com: domain of bounces+…@send.tryweddingdress.com …)
       dmarc=pass (p=NONE sp=NONE dis=NONE) header.from=tryweddingdress.com
```

If any of those is `fail`, fix that before warming up further — Gmail
tolerates a brand-new sender, it does not tolerate a misconfigured one.

## Apply the credit-balance RLS fix

Once the email setup is live, also apply the `0002` migration to plug the
RLS leak in `v_credit_balance` (see migration file for the rationale):

```bash
# Option A — psql with the project DB URL
psql "$SUPABASE_DB_URL" -f backend/db/migrations/0002_fix_v_credit_balance_rls.sql

# Option B — Dashboard
#   SQL Editor → New query → paste contents of the migration → Run
```

Verify after running:

```sql
-- Should return only the caller's row when run with an end-user JWT.
select * from public.v_credit_balance;
```
