"""Tests for the FastAPI agent endpoints."""

from __future__ import annotations

import asyncio
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
    app.agent._session_locks.clear()
    app.agent._session_slots.clear()
    app.agent._session_generations.clear()
    app.agent._active_tasks.clear()
    app.agent._pending_confirmations.clear()
    retries = getattr(app.agent, "_pending_retries", None)
    if retries is not None:
        retries.clear()


@pytest.fixture
def client() -> TestClient:
    """FastAPI TestClient (imported lazily to allow patching first)."""
    from app.main import app

    return TestClient(app)


# Mock agent return value
def _mock_process_message(session_id, message, on_event=None):
    """Default mock for process_message."""
    import uuid

    sid = session_id or str(uuid.uuid4())
    return (
        "这是模拟回复",
        [{"type": "create_todo", "result": {"id": 1, "title": "测试"}}],
        sid,
    )


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


def test_startup_rejects_invalid_model_configuration(monkeypatch):
    from app.agent import validate_model_configuration
    from app.llm import ModelConfigurationError

    monkeypatch.setenv("LLM_PROVIDER", "openai-compatible")
    monkeypatch.setenv("LLM_API_KEY", "secret-value")
    monkeypatch.setenv("LLM_MODEL", "compatible-model")
    monkeypatch.delenv("LLM_BASE_URL", raising=False)

    with pytest.raises(ModelConfigurationError, match="LLM_BASE_URL"):
        validate_model_configuration()


# ===================================================================
# POST /api/agent/chat
# ===================================================================


def test_chat_without_session_creates_one(client):
    with patch(
        "app.main.process_message", new=AsyncMock(side_effect=_mock_process_message)
    ):
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
    with patch(
        "app.main.process_message", new=AsyncMock(side_effect=_mock_process_message)
    ):
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


def test_websocket_initial_disconnect_starts_no_agent_task(client):
    process = AsyncMock()
    with patch("app.main.process_message", new=process):
        with client.websocket_connect("/api/agent/stream"):
            pass
    process.assert_not_awaited()


def test_websocket_invalid_initial_envelope_fails_and_closes(client):
    process = AsyncMock()
    with (
        patch("app.main.process_message", new=process),
        client.websocket_connect("/api/agent/stream") as ws,
    ):
        ws.send_json({"message": "", "unexpected": True})
        failure = ws.receive_json()
        done = ws.receive_json()

    assert failure["error_code"] == "INVALID_CLIENT_EVENT"
    assert done == {"type": "done"}
    process.assert_not_awaited()


def test_websocket_unknown_valid_confirmation_reports_and_cleans_up(client):
    cancelled = asyncio.Event()

    async def blocked(session_id, message, on_event=None):
        await on_event({"type": "step_started", "step_id": "wait", "label": "等待"})
        try:
            await asyncio.Future()
        except asyncio.CancelledError:
            cancelled.set()
            raise

    with (
        patch("app.main.process_message", new=AsyncMock(side_effect=blocked)),
        client.websocket_connect("/api/agent/stream") as ws,
    ):
        ws.send_json({"message": "等待", "session_id": "unknown-confirm"})
        assert ws.receive_json()["step_id"] == "wait"
        ws.send_json(
            {
                "type": "confirmation_response",
                "confirmation_id": "not-registered",
                "approved": True,
            }
        )
        assert ws.receive_json()["error_code"] == "INVALID_CONFIRMATION"

    assert cancelled.is_set()


def test_websocket_stream_chat(client):
    """The WebSocket directly forwards events emitted during execution."""

    async def _mock_stream(session_id, message, on_event=None):
        assert on_event is not None
        await on_event(
            {"type": "step_started", "step_id": "understand", "label": "理解请求"}
        )
        await on_event(
            {"type": "step_completed", "step_id": "understand", "duration_ms": 2}
        )
        await on_event(
            {
                "type": "step_started",
                "step_id": "create-1",
                "label": "调用 Todo API",
                "tool": "create_todo",
                "args": {"title": "测试"},
            }
        )
        await on_event(
            {
                "type": "action_completed",
                "step_id": "create-1",
                "action": "create_todo",
                "result": {"id": 1},
                "duration_ms": 10,
            }
        )
        return (
            "这是流式回复",
            [{"type": "create_todo", "result": {"id": 1}}],
            session_id,
        )

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

    assert [event["type"] for event in events] == [
        "step_started",
        "step_completed",
        "step_started",
        "action_completed",
        "reply",
        "done",
    ]


def test_websocket_sends_step_events(client):
    """Verify the step_started events have the required fields."""

    async def _mock_stream(session_id, message, on_event=None):
        assert on_event is not None
        await on_event(
            {
                "type": "step_started",
                "step_id": "understand",
                "label": "理解请求",
                "started_at": "2026-07-13T10:30:00Z",
            }
        )
        await on_event(
            {"type": "step_completed", "step_id": "understand", "duration_ms": 1}
        )
        return "好的", [], session_id

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


def test_websocket_confirmation_response_resumes_bound_delete(client):
    """The receive loop can approve a paused delete while processing runs."""
    from app.agent import _tools_by_name
    from tests.test_agent import FakeToolCallingLLM, StubTool, _aim, _tc

    llm = FakeToolCallingLLM(
        responses=[
            _aim(tool_calls=[_tc("delete_todo", {"todo_id": 7})]),
            _aim("已删除"),
        ]
    )
    delete = StubTool(result={"deleted": True, "id": 7})
    with (
        patch("app.agent._build_llm", return_value=llm),
        patch.dict(_tools_by_name, {"delete_todo": delete}),
        client.websocket_connect("/api/agent/stream") as ws,
    ):
        ws.send_json({"message": "删除 7", "session_id": "ws-owner"})
        confirmation = None
        while confirmation is None:
            event = ws.receive_json()
            if event["type"] == "confirmation_required":
                confirmation = event
        ws.send_json(
            {
                "type": "confirmation_response",
                "confirmation_id": confirmation["confirmation_id"],
                "approved": True,
            }
        )
        remaining = []
        while not remaining or remaining[-1]["type"] != "done":
            remaining.append(ws.receive_json())

    delete.ainvoke.assert_awaited_once_with({"todo_id": 7})
    assert [event["type"] for event in remaining] == [
        "action_completed",
        "reply",
        "done",
    ]


def test_websocket_disconnect_cancels_processing(client):
    """Closing the socket cancels rather than detaching an agent task."""
    cancelled = asyncio.Event()

    async def _blocked(session_id, message, on_event=None):
        await on_event({"type": "step_started", "step_id": "slow", "label": "慢任务"})
        try:
            await asyncio.Future()
        except asyncio.CancelledError:
            cancelled.set()
            raise

    with patch("app.main.process_message", new=AsyncMock(side_effect=_blocked)):
        with client.websocket_connect("/api/agent/stream") as ws:
            ws.send_json({"message": "一直运行", "session_id": "disconnect-session"})
            assert ws.receive_json()["step_id"] == "slow"

    # TestClient drives the app loop until endpoint cleanup completes.
    assert cancelled.is_set()


def test_websocket_rejects_unvalidated_confirmation_frame(client):
    """Unknown fields and non-boolean approvals never reach the resolver."""

    async def _blocked(session_id, message, on_event=None):
        await on_event({"type": "step_started", "step_id": "wait", "label": "等待确认"})
        await asyncio.Future()

    with (
        patch("app.main.process_message", new=AsyncMock(side_effect=_blocked)),
        patch("app.main.resolve_confirmation") as resolve,
        client.websocket_connect("/api/agent/stream") as ws,
    ):
        ws.send_json({"message": "等待", "session_id": "validate-session"})
        assert ws.receive_json()["step_id"] == "wait"
        ws.send_json(
            {
                "type": "confirmation_response",
                "confirmation_id": "confirm-x",
                "approved": "yes",
                "session_id": "attacker-controlled",
            }
        )
        failure = ws.receive_json()

    resolve.assert_not_called()
    assert failure["type"] == "step_failed"
    assert failure["error_code"] == "INVALID_CLIENT_EVENT"


def test_websocket_retry_step_rejects_client_supplied_tool_or_args(client):
    """The retry frame contains identity only; clients cannot select an operation."""
    retry = AsyncMock()
    with (
        patch("app.main.retry_failed_step", new=retry),
        client.websocket_connect("/api/agent/stream") as ws,
    ):
        ws.send_json(
            {
                "type": "retry_step",
                "session_id": "owner",
                "step_id": "failed-read",
                "retry_token": "opaque-token",
                "tool": "create_todo",
                "args": {"title": "攻击写入"},
            }
        )
        failure = ws.receive_json()
        done = ws.receive_json()

    retry.assert_not_awaited()
    assert failure["error_code"] == "INVALID_CLIENT_EVENT"
    assert failure["retryable"] is False
    assert done == {"type": "done"}


def test_websocket_retry_step_routes_identity_without_replanning(client):
    async def exact_retry(session_id, step_id, retry_token, on_event):
        assert (session_id, step_id, retry_token) == (
            "owner", "failed-read", "r" * 32
        )
        await on_event(
            {
                "type": "action_completed",
                "step_id": step_id,
                "action": "list_todos",
                "result": {"items": [], "total": 0},
                "duration_ms": 1,
            }
        )
        await on_event({"type": "reply", "content": "已重新执行查询。"})

    process = AsyncMock()
    with (
        patch("app.main.process_message", new=process),
        patch("app.main.retry_failed_step", new=AsyncMock(side_effect=exact_retry)) as retry,
        client.websocket_connect("/api/agent/stream") as ws,
    ):
        ws.send_json(
            {
                "type": "retry_step",
                "session_id": "owner",
                "step_id": "failed-read",
                "retry_token": "r" * 32,
            }
        )
        events = [ws.receive_json(), ws.receive_json(), ws.receive_json()]

    process.assert_not_awaited()
    retry.assert_awaited_once()
    assert [event["type"] for event in events] == [
        "action_completed", "reply", "done"
    ]


@pytest.mark.parametrize("raw", ["null", "123", '"hello"'])
def test_websocket_json_scalars_remain_plain_text_messages(client, raw):
    """Only JSON objects are protocol envelopes; scalars retain raw text."""
    seen: list[str] = []

    async def capture(session_id, message, on_event=None):
        seen.append(message)
        return "ok", [], session_id

    with patch("app.main.process_message", new=AsyncMock(side_effect=capture)):
        with client.websocket_connect("/api/agent/stream") as ws:
            ws.send_text(raw)
            assert ws.receive_json()["type"] == "reply"
            assert ws.receive_json()["type"] == "done"

    assert seen == [raw]


@pytest.mark.asyncio
async def test_websocket_writer_serializes_concurrent_sends():
    """All Agent and endpoint events pass through one non-overlapping writer."""
    from app.main import stream

    class FakeWebSocket:
        def __init__(self):
            self.events = []
            self.active_writes = 0
            self.max_active_writes = 0
            self.receive_forever = asyncio.Event()

        async def accept(self):
            pass

        async def receive_text(self):
            return '{"message":"并发事件","session_id":"writer"}'

        async def receive_json(self):
            await self.receive_forever.wait()

        async def send_json(self, event):
            self.active_writes += 1
            self.max_active_writes = max(self.max_active_writes, self.active_writes)
            await asyncio.sleep(0)
            self.events.append(event)
            self.active_writes -= 1

        async def close(self, code=1000):
            pass

    async def concurrent_events(session_id, message, on_event=None):
        await asyncio.gather(
            on_event({"type": "reply", "content": "一"}),
            on_event({"type": "reply", "content": "二"}),
        )
        return "最终", [], session_id

    ws = FakeWebSocket()
    with patch(
        "app.main.process_message", new=AsyncMock(side_effect=concurrent_events)
    ):
        await stream(ws)

    assert ws.max_active_writes == 1
    assert [event["type"] for event in ws.events[-2:]] == ["reply", "done"]


class _TerminalWebSocket:
    def __init__(
        self, *, session_id: str, fail_event: str | None = None, fail_close=False
    ):
        self.raw = f'{{"message":"创建一次","session_id":"{session_id}"}}'
        self.fail_event = fail_event
        self.fail_close = fail_close
        self.failed = False
        self.events: list[dict] = []

    async def accept(self):
        pass

    async def receive_text(self):
        return self.raw

    async def receive_json(self):
        await asyncio.Future()

    async def send_json(self, event):
        if event["type"] == self.fail_event and not self.failed:
            self.failed = True
            raise RuntimeError(f"{self.fail_event} send failed")
        self.events.append(event)

    async def close(self, code=1000):
        if self.fail_close:
            raise RuntimeError("close failed")


def _terminal_model_and_tool():
    from tests.test_agent import FakeToolCallingLLM, StubTool, _aim, _tc

    model = FakeToolCallingLLM(
        responses=[
            _aim(tool_calls=[_tc("create_todo", {"title": "一次"}, "terminal")]),
            _aim("完成"),
        ]
    )
    return model, StubTool(result={"id": 1, "title": "一次"})


@pytest.mark.asyncio
@pytest.mark.parametrize("fail_event", ["reply", "done"])
async def test_terminal_send_failure_keeps_checkpoint_and_retry_reuses_side_effect(
    fail_event,
):
    from app.agent import _conversations, _tools_by_name
    from app.main import stream

    model, tool = _terminal_model_and_tool()
    first = _TerminalWebSocket(session_id=f"fail-{fail_event}", fail_event=fail_event)
    with (
        patch("app.agent._build_llm", return_value=model),
        patch.dict(_tools_by_name, {"create_todo": tool}),
    ):
        await stream(first)
        state = _conversations[f"fail-{fail_event}"]["incomplete"]
        if fail_event == "reply":
            assert state["phase"] == "ready_reply"
            retry = _TerminalWebSocket(session_id=f"fail-{fail_event}")
            await stream(retry)
            assert [event["type"] for event in retry.events[-2:]] == [
                "reply", "done"
            ]
            assert _conversations[f"fail-{fail_event}"]["incomplete"] is None
        else:
            assert state is None

    tool.ainvoke.assert_awaited_once()
    if fail_event == "done":
        terminal = [
            event["type"]
            for event in first.events
            if event["type"] in {"reply", "done", "step_failed"}
        ]
        assert terminal == ["reply"]
    else:
        terminal = [
            event["type"]
            for event in first.events
            if event["type"] in {"reply", "done", "step_failed"}
        ]
        assert terminal == []


@pytest.mark.asyncio
async def test_complete_false_after_done_adds_no_second_terminal_event():
    from app.agent import _conversations, _tools_by_name
    from app.main import stream

    model, tool = _terminal_model_and_tool()
    ws = _TerminalWebSocket(session_id="complete-false")
    with (
        patch("app.agent._build_llm", return_value=model),
        patch.dict(_tools_by_name, {"create_todo": tool}),
        patch("app.main.complete_turn", new=AsyncMock(return_value=False)) as complete,
    ):
        await stream(ws)

    result_state = _conversations["complete-false"]["incomplete"]
    assert result_state["phase"] == "ready_reply"
    assert ws.events[-1]["type"] == "reply"
    assert len([event for event in ws.events if event["type"] == "done"]) == 0
    complete.assert_awaited_once_with("complete-false", result_state["turn_id"], 0)
    tool.ainvoke.assert_awaited_once()


@pytest.mark.asyncio
async def test_close_failure_after_commit_adds_no_second_terminal_event():
    from app.agent import _conversations, _tools_by_name
    from app.main import stream

    model, tool = _terminal_model_and_tool()
    ws = _TerminalWebSocket(session_id="close-false", fail_close=True)
    with (
        patch("app.agent._build_llm", return_value=model),
        patch.dict(_tools_by_name, {"create_todo": tool}),
    ):
        await stream(ws)

    assert _conversations["close-false"]["incomplete"] is None
    assert [event["type"] for event in ws.events[-2:]] == ["reply", "done"]
    assert len([event for event in ws.events if event["type"] == "done"]) == 1
    tool.ainvoke.assert_awaited_once()


@pytest.mark.asyncio
async def test_done_is_not_sent_until_turn_commit_finishes():
    from app.agent import ProcessResult
    from app.main import stream

    commit_started = asyncio.Event()
    release_commit = asyncio.Event()

    async def commit(*_args):
        commit_started.set()
        await release_commit.wait()
        return True

    ws = _TerminalWebSocket(session_id="terminal-order")
    process = AsyncMock(
        return_value=ProcessResult(
            "完成", [], "terminal-order", "turn-terminal", 0
        )
    )
    with (
        patch("app.main.process_message", new=process),
        patch("app.main.complete_turn", new=AsyncMock(side_effect=commit)),
    ):
        running = asyncio.create_task(stream(ws))
        await asyncio.wait_for(commit_started.wait(), timeout=1)
        assert [event["type"] for event in ws.events] == ["reply"]
        release_commit.set()
        await running

    assert [event["type"] for event in ws.events] == ["reply", "done"]


@pytest.mark.asyncio
async def test_cancel_and_drain_is_bounded_for_uncooperative_task():
    """Endpoint cleanup returns even when cancellation is temporarily ignored."""
    from app.main import _cancel_and_drain

    release = asyncio.Event()

    async def uncooperative():
        try:
            await asyncio.Future()
        except asyncio.CancelledError:
            await release.wait()

    task = asyncio.create_task(uncooperative())
    await asyncio.sleep(0)
    started = asyncio.get_running_loop().time()
    await _cancel_and_drain(task, timeout=0.001)
    assert asyncio.get_running_loop().time() - started < 0.05
    release.set()
    await task


def test_websocket_reports_the_actual_failed_phase(client):
    """A final model failure is reported as respond, never understand."""
    from app.agent import AgentExecutionError

    async def fail_respond(session_id, message, on_event=None):
        raise AgentExecutionError("final failed", phase="respond")

    with patch("app.main.process_message", new=AsyncMock(side_effect=fail_respond)):
        with client.websocket_connect("/api/agent/stream") as ws:
            ws.send_text("触发失败")
            failure = ws.receive_json()
            done = ws.receive_json()

    assert failure["type"] == "step_failed"
    assert failure["step_id"] == "respond"
    assert done["type"] == "done"


@pytest.mark.asyncio
async def test_websocket_send_failure_cleans_up_without_hanging():
    from app.main import stream

    class FailingWebSocket:
        async def accept(self):
            pass

        async def receive_text(self):
            return '{"message":"触发写失败","session_id":"send-failure"}'

        async def receive_json(self):
            await asyncio.Future()

        async def send_json(self, _event):
            raise RuntimeError("socket write failed")

        async def close(self, code=1000):
            pass

    async def emit_once(session_id, message, on_event=None):
        await on_event({"type": "reply", "content": "写入"})
        return "never", [], session_id

    with patch("app.main.process_message", new=AsyncMock(side_effect=emit_once)):
        await asyncio.wait_for(stream(FailingWebSocket()), timeout=0.1)


@pytest.mark.asyncio
async def test_websocket_disconnect_and_process_failure_are_drained_together():
    from app.agent import AgentExecutionError
    from app.main import stream
    from starlette.websockets import WebSocketDisconnect

    trigger = asyncio.Event()

    class RacingWebSocket:
        def __init__(self):
            self.events = []

        async def accept(self):
            pass

        async def receive_text(self):
            return '{"message":"竞态","session_id":"race"}'

        async def receive_json(self):
            trigger.set()
            await asyncio.sleep(0)
            raise WebSocketDisconnect(code=1001)

        async def send_json(self, event):
            self.events.append(event)

        async def close(self, code=1000):
            pass

    async def fail_together(session_id, message, on_event=None):
        await trigger.wait()
        raise AgentExecutionError("racing failure", phase="respond")

    ws = RacingWebSocket()
    with patch("app.main.process_message", new=AsyncMock(side_effect=fail_together)):
        await asyncio.wait_for(stream(ws), timeout=0.1)

    assert len([event for event in ws.events if event["type"] == "step_failed"]) <= 1
