"""Thin async client for the Supabase Postgres REST API.

We talk to Postgres via PostgREST so we don't need a Postgres driver in
the deployment image. The client uses the **service-role key** and
therefore bypasses RLS — keep this module out of any code path that
runs on the user's behalf without their identity already verified.

What we actually need from the DB right now:

  - get_credit_balance(user_id)       -> int
  - insert_credit(user_id, amount, reason, reference_id) -> ledger row id
  - insert_generation(user_id, dress_id, dress_name, dress_image_url,
                      input_photo_url) -> generation row id
  - update_generation(generation_id, **fields)
"""
from __future__ import annotations

import os
from typing import Any, Optional

import aiohttp
from fastapi import HTTPException, status

SUPABASE_URL = os.environ.get(
    "SUPABASE_URL", "https://uqevnxxorffumbzwldkx.supabase.co"
)
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")


def _service_headers() -> dict[str, str]:
    if not SUPABASE_SERVICE_ROLE_KEY:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="SUPABASE_SERVICE_ROLE_KEY not configured",
        )
    return {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        "Content-Type": "application/json",
    }


async def _request(
    method: str,
    path: str,
    *,
    params: Optional[dict[str, str]] = None,
    json: Optional[dict[str, Any] | list[dict[str, Any]]] = None,
    prefer: Optional[str] = None,
) -> Any:
    """Issue one PostgREST call with the service-role key.

    Returns the parsed JSON body. Raises 500 on transport / auth errors so
    the caller sees a clean failure rather than a half-finished operation.
    """
    headers = _service_headers()
    if prefer:
        headers["Prefer"] = prefer

    url = f"{SUPABASE_URL}{path}"
    timeout = aiohttp.ClientTimeout(total=10)

    async with aiohttp.ClientSession(timeout=timeout) as session:
        async with session.request(
            method, url, params=params, json=json, headers=headers
        ) as resp:
            text = await resp.text()
            if resp.status >= 400:
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail=f"DB error ({resp.status}): {text[:300]}",
                )
            if not text:
                return None
            try:
                return await resp.json(content_type=None)
            except Exception:
                return text


async def get_credit_balance(user_id: str) -> int:
    """Sum the user's ledger rows. Returns 0 if no rows exist yet."""
    rows = await _request(
        "GET",
        "/rest/v1/credit_ledger",
        params={
            "select": "amount",
            "user_id": f"eq.{user_id}",
        },
    )
    if not rows:
        return 0
    return sum(int(r["amount"]) for r in rows)


async def insert_credit(
    user_id: str,
    amount: int,
    reason: str,
    *,
    reference_id: Optional[str] = None,
    notes: Optional[str] = None,
) -> str:
    """Append one row to credit_ledger and return its id."""
    body: dict[str, Any] = {
        "user_id": user_id,
        "amount": amount,
        "reason": reason,
    }
    if reference_id is not None:
        body["reference_id"] = reference_id
    if notes is not None:
        body["notes"] = notes

    rows = await _request(
        "POST",
        "/rest/v1/credit_ledger",
        json=body,
        prefer="return=representation",
    )
    return rows[0]["id"]


async def insert_generation(
    *,
    user_id: str,
    dress_id: str,
    dress_name: str,
    dress_image_url: str,
    input_photo_url: Optional[str] = None,
    status_value: str = "pending",
) -> str:
    body: dict[str, Any] = {
        "user_id": user_id,
        "dress_id": dress_id,
        "dress_name": dress_name,
        "dress_image_url": dress_image_url,
        "status": status_value,
    }
    if input_photo_url is not None:
        body["input_photo_url"] = input_photo_url

    rows = await _request(
        "POST",
        "/rest/v1/generations",
        json=body,
        prefer="return=representation",
    )
    return rows[0]["id"]


async def update_generation(generation_id: str, **fields: Any) -> None:
    if not fields:
        return
    await _request(
        "PATCH",
        "/rest/v1/generations",
        params={"id": f"eq.{generation_id}"},
        json=fields,
        prefer="return=minimal",
    )
