"""Tests for the FastAPI agent endpoints."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient
from langchain_core.messages import HumanMessage, SystemMessage


@pytest.fixture(autouse=True)
def _reset_agent():
    """Reset agent graph and conversations between tests."""
    import app.agent

    app.agent._reset_graph()
    app.agent._conversations.clear()


@pytest.fixture
def client() -> TestClient:
    """FastAPI TestClient (imported lazily to allow patching first)."""
    from app.main import app

    return TestClient(app)


# Mock agent return value
def _mock_process_message(session_id, message):
    """Default mock for process_message."""
    import uuid

    sid = session_id or str(uuid.uuid4())
    return "这是模拟回复", [{"type": "create_todo", "result": {"id": 1, "title": "测试"}}], sid


def _seed_conversation(session_id: str):
    """Put a fake conversation into the agent's in-memory store."""
    from app.agent import _conversations

    _conversations[session_id] = {
        "messages": [
            SystemMessage(content="你是一个待办管理助手"),
            HumanMessage(content="你好"),
        ],
    }


# ===================================================================
# Health check
# ===================================================================


def test_health_check(client):
    resp = client.get("/api/agent/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ok"


# ===================================================================
# POST /api/agent/chat
# ===================================================================


def test_chat_without_session_creates_one(client):
    with patch("app.main.process_message", new=AsyncMock(side_effect=_mock_process_message)):
        resp = client.post(
            "/api/agent/chat",
            json={"message": "帮我创建一个待办"},
        )

    assert resp.status_code == 200
    body = resp.json()
    assert body["code"] == 0
    assert "session_id" in body["data"]
    assert len(body["data"]["session_id"]) > 0
    assert body["data"]["reply"] == "这是模拟回复"
    assert len(body["data"]["actions"]) == 1


def test_chat_with_existing_session(client):
    sid = "test-session-123"
    with patch("app.main.process_message", new=AsyncMock(side_effect=_mock_process_message)):
        resp = client.post(
            "/api/agent/chat",
            json={"message": "你好", "session_id": sid},
        )

    assert resp.status_code == 200
    body = resp.json()
    assert body["data"]["session_id"] == sid


def test_chat_empty_message_is_rejected(client):
    resp = client.post("/api/agent/chat", json={"message": ""})
    assert resp.status_code == 422


def test_chat_missing_message_is_rejected(client):
    resp = client.post("/api/agent/chat", json={})
    assert resp.status_code == 422


def test_chat_agent_error_returns_500(client):
    async def _failing(session_id, message):
        raise RuntimeError("LLM 调用失败")

    with patch("app.main.process_message", new=AsyncMock(side_effect=_failing)):
        resp = client.post(
            "/api/agent/chat",
            json={"message": "你好"},
        )

    assert resp.status_code == 500
    body = resp.json()
    assert body["code"] == 50004


# ===================================================================
# GET /api/agent/history
# ===================================================================


def test_get_history_missing_session(client):
    resp = client.get("/api/agent/history")
    assert resp.status_code == 422


def test_get_history_not_found(client):
    resp = client.get("/api/agent/history?session_id=nonexistent")
    assert resp.status_code == 404
    assert resp.json()["code"] == 40402


def test_get_history_after_chat(client):
    """History exists after a conversation has been stored."""
    _seed_conversation("test-sid-42")

    resp = client.get("/api/agent/history?session_id=test-sid-42")
    assert resp.status_code == 200
    body = resp.json()
    assert "messages" in body["data"]
    assert len(body["data"]["messages"]) == 2


# ===================================================================
# DELETE /api/agent/history
# ===================================================================


def test_delete_history_missing_session(client):
    resp = client.delete("/api/agent/history")
    assert resp.status_code == 422


def test_delete_history_not_found(client):
    resp = client.delete("/api/agent/history?session_id=nonexistent")
    assert resp.status_code == 404
    assert resp.json()["code"] == 40402


def test_delete_history_success(client):
    _seed_conversation("to-delete")

    resp = client.delete("/api/agent/history?session_id=to-delete")
    assert resp.status_code == 200
    assert resp.json()["data"]["deleted"] is True

    # Confirm it's gone
    resp2 = client.get("/api/agent/history?session_id=to-delete")
    assert resp2.status_code == 404


# ===================================================================
# WebSocket /api/agent/stream
# ===================================================================


def test_websocket_stream_chat(client):
    """The WebSocket should send a sequence of typed events then close."""
    async def _mock_stream(session_id, message):
        import uuid

        sid = session_id or str(uuid.uuid4())
        return "这是流式回复", [{"type": "create_todo", "result": {"id": 1}}], sid

    with patch("app.main.process_message", new=AsyncMock(side_effect=_mock_stream)):
        with client.websocket_connect("/api/agent/stream") as ws:
            ws.send_text("帮我创建一个待办")

            events = []
            while True:
                try:
                    data = ws.receive_json()
                    events.append(data)
                    if data.get("type") == "done":
                        break
                except Exception:
                    break

    types = [e["type"] for e in events]
    assert "step_started" in types
    assert "step_completed" in types or "action_completed" in types
    assert "reply" in types
    assert "done" in types


def test_websocket_sends_step_events(client):
    """Verify the step_started events have the required fields."""
    async def _mock_stream(session_id, message):
        import uuid

        sid = session_id or str(uuid.uuid4())
        return "好的", [], sid

    with patch("app.main.process_message", new=AsyncMock(side_effect=_mock_stream)):
        with client.websocket_connect("/api/agent/stream") as ws:
            ws.send_text("你好")

            events = []
            while True:
                try:
                    data = ws.receive_json()
                    events.append(data)
                    if data.get("type") == "done":
                        break
                except Exception:
                    break

    step_started = [e for e in events if e["type"] == "step_started"]
    assert len(step_started) >= 1
    first_step = step_started[0]
    assert "step_id" in first_step
    assert "label" in first_step
    assert "started_at" in first_step

    replies = [e for e in events if e["type"] == "reply"]
    assert len(replies) >= 1
    assert "content" in replies[0]

    assert events[-1]["type"] == "done"
