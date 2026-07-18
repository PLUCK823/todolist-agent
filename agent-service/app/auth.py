"""Shared Cookie/JWT authentication for Agent HTTP and WebSocket traffic."""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Protocol
from uuid import UUID

import jwt
from fastapi import Request, WebSocket


class ActiveAuthSessionRepository(Protocol):
    async def is_auth_session_active(self, owner_id: UUID, auth_session_id: UUID) -> bool: ...


class AuthFailure(RuntimeError):
    """Safe authentication/CSRF error, suitable for a public HTTP response."""

    def __init__(self, message: str = "authentication required", status_code: int = 401):
        super().__init__(message)
        self.status_code = status_code


class AuthDatabaseFailure(RuntimeError):
    """The authentication backing store could not be checked safely."""


@dataclass(frozen=True)
class AuthSettings:
    secret: str
    access_cookie: str
    allowed_origins: frozenset[str]
    issuer: str
    database_url: str
    pool_min_size: int = 1
    pool_max_size: int = 10
    command_timeout: float = 5.0

    @classmethod
    def from_env(cls) -> "AuthSettings":
        secret = os.getenv("AUTH_JWT_SECRET", "")
        if len(secret) < 32:
            raise RuntimeError("AUTH_JWT_SECRET must be at least 32 characters")
        database_url = os.getenv("DATABASE_URL", "").strip()
        if not database_url:
            raise RuntimeError("DATABASE_URL is required")
        origins = frozenset(
            origin.strip() for origin in os.getenv("AUTH_ALLOWED_ORIGINS", "http://localhost:3000").split(",")
            if origin.strip()
        )
        if not origins or "*" in origins:
            raise RuntimeError("AUTH_ALLOWED_ORIGINS must be a non-wildcard allowlist")
        try:
            pool_min_size = int(os.getenv("AGENT_DB_POOL_MIN_SIZE", "1"))
            pool_max_size = int(os.getenv("AGENT_DB_POOL_MAX_SIZE", "10"))
            command_timeout = float(os.getenv("AGENT_DB_COMMAND_TIMEOUT_SECONDS", "5"))
        except ValueError as exc:
            raise RuntimeError("Agent database pool settings must be numeric") from exc
        if pool_min_size < 1:
            raise RuntimeError("AGENT_DB_POOL_MIN_SIZE must be at least 1")
        if pool_max_size < pool_min_size:
            raise RuntimeError("AGENT_DB_POOL_MIN_SIZE must not exceed AGENT_DB_POOL_MAX_SIZE")
        if command_timeout <= 0:
            raise RuntimeError("AGENT_DB_COMMAND_TIMEOUT_SECONDS must be positive")
        return cls(
            secret=secret,
            access_cookie=os.getenv("AUTH_ACCESS_COOKIE", "todolist_access").strip() or "todolist_access",
            allowed_origins=origins,
            issuer=os.getenv("AUTH_JWT_ISSUER", "todolist-backend").strip() or "todolist-backend",
            database_url=database_url,
            pool_min_size=pool_min_size,
            pool_max_size=pool_max_size,
            command_timeout=command_timeout,
        )


@dataclass(frozen=True)
class AuthPrincipal:
    user_id: UUID
    session_id: UUID


def decode_access_token(token: str, settings: AuthSettings) -> AuthPrincipal:
    """Decode precisely the backend-issued HS256 access-token contract."""
    if not token:
        raise AuthFailure()
    try:
        payload = jwt.decode(
            token,
            settings.secret,
            algorithms=["HS256"],
            issuer=settings.issuer,
            options={"require": ["sub", "sid", "exp", "iat", "iss"]},
        )
        return AuthPrincipal(user_id=UUID(str(payload["sub"])), session_id=UUID(str(payload["sid"])))
    except (jwt.PyJWTError, KeyError, TypeError, ValueError) as exc:
        raise AuthFailure() from exc


def enforce_origin(request: Request, settings: AuthSettings) -> None:
    """CSRF boundary for Cookie-authenticated state-changing HTTP requests."""
    origin = request.headers.get("origin")
    if origin not in settings.allowed_origins:
        raise AuthFailure("origin is not allowed", status_code=403)


def enforce_websocket_origin(ws: WebSocket, settings: AuthSettings) -> None:
    if ws.headers.get("origin") not in settings.allowed_origins:
        raise AuthFailure("origin is not allowed", status_code=403)


async def authenticate_cookie(
    token: str | None,
    settings: AuthSettings,
    repository: ActiveAuthSessionRepository,
) -> AuthPrincipal:
    principal = decode_access_token(token or "", settings)
    try:
        active = await repository.is_auth_session_active(principal.user_id, principal.session_id)
    except Exception as exc:
        raise AuthDatabaseFailure("authentication store unavailable") from exc
    if not active:
        raise AuthFailure()
    return principal


async def authenticate_request(
    request: Request, settings: AuthSettings, repository: ActiveAuthSessionRepository
) -> AuthPrincipal:
    if request.method.upper() in {"POST", "PUT", "PATCH", "DELETE"}:
        enforce_origin(request, settings)
    return await authenticate_cookie(request.cookies.get(settings.access_cookie), settings, repository)


async def authenticate_websocket(
    ws: WebSocket, settings: AuthSettings, repository: ActiveAuthSessionRepository
) -> AuthPrincipal:
    enforce_websocket_origin(ws, settings)
    return await authenticate_cookie(ws.cookies.get(settings.access_cookie), settings, repository)
