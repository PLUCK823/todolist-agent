"""HTTP and WebSocket tests that exercise the real Cookie auth dependency."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

import jwt
import pytest
from fastapi.testclient import TestClient
from httpx import ASGITransport, AsyncClient
from starlette.websockets import WebSocketDisconnect

from app.auth import AuthSettings
from app.history_models import SessionDetail, SessionSummary
from app.main import create_app


class _Repository:
    def __init__(self):
        self.active = True
        self.broken = False

    async def is_auth_session_active(self, _owner, _sid):
        if self.broken:
            raise RuntimeError("database unavailable")
        return self.active


class _Service:
    def __init__(self):
        self.sessions: dict[UUID, SessionSummary] = {}

    async def list_sessions(self, owner):
        return [session for session in self.sessions.values() if session.owner_id == owner]

    async def create_session(self, owner, title=None, first_message=None):
        now = datetime.now(timezone.utc)
        session = SessionSummary(uuid4(), owner, title or "新对话", now, now, now)
        self.sessions[session.id] = session
        return session

    async def get_session(self, owner, session_id):
        session = self.sessions.get(session_id)
        if session is None or session.owner_id != owner:
            return None
        return SessionDetail(
            id=session.id, owner_id=session.owner_id, title=session.title,
            created_at=session.created_at, updated_at=session.updated_at,
            last_message_at=session.last_message_at,
        )

    async def rename_session(self, owner, session_id, title):
        session = self.sessions.get(session_id)
        if session is None or session.owner_id != owner:
            return None
        renamed = SessionSummary(session.id, owner, title.strip(), session.created_at, session.updated_at, session.last_message_at)
        self.sessions[session_id] = renamed
        return renamed

    async def delete_session(self, owner, session_id):
        session = self.sessions.get(session_id)
        if session is None or session.owner_id != owner:
            return False
        del self.sessions[session_id]
        return True


def _settings() -> AuthSettings:
    return AuthSettings(
        secret="s" * 32, access_cookie="todolist_access",
        allowed_origins=frozenset({"http://frontend.test"}), issuer="todolist-backend",
        database_url="postgresql://unused",
    )


def _token(settings, user, sid, *, algorithm="HS256"):
    now = datetime.now(timezone.utc)
    payload = {"sub": str(user), "sid": str(sid), "iss": settings.issuer, "iat": now, "exp": now + timedelta(minutes=5)}
    return jwt.encode(payload, settings.secret if algorithm != "none" else "", algorithm=algorithm)


def _app():
    app = create_app()
    settings = _settings()
    repository = _Repository()
    service = _Service()
    app.state.auth_settings = settings
    app.state.history_repository = repository
    app.state.history_service = service
    return app, settings, repository, service


@pytest.mark.asyncio
async def test_real_dependency_rejects_non_hs256_revoked_and_broken_auth_store():
    app, settings, repository, _ = _app()
    user, sid = uuid4(), uuid4()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        client.cookies.set(settings.access_cookie, _token(settings, user, sid, algorithm="none"))
        assert (await client.get("/api/agent/sessions")).status_code == 401
        client.cookies.set(settings.access_cookie, _token(settings, user, sid))
        repository.active = False
        assert (await client.get("/api/agent/sessions")).status_code == 401
        repository.active = True
        repository.broken = True
        assert (await client.get("/api/agent/sessions")).status_code == 503


@pytest.mark.asyncio
async def test_real_principals_enforce_two_user_session_crud():
    app, settings, _, _ = _app()
    alice, alice_sid = uuid4(), uuid4()
    bob, bob_sid = uuid4(), uuid4()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        client.headers["Origin"] = "http://frontend.test"
        client.cookies.set(settings.access_cookie, _token(settings, alice, alice_sid))
        created = await client.post("/api/agent/sessions", json={"title": "Alice only"})
        assert created.status_code == 201
        session_id = created.json()["data"]["id"]
        client.cookies.set(settings.access_cookie, _token(settings, bob, bob_sid))
        assert (await client.get(f"/api/agent/sessions/{session_id}")).status_code == 404
        assert (await client.patch(f"/api/agent/sessions/{session_id}", json={"title": "Nope"})).status_code == 404
        assert (await client.delete(f"/api/agent/sessions/{session_id}")).status_code == 404


def test_websocket_auth_and_ownership_close_before_agent_execution():
    app, settings, _, service = _app()
    alice, alice_sid = uuid4(), uuid4()
    bob = uuid4()
    now = datetime.now(timezone.utc)
    bob_session = SessionSummary(uuid4(), bob, "Bob", now, now, now)
    service.sessions[bob_session.id] = bob_session
    client = TestClient(app)

    with pytest.raises(WebSocketDisconnect) as missing:
        with client.websocket_connect("/api/agent/stream", headers={"origin": "http://frontend.test"}):
            pass
    assert missing.value.code == 4401

    client.cookies.set(settings.access_cookie, _token(settings, alice, alice_sid))
    with pytest.raises(WebSocketDisconnect) as bad_origin:
        with client.websocket_connect("/api/agent/stream", headers={"origin": "http://evil.test"}):
            pass
    assert bad_origin.value.code == 4403

    with pytest.raises(WebSocketDisconnect) as query_owner:
        with client.websocket_connect(f"/api/agent/stream?session_id={bob_session.id}", headers={"origin": "http://frontend.test"}):
            pass
    assert query_owner.value.code == 4403

    with client.websocket_connect("/api/agent/stream", headers={"origin": "http://frontend.test"}) as ws:
        ws.send_json({"message": "switch", "session_id": str(bob_session.id)})
        with pytest.raises(WebSocketDisconnect) as frame_owner:
            ws.receive_json()
    assert frame_owner.value.code == 4403
