# YooKassa setup — RU pivot

This is the RU payment processor we ship in W3 (Stripe and other US/EU
processors block Russian merchants). YooKassa is owned by Sber and
supports Visa, MasterCard, МИР, СБП, Apple Pay, Google Pay. It works
with self-employed (`самозанятые`), ИП, and OOO; commission is ~3.5%.

This document is for the **operator** (the person registering the
shop). When credentials land, drop them into the env vars listed at the
bottom and the W3 PR will go live.

## 1. Register the merchant account (one-time, ~1–3 days)

1. Go to https://yookassa.ru and click "Подключиться".
2. Sign in with **Госуслуги** (or register first if you don't have an
   account).
3. Pick the legal status:
   - **Самозанятый** — easiest, 4–6% налог, no upfront fees, no
     accounting overhead. Recommended for MVP.
   - ИП / OOO — also fine, more bureaucracy.
4. Enter business details:
   - Name on receipts: `Try Wedding Dress`
   - Activity: онлайн-сервис / digital services
   - Site URL: `https://tryweddingdress.com`
   - Description: "AI-примерка свадебных платьев — продажа цифровых
     пакетов примерок"
5. Wait for moderation (~24–72h).

When approved you'll get:
- `shopId` (the numeric merchant id)
- `Секретный ключ` (the API secret — visible **once**, copy it
  immediately to a password manager)

## 2. Configure webhooks

In the YooKassa dashboard → **Настройки** → **Уведомления**:

- URL: `https://tryweddingdress.com/api/yookassa/webhook`
- Events to enable:
  - `payment.succeeded` — fulfill credits
  - `payment.canceled` — mark payment failed (optional but nice)

YooKassa does **not** sign webhooks. The backend verifies notifications
two ways:

1. **Source-IP allowlist** — YooKassa publishes the IPs/ranges that
   send webhooks. The default list is hard-coded in `backend/main.py`
   (`_YOOKASSA_DEFAULT_IP_NETWORKS`). Override with the env var
   `YOOKASSA_WEBHOOK_IPS_ALLOWLIST` (comma-separated CIDRs / IPs) if
   YooKassa updates the list. Set `YOOKASSA_DISABLE_IP_CHECK=1` for
   local development.
2. **Server-to-server re-fetch** — for every notification we receive,
   we call `GET /v3/payments/{id}` with our shop credentials and trust
   only that response. Anyone can spoof a webhook body, but only the
   real shop credentials can read the payment back.

## 3. Receipts (54-ФЗ / самозанятые)

YooKassa can generate cash-register receipts (чеки) automatically. For
самозанятые the simplest config:

- In `Настройки` → `Чеки 54-ФЗ`, choose
  "Самозанятый — формирование чеков через YooKassa".
- Provide your phone number and ИНН.
- We send the receipt fields with every `POST /payments` (see
  `backend/payments.py::create_payment`):
  - `receipt.customer.email` = the buyer's email
  - `receipt.items[].vat_code = 1` (НДС не облагается — самозанятые
    не платят НДС)
  - `receipt.items[].payment_mode = "full_prepayment"`
  - `receipt.items[].payment_subject = "service"`

If you switch to ИП/ООО with a different tax regime later, change the
`vat_code` (1 = НДС не облагается, 6 = НДС 0%, 4 = НДС 20%, etc.) — see
[YooKassa receipts docs](https://yookassa.ru/developers/54fz/parameters-values).

## 4. Test mode

YooKassa test mode is enabled per-shop. In the dashboard, switch to
`Тестовый магазин`, generate a separate `shopId`/`secretKey` pair, and
use those for local testing.

Test cards (Visa):

| Card                  | Outcome        |
|-----------------------|----------------|
| `5555 5555 5555 4444` | succeeds       |
| `5555 5555 5555 4477` | declined       |
| `4111 1111 1111 1026` | requires 3DS, then succeeds |

Any future expiration date and any 3-digit CVV.

Full list: https://yookassa.ru/developers/using-api/testing

## 5. Environment variables

The backend reads four variables from the environment. The Devin
secret manager / Fly secrets / `.env` should set them all four:

| Variable                          | What it is                                         |
|-----------------------------------|----------------------------------------------------|
| `YOOKASSA_SHOP_ID`                | Numeric `shopId` from the dashboard                |
| `YOOKASSA_SECRET_KEY`             | The API secret key                                 |
| `YOOKASSA_WEBHOOK_IPS_ALLOWLIST`  | (optional) Comma-separated CIDR list. Defaults to YooKassa's published IPs. |
| `YOOKASSA_DISABLE_IP_CHECK`       | (optional) `1` to bypass the IP allowlist (local dev only). |

When `YOOKASSA_SHOP_ID` and `YOOKASSA_SECRET_KEY` are unset, the
backend keeps serving every other endpoint normally and `/api/checkout`
returns HTTP 503 with a friendly RU message in the buy modal.

## 6. Pricing & credit packs (locked W3)

Defined once in `backend/payments.py::CREDIT_PACKS`:

| Pack id   | RU name   | Credits | Price    | Per try-on |
|-----------|-----------|---------|----------|------------|
| `starter` | Старт     | 10      | 1 490 ₽  | 149 ₽      |
| `bride`   | Невеста ⭐| 30      | 2 290 ₽  | 76 ₽       |
| `full`    | Полный    | 80      | 4 690 ₽  | 59 ₽       |

If you later change pricing, update `CREDIT_PACKS` AND the static
prices in `frontend/index.html` and `frontend/dashboard.html` (look
for `pricing-price`).

## 7. Operational checklist when keys land

- [ ] Set `YOOKASSA_SHOP_ID` and `YOOKASSA_SECRET_KEY` in Devin org
      secrets (or `.env` for local).
- [ ] Set the same on Fly / production deploy.
- [ ] In the YooKassa dashboard → Уведомления, register
      `https://tryweddingdress.com/api/yookassa/webhook`.
- [ ] Run a sandbox checkout: log in to the app, click "Купить
      кредиты" → "Старт" → pay with test card
      `5555 5555 5555 4444` → land on `/checkout-success.html` →
      verify the dashboard balance increases by 10.
- [ ] Verify the `payments` row in Supabase has
      `processor='yookassa'`, `status='succeeded'`, `credits_granted=10`.
- [ ] Verify the `credit_ledger` row has `reason='purchase'`,
      `amount=10`, `reference_id` matching the payment row id.
- [ ] Switch the dashboard to live mode and repeat with a real card
      for ≤100 ₽ to confirm production wiring.
