"""Supabase JWT verification for FastAPI request handlers.

We delegate JWT verification to Supabase's `/auth/v1/user` endpoint instead
of validating signatures locally. Trade-off: one extra HTTP hop (~50 ms)
per authenticated request, in exchange for not having to manage the
project's JWT secret in our environment. For our request volume and the
fact that try-on generation already takes 30-60 s, the extra hop is noise.

Usage in FastAPI handlers:

    @app.post("/api/try-on")
    async def try_on(user: AuthedUser = Depends(require_user)):
        # user.id, user.email available
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Optional

import aiohttp
from fastapi import Header, HTTPException, status

SUPABASE_URL = os.environ.get(
    "SUPABASE_URL", "https://uqevnxxorffumbzwldkx.supabase.co"
)
SUPABASE_ANON_KEY = os.environ.get("SUPABASE_ANON_KEY", "")


@dataclass(frozen=True)
class AuthedUser:
    """Minimal projection of the Supabase user record we need downstream."""

    id: str
    email: str
    access_token: str  # the original JWT, in case we ever need to forward it


async def require_user(authorization: Optional[str] = Header(default=None)) -> AuthedUser:
    """FastAPI dependency that asserts the request carries a valid Supabase JWT.

    Raises 401 on missing / malformed / rejected token. Returns the user on
    success.
    """
    if not authorization:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing Authorization header",
        )

    parts = authorization.split(" ", 1)
    if len(parts) != 2 or parts[0].lower() != "bearer" or not parts[1].strip():
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authorization header must be 'Bearer <token>'",
        )
    token = parts[1].strip()

    if not SUPABASE_ANON_KEY:
        # Misconfigured server. 500 rather than 401 because the user did
        # nothing wrong.
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Auth not configured on the server",
        )

    headers = {
        "Authorization": f"Bearer {token}",
        "apikey": SUPABASE_ANON_KEY,
    }
    url = f"{SUPABASE_URL}/auth/v1/user"

    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(url, headers=headers, timeout=aiohttp.ClientTimeout(total=5)) as resp:
                if resp.status == 401:
                    raise HTTPException(
                        status_code=status.HTTP_401_UNAUTHORIZED,
                        detail="Invalid or expired session",
                    )
                if resp.status != 200:
                    body = await resp.text()
                    raise HTTPException(
                        status_code=status.HTTP_401_UNAUTHORIZED,
                        detail=f"Auth check failed: {body[:200]}",
                    )
                data = await resp.json()
    except aiohttp.ClientError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Auth backend unavailable: {exc}",
        )

    user_id = data.get("id")
    email = data.get("email") or ""
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token did not resolve to a user",
        )

    return AuthedUser(id=user_id, email=email, access_token=token)
