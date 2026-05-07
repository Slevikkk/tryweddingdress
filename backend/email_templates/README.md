# Email Templates

These are the **canonical** Supabase Auth email templates for Try Wedding
Dress. They are committed here so the design lives in version control, but
Supabase serves them from the Dashboard — you must copy each file into the
matching Dashboard slot whenever you change one.

| File                         | Supabase template slot               |
| ---------------------------- | ------------------------------------ |
| `confirmation.html`          | Confirm signup                       |
| `recovery.html`              | Reset password                       |
| `magic_link.html`            | Magic link                           |
| `email_change.html`          | Change email address                 |
| `invite.html`                | Invite user                          |

See [`docs/email_setup.md`](../../docs/email_setup.md) for the full deploy
flow (subjects, deliverability tips, warm-up notes).

## Template variables

Supabase substitutes these at send-time:

| Variable               | Where it's used                                 |
| ---------------------- | ----------------------------------------------- |
| `{{ .Email }}`         | Recipient's current address                     |
| `{{ .NewEmail }}`      | The new address (only in `email_change`)        |
| `{{ .ConfirmationURL }}` | One-time link with embedded token             |
| `{{ .Token }}`         | 6-digit OTP (we don't currently use this)       |
| `{{ .SiteURL }}`       | Configured in Supabase Auth → URL Configuration |

## Why these templates exist

1.  **Brand consistency** — champagne accent (`#c5a880`), Playfair Display
    heading, matching the marketing site.
2.  **Deliverability** — the Supabase defaults are 1-line-1-link emails which
    Gmail aggressively flags as spam, especially from a freshly-warmed
    sending domain. These templates include a real greeting, contextual
    body copy, a fallback plain link, a security note, and a footer — all
    signals Gmail uses for "transactional" classification.
3.  **Plain-text fallback** — Supabase auto-generates a plain-text part by
    stripping HTML, so the body copy must be readable when tags are
    removed. Don't put critical info inside images.

## Editing rules

* Use **inline CSS** only. Gmail strips `<style>` blocks.
* Use **table-based layout** for Outlook compatibility.
* Keep `max-width: 560px` (most clients render 600 — leave breathing room).
* Don't add tracking pixels or click-tracking domains. Auth emails should
  be as clean as possible.
* Don't reference local images. Either inline as base64 (≤30 KB) or host on
  the marketing site.
