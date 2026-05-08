# Try Wedding Dress — session handoff document

**Last updated:** 2026-05-08

This document is the source of truth when picking up work on this
project from a fresh Devin session. **Read it end-to-end before doing
anything.** Trust this file over your priors.

---

## 1. Where we are

Try Wedding Dress is an AI-powered virtual try-on web app for wedding
dresses, deployed at **https://tryweddingdress.com**. The product
generates "this woman in this dress" images on the FASHN AI
`tryon-max` Quality model (3 credits per call) so brides can see
themselves in dozens of dresses without going to salons.

We've shipped W1 (auth) and W2 (try-on + credits + payments-ready
schema), both merged. We are mid-flight on **W3 — RU pivot +
YooKassa payments**, which is what you have to finish.

### Status by week

| Week | Status | PR |
|---|---|---|
| W1 — Supabase auth, signup/login/dashboard, branded emails | ✅ merged | PR #1, PR #2, PR #3 (reset password) |
| W2 — auth-gated try-on, credit ledger, FASHN integration, generations | ✅ merged | PR #4 |
| **W3 — RU localization + YooKassa checkout** | 🟡 **in flight on branch `devin/1778233382-w3-ru-pivot-yookassa`** | PR #5 — **not yet created** (compare URL below) |

---

## 2. Active branch + PR state

- **Branch:** `devin/1778233382-w3-ru-pivot-yookassa`
- **Base:** `initial-import` (the project's default branch — **not** `main`/`master`)
- **HEAD commit:** `bdb7aed Week 3: RU localization + YooKassa checkout`
- **Diff vs base:** ~1434 +, 216 −, 20 files
- **Compare URL (where PR #5 will be opened):**
  https://github.com/Slevikkk/tryweddingdress/compare/initial-import...devin/1778233382-w3-ru-pivot-yookassa?expand=1
- **PR #5 body draft:** keep on disk at `/tmp/pr5_body.md` from the
  previous session, or regenerate from this file's section 7.

⚠️ **PR #5 has not been opened yet.** The previous Devin tried via
`git_pr(action="create")` and got a 404 — the org's GH_PAT lacks
`pull-requests:write` scope. The user must click the compare URL above
and open the PR through GitHub's web UI. **Don't keep retrying the
API.**

---

## 3. The user / operator (you'll need this for the оферта + чеки)

- **ФИО:** Макаров Вячеслав Александрович
- **ИНН:** `682963575774` (12 digits — самозанятый)
- **Тел:** `+7 996 131-00-15`
- **Email:** `info@tryweddingdress.com` (Cloudflare Email Routing → personal Gmail)
- **Город:** Тамбов (region code 68 in the ИНН matches)
- **Дата начала услуги (для оферты):** "с момента оплаты" (no fixed
  date — standard for digital subscriptions)

These values are **public** (they appear on the contacts page, the
оферта, and on every 54-ФЗ чек). They are not secrets. Treat them as
public config.

---

## 4. The pivot decision (don't re-litigate this)

The user is based in Russia. They tried Stripe — Stripe blocks RU
merchants. They tried Lemon Squeezy / Paddle / Polar — all block RU
merchants. The previous Devin walked them through three options:

A. Stripe Atlas (US LLC, ~$700, 3-4 weeks)
B. Doola/Firstbase (~$450, 4-5 weeks)
C. Estonia e-Residency (~$1100/yr, 2-3 weeks)
**D. RU pivot via YooKassa (free, samozanyatost, 1-3 days)** ← chosen

The user picked D. We are **not** revisiting this. The product is
being repositioned as RU-first because:

- **No direct RU competitor exists.** Real research found
  wedding.one/ru, somake.ai/ru, a1.art/ru — all generic AI tools, none
  RU-specialized for bridal try-on.
- **Validated demand.** Russian wedding salons charge ~5000₽ per
  physical try-on — our 1490–4690₽ packs of 10–80 try-ons are an easy
  sell.
- **Self-employed (самозанятый)** = 4-6% налог on revenue, no upfront
  fees, no accounting overhead.

Pricing is **locked** at:

| Pack id | Name | Try-ons | Price |
|---|---|---|---|
| `starter` | Старт | 10 | 1490 ₽ |
| `bride` | Невеста (★ recommended) | 30 | 2290 ₽ |
| `full` | Полный | 80 | 4690 ₽ |

These prices appear in **three places** and must stay synchronized:

1. `backend/payments.py` → `CREDIT_PACKS` dict
2. `frontend/index.html` → buy-credits modal (lines ~211–234)
3. `frontend/dashboard.html` → buy-credits modal (lines ~72–93)

If the user wants to change pricing, change all three.

---

## 5. What's done in this branch (W3)

Full RU localization:

- All HTML files (`index.html`, `signup.html`, `login.html`,
  `reset-password.html`, `dashboard.html`) → `lang="ru"`, all copy
  translated idiomatically.
- `frontend/app.js`, `frontend/auth.js` — all alerts, error messages,
  modal copy, button labels.
- 5 Supabase Auth email templates: `confirmation.html`,
  `recovery.html`, `magic_link.html`, `invite.html`, `email_change.html`.

YooKassa backend skeleton (no creds yet — endpoints return 503 until
env vars are set):

- `backend/payments.py` — `CREDIT_PACKS` config + async YooKassa
  client (HTTP Basic auth, Idempotence-Key, 54-ФЗ receipt fields:
  `vat_code=1`, `payment_subject="service"`,
  `payment_mode="full_prepayment"`).
- `backend/db.py` — `insert_payment`, `get_payment_by_processor_id`,
  `update_payment_status`, `has_purchase_grant` helpers (idempotent
  via `(processor, processor_id)` UNIQUE constraint, returns None on
  duplicate).
- `backend/main.py` — three new endpoints:
  - `GET /api/credit-packs` — public, returns list of 3 packs
  - `POST /api/checkout` — auth-required, creates a YooKassa payment
    and returns `confirmation_url`
  - `POST /api/yookassa/webhook` — IP allowlist (hardcoded YooKassa
    ranges) + server-to-server re-fetch of payment + idempotent insert
    + credit_ledger guard.
  - `/api/health` now reports `yookassa_configured`.

Frontend buy-credits flow:

- `frontend/buy-credits.js` — opens modal, calls `/api/checkout`,
  redirects to `confirmation_url`, friendly RU error messages
  (including 503 handling).
- `frontend/checkout-success.html` — polls `/api/credit-balance` every
  2s for up to 30s after redirect-back from YooKassa.
- `frontend/checkout-cancel.html` — friendly cancel page.
- "Out of credits" modal in `index.html` now links one-click to the
  buy-credits modal.

Docs:

- `docs/yookassa_setup.md` — full operator runbook for registration,
  webhook config, 54-ФЗ receipts, test mode, env vars,
  post-launch checklist.
- `README.md` — env vars updated.

---

## 6. What's **left** to ship in W3 — read this carefully

The user got blocked on YooKassa registration at the "Платежи на
сайте" step where YooKassa lists 4 site-content requirements:

1. **Public products / prices / descriptions** — our pricing is
   currently only inside a modal that requires login. **You need to
   add a public `/pricing.html`.**
2. **Delivery / fulfillment info** — currently nowhere on the site.
3. **Оферта / пользовательское соглашение** — `terms.html` is in
   English and doesn't include our ИНН/реквизиты. **You need to add
   `/offer.html` in Russian, formatted as a public-offer contract for
   a самозанятый, including the operator's ИНН and full name.**
4. **Контакты + реквизиты** — currently just a `mailto:` link. **You
   need to add `/contacts.html` with operator's ФИО, ИНН, email,
   phone, city.**

Plus, for completeness:

5. **Translate `frontend/privacy.html` to Russian** (currently EN).
6. **Translate `frontend/terms.html` to Russian** (currently EN). It
   can stay as a "User Agreement" (правила использования) in addition
   to the formal оферта.
7. **Update the footer on every page** (`index.html`, `dashboard.html`,
   `signup.html`, `login.html`, `reset-password.html`,
   `checkout-success.html`, `checkout-cancel.html`) to link
   Pricing / Offer / Contacts / Privacy / Terms.

Use the operator info from section 3 of this doc verbatim.

The `policy-shell` CSS class and `auth.css` styles already exist —
re-use them. Style patterns:

- `<article class="policy-shell">` for long-form text pages.
- `.pricing-grid` / `.pricing-card` / `.pricing-featured` /
  `.pricing-badge` / `.pricing-name` / `.pricing-tries` /
  `.pricing-price` / `.pricing-per` / `.pricing-buy` for pricing cards
  (already used in modals, just reuse on a public page).

After all of that:

8. Commit and push to the **same branch**
   (`devin/1778233382-w3-ru-pivot-yookassa`) — no new branch.
9. Tell the user to merge PR #5 (after merge, Cloudflare deploy is
   automatic).
10. The user returns to the YooKassa form and submits with
    https://tryweddingdress.com/ as the site and the new pages as
    "Page with requisites" (any URL on the site that shows ИНН works,
    so `https://tryweddingdress.com/contacts.html` is the right one).
11. YooKassa moderation: 1-3 days.
12. When approved, the user creates a **demo store** in the YooKassa
    dashboard (right side menu → "Демонстрационный магазин") to get a
    test `shopId` + `secretKey` immediately, ahead of approval.
13. They give you the keys via `secrets` tool — `YOOKASSA_SHOP_ID`,
    `YOOKASSA_SECRET_KEY` (org-scoped, save_scope="org"). With those
    you E2E-test (logged-out → buy → test card → webhook → +N
    credits) and record a session.

The pop-quiz mode is OFF — work in normal mode. Use the todo list and
push frequently.

---

## 7. PR #5 description (paste this into GitHub when opening PR)

```markdown
## Summary

Week 3: RU pivot to a Russian-first product + YooKassa payment
integration. Translates the entire frontend (HTML, JS strings, alert
modals) and all 5 Supabase Auth email templates into Russian. Wires
up a complete YooKassa checkout flow (3 credit packs at 1490/2290/4690 ₽
for 10/30/80 try-ons) with idempotent webhook handling, IP allowlist
verification, and 54-ФЗ receipt generation for self-employed merchants
(`vat_code=1`, `payment_subject="service"`,
`payment_mode="full_prepayment"`).

The integration is live-ready but inert until `YOOKASSA_SHOP_ID` and
`YOOKASSA_SECRET_KEY` are set — checkout returns 503 with a friendly
message ("Оплата сейчас недоступна"), and the dashboard shows the buy
modal but the buttons return the same 503. Safe to merge before
YooKassa account approval.

## Implementation notes

- **Pricing locked in 3 places**: `backend/payments.py::CREDIT_PACKS`,
  `frontend/index.html` modal, `frontend/dashboard.html` modal.
  Changing prices needs all three.
- **Idempotent webhooks**: existing UNIQUE on `(processor,
  processor_id)` in `payments` gives free dedup. `insert_payment`
  returns None on a 23505 duplicate. `has_purchase_grant` guards the
  credit ledger insert.
- **No webhook signature**: YooKassa doesn't sign notifications.
  Verification is two-layer — source-IP allowlist (hardcoded ranges,
  override with `YOOKASSA_WEBHOOK_IPS_ALLOWLIST` env var) + a
  server-to-server `GET /v3/payments/{id}` to re-fetch the truth.
- **0007 migration unnecessary** — the existing `payments` schema
  from 0001 already supports all four status values.
- **Local dev**: `YOOKASSA_DISABLE_IP_CHECK=1` to replay webhooks from
  127.0.0.1.

## Testing

- `/api/health` → `yookassa_configured: false` ✓
- `/api/credit-packs` → 3 packs with RU names ✓
- `POST /api/checkout` without auth → 401 ✓
- `POST /api/yookassa/webhook` from loopback → 403 (IP not allowed) ✓
- `POST /api/yookassa/webhook` with `X-Forwarded-For: 185.71.76.5` →
  IP passes, falls through to 503 (no creds) ✓

E2E with real test card pending YooKassa shop approval (~1-3 days
from user-side registration).

## Operator info baked into legal pages

- ФИО: Макаров Вячеслав Александрович
- ИНН: 682963575774
- Тел: +7 996 131-00-15
- Email: info@tryweddingdress.com
- Город: Тамбов

## Pending

- [ ] Public `/pricing.html` + `/offer.html` + `/contacts.html`
- [ ] Translate `privacy.html` + `terms.html` → RU
- [ ] Footer links on every page
- [ ] User registers YooKassa via Госуслуги → samozanyatost
- [ ] User provides `YOOKASSA_SHOP_ID` + `YOOKASSA_SECRET_KEY` via
      secrets manager
- [ ] E2E test with sandbox card + recording
- [ ] (W4) Cloudflare Turnstile on signup
```

---

## 8. Tech stack & repo layout

- **Backend:** FastAPI, served by uvicorn. Talks to Supabase (Postgres
  + Auth + Storage + RLS) using the `service_role` key, and to
  FASHN AI's `tryon-max` Quality model. New in W3: also talks to
  YooKassa Payment API v3.
- **Frontend:** Plain HTML/CSS/JS, no framework. Three pages with
  Supabase JS SDK: `index.html`, `signup.html`, `login.html`,
  `reset-password.html`, `dashboard.html`. Backend serves it from
  `frontend/`.
- **DB:** Supabase project `uqevnxxorffumbzwldkx`
  (`https://uqevnxxorffumbzwldkx.supabase.co`). Schema in
  `backend/db/migrations/000{1..6}.sql` — all idempotent. Already
  applied to live Supabase. Don't re-apply unless schema changes.

```
backend/                FastAPI app
  main.py               app entrypoint, routes
  auth.py               JWT verification via Supabase
  db.py                 thin async DB layer (httpx)
  payments.py           NEW in W3 — YooKassa client + CREDIT_PACKS
  email_templates/      Brevo/Supabase email HTML (RU)
  db/migrations/        SQL migrations 0001..0006
frontend/               HTML/CSS/JS app
  app.js                main try-on logic
  auth.js               Supabase auth wrapper (window.TWD_AUTH)
  buy-credits.js        NEW in W3 — buy-credits modal
  *.html                pages
  style.css, auth.css   styles
docs/                   docs (yookassa_setup.md, email_setup.md, …)
catalog/                David's Bridal catalog (41 dresses)
website_examples/       before/after pairs for the Examples section
scripts/                catalog scraper, FASHN smoke test
```

---

## 9. Local dev

```bash
# Clone
git clone https://github.com/Slevikkk/tryweddingdress.git
cd tryweddingdress
git checkout devin/1778233382-w3-ru-pivot-yookassa

# Install deps (uses uv, not pip)
uv sync

# Env vars (the ones you'll need re-saved in account #2 — see section 11)
export FASHN_API_KEY=sk-...
export SUPABASE_URL=https://uqevnxxorffumbzwldkx.supabase.co
export SUPABASE_SERVICE_ROLE_KEY=eyJ...     # Supabase dashboard → Settings → API
# YooKassa not yet — set after user approves shop:
# export YOOKASSA_SHOP_ID=...
# export YOOKASSA_SECRET_KEY=...
# export YOOKASSA_DISABLE_IP_CHECK=1       # local only — bypass IP check

# Run
uv run uvicorn backend.main:app --reload --port 8000
# → serves frontend/ + /api/* on http://localhost:8000/
```

Smoke tests:

```bash
curl -s http://127.0.0.1:8000/api/health
curl -s http://127.0.0.1:8000/api/credit-packs | jq .
curl -i -X POST http://127.0.0.1:8000/api/checkout \
  -H 'Content-Type: application/json' \
  -d '{"pack_id":"starter","return_url":"http://localhost:8000/checkout-success.html"}'
# → 401 (unauthorized) without bearer token

curl -i -X POST http://127.0.0.1:8000/api/yookassa/webhook \
  -H 'Content-Type: application/json' \
  -d '{"event":"payment.succeeded"}'
# → 403 from loopback (IP not allowed)
```

---

## 10. Conventions (from W1/W2)

- **Branch naming:** `devin/$(date +%s)-<slug>` — keep the unix
  timestamp prefix for ordering.
- **Default branch:** `initial-import` (NOT `main`/`master`). Don't
  retarget PRs.
- **No pre-commit hooks** in this repo (no `.pre-commit-config.yaml`),
  no lint/typecheck CI yet — but **always run `uv run python -c
  "import backend.main"`** before pushing to catch import errors.
- **GitHub PR creation via Devin's `git_pr` tool fails** because the
  org's GH_PAT lacks `pull-requests:write`. Always give the user the
  compare URL and ask them to open the PR in the GitHub web UI.
- **Don't `gh` CLI** for PR ops. Use `git_pr(action="view_pr")` and
  `git(action="pr_checks")` — those work because they're read-only.
- **Don't commit `.env`, secrets, or `backend/uploads/*`** — see
  `.gitignore`.
- **Don't downgrade FASHN `generation_mode` from `"quality"`** —
  user requirement.
- **Don't add subscription billing** — one-time credit packs only.
- **Don't merge PRs** — leave them open for the user to review.
- **Don't deploy to production without user approval.**

---

## 11. Secrets you need to re-add in the new account

When you wake up in Devin account #2, the following org-scoped secrets
**will not exist** because Devin secrets don't cross orgs. The user
must re-save them via the `secrets` tool with `should_save=true,
save_scope="org"`. Ask the user for them all at once in your first
message after reading this doc.

| Secret name | Where to find | Type |
|---|---|---|
| `SUPABASE_URL` | Public — `https://uqevnxxorffumbzwldkx.supabase.co` | plain |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase dashboard → Project `uqevnxxorffumbzwldkx` → Settings → API → `service_role` | plain (sensitive) |
| `FASHN_API_KEY` | https://app.fashn.ai → API Keys | plain (sensitive) |
| `YOOKASSA_SHOP_ID` | After YooKassa demo store created — see `docs/yookassa_setup.md` | plain — pending |
| `YOOKASSA_SECRET_KEY` | After YooKassa demo store created | plain (sensitive) — pending |

`SUPABASE_ANON_KEY` is **public** and is hardcoded in
`frontend/auth.js`. Don't store it as a secret.

---

## 12. External services state

- **Supabase project `uqevnxxorffumbzwldkx`** — schema applied (0001..0006),
  RLS configured, `service_role` grants set, signup-bonus trigger
  reverted. Test user: `slavaplaybug@gmail.com`,
  user_id `0c02c094-001c-40aa-8109-843461731768`. **Don't** create
  another Supabase project — keep this one.
- **FASHN AI** — Quality 1K model. Each try-on is 3 credits. COGS is
  fixed at 17.55 ₽/try-on per the user's own arithmetic — keep margin
  at 70-83% with current pricing.
- **Cloudflare** — DNS, CDN, Worker (serves the static demo at
  tryweddingdress.com), Email Routing (`info@` → user's Gmail).
  Owned by the user; you don't touch this.
- **Brevo** — transactional email (Supabase Auth uses it via SMTP
  relay). Templates in `backend/email_templates/`. Already RU.
- **YooKassa** — registration in flight on user side (was at the
  "Платежи на сайте" step when previous session ended). User needs to
  finish W3 site changes first, then resubmit.

---

## 13. Kickoff prompt for the new Devin

Paste this verbatim into the new chat in Devin account #2 to start:

```
Привет! Я продолжаю работу над репо Slevikkk/tryweddingdress, ветка
devin/1778233382-w3-ru-pivot-yookassa.

Прочитай HANDOFF.md в корне репо целиком, дальше двигайся по разделу
"6. What's left to ship in W3" — там детальный список того что осталось.

Сразу запроси у меня через secrets manager (как должно быть с
should_save=true, save_scope="org"):
- SUPABASE_URL (значение публичное, я скажу)
- SUPABASE_SERVICE_ROLE_KEY (я возьму из Supabase dashboard)
- FASHN_API_KEY (я возьму из app.fashn.ai)

YOOKASSA_* пока не нужны.

Не создавай новую ветку — работай в существующей. Не мёржи PR. Не
меняй цены 1490/2290/4690 ₽. Не трогай FASHN generation_mode. Не делай
подписочную модель.

Давай.
```

---

## 14. Anything I'd want my future self to know

- **Pop-quiz mode** existed in the previous session — system would
  inject `STARTING POP QUIZ` and require a non-tool answer. It is OFF
  in normal sessions; if it ever turns on, just answer honestly.
- **The user prefers Russian** for all communication. Reply in Russian
  unless they switch to English.
- **The user is non-technical-but-curious.** When showing them
  filesystem paths or curl commands, label what they are and why. They
  appreciate honesty about what we can't do (see the
  Stripe-not-supported-in-RU conversation).
- **Don't fabricate competitor names.** The previous Devin lost
  credibility once by inventing "Veroniqa" and "Wedify". Always run
  `web_search` and link real URLs.
- **The user steps away sometimes** with "сделай всё что можешь без
  меня". When that happens, persist the work, push commits, leave
  blocking messages only when truly blocked, and document blockers
  clearly so they can unblock when back.
