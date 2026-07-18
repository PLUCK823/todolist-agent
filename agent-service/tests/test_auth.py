"""Trusted Cookie/JWT authentication boundary tests."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import uuid4

import jwt
import pytest
from fastapi import Request
from httpx import ASGITransport, AsyncClient
from starlette.datastructures import Headers

from app.auth import AuthFailure, AuthPrincipal, AuthSettings, decode_access_token, enforce_origin


def _settings() -> AuthSettings:
    return AuthSettings(
        secret="x" * 32,
        access_cookie="todolist_access",
        allowed_origins=frozenset({"http://frontend.test"}),
        issuer="todolist-backend",
        database_url="postgresql://unused",
    )


def _token(settings: AuthSettings, *, sub=None, sid=None, **claims: object) -> str:
    now = datetime.now(timezone.utc)
    payload: dict[str, object] = {
        "sub": str(sub or uuid4()), "sid": str(sid or uuid4()), "iat": now,
        "exp": now + timedelta(minutes=5), "iss": settings.issuer,
        **claims,
    }
    return jwt.encode(payload, settings.secret, algorithm="HS256")


def test_decode_access_token_requires_claims_and_hs256():
    settings = _settings()
    principal = decode_access_token(_token(settings), settings)
    assert isinstance(principal, AuthPrincipal)

    with pytest.raises(AuthFailure):
        decode_access_token(jwt.encode({"sub": str(uuid4())}, settings.secret, algorithm="HS256"), settings)
    with pytest.raises(AuthFailure):
        decode_access_token(_token(settings, exp=datetime.now(timezone.utc) - timedelta(seconds=1)), settings)
    with pytest.raises(AuthFailure):
        decode_access_token(_token(settings), AuthSettings(**{**settings.__dict__, "secret": "y" * 32}))


@pytest.mark.parametrize("origin,allowed", [("http://frontend.test", True), ("http://evil.test", False), (None, False)])
def test_enforce_origin_uses_exact_allowlist(origin, allowed):
    settings = _settings()
    headers = Headers({} if origin is None else {"origin": origin})
    request = Request({"type": "http", "method": "POST", "headers": headers.raw})
    if allowed:
        enforce_origin(request, settings)
    else:
        with pytest.raises(AuthFailure) as exc:
            enforce_origin(request, settings)
        assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_http_routes_reject_missing_cookie_and_cross_site_mutation():
    """The mounted APIs do not retain an unauthenticated compatibility path."""
    from app.main import create_app

    class Repository:
        async def is_auth_session_active(self, _owner, _session):
            return True

    app = create_app()
    settings = _settings()
    app.state.auth_settings = settings
    app.state.history_repository = Repository()
    token = _token(settings)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        assert (await client.get("/api/agent/sessions")).status_code == 401
        client.cookies.set(settings.access_cookie, token)
        # Cookie present but no allowlisted Origin: state mutation is still denied.
        assert (await client.post("/api/agent/sessions", json={})).status_code == 403
        assert (await client.post("/api/agent/sessions", headers={"Origin": "http://evil.test"}, json={})).status_code == 403
