"""Owner-scoped durable session API contracts."""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

import pytest
from httpx import ASGITransport, AsyncClient

from app.auth import AuthPrincipal
from app.history_models import SessionSummary
from app.main import create_app, get_current_principal, get_history_service


class FakeService:
    def __init__(self):
        now = datetime.now(timezone.utc)
        self.owner = uuid4()
        self.other = uuid4()
        self.session = SessionSummary(uuid4(), self.owner, "新对话", now, now, now)
        self.deleted = []

    async def list_sessions(self, owner_id):
        return [self.session] if owner_id == self.owner else []

    async def create_session(self, owner_id, title=None, first_message=None):
        assert owner_id == self.owner
        title = title or (" ".join(first_message.split())[:48] if first_message else "新对话")
        return SessionSummary(self.session.id, owner_id, title, self.session.created_at, self.session.updated_at, self.session.last_message_at)

    async def get_session(self, owner_id, session_id):
        return None if owner_id != self.owner or session_id != self.session.id else {"session": self.session, "turns": []}

    async def rename_session(self, owner_id, session_id, title):
        if owner_id != self.owner or session_id != self.session.id:
            return None
        return SessionSummary(self.session.id, owner_id, title.strip(), self.session.created_at, self.session.updated_at, self.session.last_message_at)

    async def delete_session(self, owner_id, session_id):
        if owner_id != self.owner or session_id != self.session.id:
            return False
        self.deleted.append(session_id)
        return True


@pytest.fixture
def app_and_service():
    app = create_app()
    service = FakeService()

    async def principal():
        return AuthPrincipal(service.owner, uuid4())

    app.dependency_overrides[get_current_principal] = principal
    app.dependency_overrides[get_history_service] = lambda: service
    return app, service


@pytest.mark.asyncio
async def test_session_crud_is_authenticated_owner_scoped_and_enveloped(app_and_service):
    app, service = app_and_service
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        listed = await client.get("/api/agent/sessions")
        assert listed.status_code == 200
        assert listed.json()["data"]["items"][0]["id"] == str(service.session.id)

        created = await client.post("/api/agent/sessions", json={"first_message": "  plan   my   day  "})
        assert created.status_code == 201
        assert created.json()["data"]["title"] == "plan my day"

        detail = await client.get(f"/api/agent/sessions/{service.session.id}")
        assert detail.status_code == 200
        assert detail.json()["data"]["turns"] == []

        renamed = await client.patch(f"/api/agent/sessions/{service.session.id}", json={"title": "  Renamed  "})
        assert renamed.status_code == 200
        assert renamed.json()["data"]["title"] == "Renamed"

        missing = await client.get(f"/api/agent/sessions/{uuid4()}")
        assert missing.status_code == 404

        deleted = await client.delete(f"/api/agent/sessions/{service.session.id}")
        assert deleted.status_code == 200
        assert service.deleted == [service.session.id]


@pytest.mark.asyncio
async def test_session_payloads_forbid_extra_fields_and_bad_title(app_and_service):
    app, service = app_and_service
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        extra = await client.post("/api/agent/sessions", json={"unknown": True})
        assert extra.status_code == 422
        invalid = await client.patch(f"/api/agent/sessions/{service.session.id}", json={"title": "   "})
        assert invalid.status_code == 422
