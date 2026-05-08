"""Credit-pack catalogue and a thin async YooKassa client.

We sell three one-time credit packs in rubles. Pricing and credit counts
are LOCKED — see the W3 PR description for the rationale (matched against
Russian wedding-salon physical try-on prices and Bride View on the EN side).

YooKassa API docs: https://yookassa.ru/developers/api

Auth model:
    HTTP Basic with `shop_id:secret_key` from the YooKassa merchant
    dashboard. We never expose these to the browser; everything goes
    through the FastAPI backend.

Idempotency:
    Every YooKassa POST requires an `Idempotence-Key` header. We mint a
    UUID per checkout request so a retried request from the browser
    creates the same payment instead of charging twice.

Webhook verification:
    YooKassa does not sign webhooks. The recommended verification is
    a server-to-server GET /v3/payments/{id} to confirm status
    + an IP allowlist. We do both in main.py.
"""
from __future__ import annotations

import base64
import os
import uuid
from dataclasses import dataclass
from typing import Any, Optional

import aiohttp
from fastapi import HTTPException, status


# ---------------------------------------------------------------------------
# Credit packs
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class CreditPack:
    id: str
    name: str
    credits: int
    amount_rub: int  # full rubles, no kopecks
    description: str

    @property
    def amount_cents(self) -> int:
        # `payments.amount_cents` is integer; we store kopecks (RUB * 100)
        # so the same column works for any currency without precision loss.
        return self.amount_rub * 100

    @property
    def yookassa_amount(self) -> str:
        # YooKassa wants a stringified decimal with two fractional digits.
        return f"{self.amount_rub}.00"


CREDIT_PACKS: dict[str, CreditPack] = {
    "starter": CreditPack(
        id="starter",
        name="Старт",
        credits=10,
        amount_rub=1490,
        description="10 примерок свадебных платьев на Try Wedding Dress",
    ),
    "bride": CreditPack(
        id="bride",
        name="Невеста",
        credits=30,
        amount_rub=2290,
        description="30 примерок свадебных платьев на Try Wedding Dress",
    ),
    "full": CreditPack(
        id="full",
        name="Полный",
        credits=80,
        amount_rub=4690,
        description="80 примерок свадебных платьев на Try Wedding Dress",
    ),
}


def get_pack(pack_id: str) -> CreditPack:
    pack = CREDIT_PACKS.get(pack_id)
    if not pack:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unknown credit pack: {pack_id}",
        )
    return pack


# ---------------------------------------------------------------------------
# YooKassa client
# ---------------------------------------------------------------------------
YOOKASSA_API_URL = "https://api.yookassa.ru/v3"
YOOKASSA_SHOP_ID = os.environ.get("YOOKASSA_SHOP_ID", "")
YOOKASSA_SECRET_KEY = os.environ.get("YOOKASSA_SECRET_KEY", "")


def yookassa_configured() -> bool:
    return bool(YOOKASSA_SHOP_ID and YOOKASSA_SECRET_KEY)


def _basic_auth_header() -> str:
    if not yookassa_configured():
        # 503 — the route is wired up, the operator just hasn't set the
        # secret yet. The frontend translates this to a friendly RU message
        # ("оплата сейчас недоступна") instead of a hard error.
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Payment provider is not configured yet",
        )
    raw = f"{YOOKASSA_SHOP_ID}:{YOOKASSA_SECRET_KEY}".encode("utf-8")
    return "Basic " + base64.b64encode(raw).decode("ascii")


async def _yookassa_request(
    method: str,
    path: str,
    *,
    json: Optional[dict[str, Any]] = None,
    idempotence_key: Optional[str] = None,
) -> dict[str, Any]:
    headers = {
        "Authorization": _basic_auth_header(),
        "Content-Type": "application/json",
    }
    if idempotence_key:
        headers["Idempotence-Key"] = idempotence_key

    url = f"{YOOKASSA_API_URL}{path}"
    timeout = aiohttp.ClientTimeout(total=15)

    async with aiohttp.ClientSession(timeout=timeout) as session:
        async with session.request(method, url, headers=headers, json=json) as resp:
            text = await resp.text()
            if resp.status >= 400:
                raise HTTPException(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    detail=f"YooKassa error ({resp.status}): {text[:300]}",
                )
            try:
                return await resp.json(content_type=None)
            except Exception:
                raise HTTPException(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    detail=f"YooKassa returned non-JSON body: {text[:200]}",
                )


async def create_payment(
    *,
    pack: CreditPack,
    user_id: str,
    user_email: str,
    return_url: str,
) -> dict[str, Any]:
    """Create a YooKassa payment and return the parsed response.

    `metadata.user_id` and `metadata.pack_id` are the only signal we trust
    when fulfilling — the webhook payload echoes them back unchanged so we
    don't have to maintain a side-table mapping payment ids to users.
    """
    payload: dict[str, Any] = {
        "amount": {
            "value": pack.yookassa_amount,
            "currency": "RUB",
        },
        "capture": True,
        "confirmation": {
            "type": "redirect",
            "return_url": return_url,
        },
        "description": pack.description,
        "metadata": {
            "user_id": user_id,
            "pack_id": pack.id,
            "credits": str(pack.credits),
        },
    }
    if user_email:
        payload["receipt"] = {
            "customer": {"email": user_email},
            "items": [
                {
                    "description": pack.description[:128],
                    "quantity": "1.00",
                    "amount": {
                        "value": pack.yookassa_amount,
                        "currency": "RUB",
                    },
                    # 1 = НДС не облагается (самозанятые не платят НДС)
                    "vat_code": 1,
                    # 4 = full prepayment
                    "payment_mode": "full_prepayment",
                    # 4 = service
                    "payment_subject": "service",
                }
            ],
        }
    idempotence_key = str(uuid.uuid4())
    return await _yookassa_request(
        "POST", "/payments", json=payload, idempotence_key=idempotence_key
    )


async def fetch_payment(payment_id: str) -> dict[str, Any]:
    """GET /v3/payments/{id} — used to verify webhooks server-to-server."""
    return await _yookassa_request("GET", f"/payments/{payment_id}")
