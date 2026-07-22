"""Durable production-stream ordering and isolation contracts."""

from __future__ import annotations

import asyncio
import os
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from uuid import UUID, uuid4

import jwt
import pytest
from fastapi.testclient import TestClient
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from starlette.websockets import WebSocketDisconnect

from app.agent import _conversations, _reset_graph, process_message
from app.auth import AuthSettings
from app.history_models import MessageRecord, SessionDetail, SessionSummary, TurnRecord
from app.history_service import HistoryService
from app.history_repository import HistoryRepository
from app.main import (
    HistoryPersistenceError,
    RepositoryTurnPersistence,
    SessionRuntimeCoordinator,
    _execute_durable_message,
    app,
)


@pytest.fixture(autouse=True)
def _clean_agent_runtime():
    import app.agent as agent

    _reset_graph()
    _conversations.clear()
    agent._session_locks.clear()
    agent._session_slots.clear()
    agent._session_generations.clear()
    agent._active_tasks.clear()
    agent._pending_confirmations.clear()
    agent._pending_retries.clear()


class _ReplyModel:
    def __init__(self, callback=None, reply: str = "durable reply"):
        self.callback = callback
        self.reply = reply

    def bind_tools(self, _tools):
        return self

    async def ainvoke(self, messages):
        if self.callback is not None:
            result = self.callback(messages)
            if asyncio.iscoroutine(result):
                await result
        return AIMessage(content=self.reply)


class _RecordingPersistence:
    def __init__(self):
        self.started = False
        self.checkpoints: list[dict] = []
        self.completed: list[str] = []
        self.failures: list[tuple[str, str, bool]] = []
        self.write_applied = False

    async def start(self, request):
        self.started = True
        self.request = request

    async def checkpoint(self, event):
        self.checkpoints.append(dict(event))

    async def complete(self, reply):
        self.completed.append(reply)

    async def fail(self, code, message, *, uncertain):
        self.failures.append((code, message, uncertain))

    async def prepare_write(self):
        self.write_applied = True


@pytest.mark.asyncio
async def test_user_turn_is_committed_before_model_execution():
    persistence = _RecordingPersistence()

    def assert_started(_messages):
        assert persistence.started is True
        assert persistence.request.message == "hello"

    with patch("app.agent._build_llm", return_value=_ReplyModel(assert_started)):
        await process_message("durable-start", "hello", persistence=persistence)

    state = _conversations["durable-start"]["incomplete"]
    assert UUID(state["turn_id"])
    assert UUID(state["user_message_id"])
    assert UUID(state["assistant_message_id"])
    assert persistence.request.message_id == state["user_message_id"]


@pytest.mark.asyncio
async def test_step_is_checkpointed_before_send_with_stable_event_id():
    persistence = _RecordingPersistence()
    sent: list[dict] = []

    async def send(event):
        assert persistence.checkpoints[-1] == event
        sent.append(dict(event))

    with patch("app.agent._build_llm", return_value=_ReplyModel()):
        await process_message(
            "durable-events", "hello", on_event=send, persistence=persistence
        )

    assert [event["type"] for event in sent] == ["step_started", "step_completed"]
    assert all(UUID(event["event_id"]) for event in sent)
    assert sent[0]["event_id"] == sent[1]["event_id"]


@pytest.mark.asyncio
async def test_write_is_not_dispatched_when_durable_uncertainty_barrier_fails():
    from app.agent import _tools_by_name
    from tests.test_agent import FakeToolCallingLLM, StubTool, _aim, _tc

    class BarrierFault(_RecordingPersistence):
        async def prepare_write(self):
            raise RuntimeError("uncertainty barrier unavailable")

    model = FakeToolCallingLLM(
        responses=[
            _aim(tool_calls=[_tc("create_todo", {"title": "must not run"})]),
            _aim("unexpected"),
        ]
    )
    tool = StubTool(result={"id": 1})
    with (
        patch("app.agent._build_llm", return_value=model),
        patch.dict(_tools_by_name, {"create_todo": tool}),
    ):
        with pytest.raises(RuntimeError, match="uncertainty barrier unavailable"):
            await process_message(
                "barrier-fault",
                "create",
                persistence=BarrierFault(),
            )

    tool.ainvoke.assert_not_awaited()


@pytest.mark.asyncio
async def test_cancelled_write_is_drained_and_reconnect_does_not_dispatch_twice():
    from app.agent import _tools_by_name
    from tests.test_agent import FakeToolCallingLLM, StubTool, _aim, _tc

    entered = asyncio.Event()
    release = asyncio.Event()
    effects = 0

    async def apply_write(_args):
        nonlocal effects
        effects += 1
        if effects == 1:
            entered.set()
            try:
                await release.wait()
            except asyncio.CancelledError:
                await release.wait()
                raise
        return {"id": effects}

    model = FakeToolCallingLLM(
        responses=[
            _aim(tool_calls=[_tc("create_todo", {"title": "once"})]),
            _aim("recovered"),
        ]
    )
    tool = StubTool()
    tool.ainvoke.side_effect = apply_write
    with (
        patch("app.agent._build_llm", return_value=model),
        patch.dict(_tools_by_name, {"create_todo": tool}),
    ):
        first = asyncio.create_task(
            process_message(
                "cancelled-write",
                "create once",
                persistence=_RecordingPersistence(),
            )
        )
        await entered.wait()
        first.cancel()
        reconnect = asyncio.create_task(
            process_message(
                "cancelled-write",
                "create once",
                persistence=_RecordingPersistence(),
            )
        )
        await asyncio.sleep(0)
        release.set()
        with pytest.raises(asyncio.CancelledError):
            await first
        result = await reconnect

    assert result.reply == "recovered"
    assert effects == 1
    assert tool.ainvoke.await_count == 1


@pytest.mark.asyncio
async def test_dispatched_write_without_known_result_fails_closed_on_reconnect():
    import time

    from app.agent import AgentExecutionError, _new_incomplete, _tools_by_name
    from tests.test_agent import FakeToolCallingLLM, StubTool, _aim, _tc

    response = _aim(tool_calls=[_tc("create_todo", {"title": "unknown"})])
    state = _new_incomplete("create unknown", [SystemMessage(content="system")])
    state.update(
        phase="executing_tools",
        response=response,
        tool_rounds=1,
        tool_calls=1,
        attempted_calls={"1:1"},
        tool_steps={
            "1:1": {
                "step_id": "create_todo-existing",
                "started": time.monotonic(),
                "started_at": datetime.now(timezone.utc).isoformat(),
                "started_sent": True,
                "write_dispatched": True,
            }
        },
    )
    _conversations["unknown-write"] = {
        "messages": [SystemMessage(content="system")],
        "incomplete": state,
        "generation": 0,
    }
    events = []
    persistence = _RecordingPersistence()
    tool = StubTool(result={"id": 2})
    with (
        patch(
            "app.agent._build_llm",
            return_value=FakeToolCallingLLM(responses=[_aim("unexpected")]),
        ),
        patch.dict(_tools_by_name, {"create_todo": tool}),
    ):
        with pytest.raises(AgentExecutionError, match="outcome is unknown"):
            await process_message(
                "unknown-write",
                "create unknown",
                on_event=events.append,
                persistence=persistence,
            )

    tool.ainvoke.assert_not_awaited()
    failure = next(event for event in events if event["type"] == "step_failed")
    assert failure["error_code"] == "WRITE_RESULT_UNCERTAIN"
    assert failure["retryable"] is False
    assert persistence.write_applied is True


@pytest.mark.asyncio
async def test_fault_after_start_reconnect_reuses_journaled_turn_and_message_ids():
    requests = []

    class StartFault(_RecordingPersistence):
        async def start(self, request):
            requests.append(request)
            raise RuntimeError("connection dropped after commit")

    model = _ReplyModel()
    with patch("app.agent._build_llm", return_value=model):
        with pytest.raises(RuntimeError, match="after commit"):
            await process_message(
                "start-reconnect", "same request", persistence=StartFault()
            )
        await process_message(
            "start-reconnect",
            "same request",
            persistence=_RecordingPersistence(),
        )

    state = _conversations["start-reconnect"]["incomplete"]
    assert requests[0].turn_id == state["turn_id"]
    assert requests[0].message_id == state["user_message_id"]
    assert requests[0].assistant_message_id == state["assistant_message_id"]


@pytest.mark.asyncio
async def test_restart_history_hydrates_completed_user_and_assistant_only_before_model():
    seen: list[list] = []
    persistence = _RecordingPersistence()
    initial_history = [
        HumanMessage(content="old user"),
        AIMessage(content="old assistant"),
    ]

    def capture(messages):
        seen.append(list(messages))

    with patch("app.agent._build_llm", return_value=_ReplyModel(capture)):
        await process_message(
            "hydrated",
            "new user",
            persistence=persistence,
            initial_history=initial_history,
        )

    assert [type(message) for message in seen[0]] == [
        SystemMessage,
        HumanMessage,
        AIMessage,
        HumanMessage,
    ]
    assert [message.content for message in seen[0][1:]] == [
        "old user",
        "old assistant",
        "new user",
    ]


@pytest.mark.asyncio
async def test_live_cache_is_not_overwritten_by_hydrated_history_from_any_owner():
    seen = []
    _conversations["cache-hit"] = {
        "messages": [
            SystemMessage(content="system"),
            HumanMessage(content="owned cache"),
        ],
        "incomplete": None,
    }

    def capture(messages):
        seen.extend(messages)

    with patch("app.agent._build_llm", return_value=_ReplyModel(capture)):
        await process_message(
            "cache-hit",
            "new",
            initial_history=[HumanMessage(content="foreign durable history")],
        )

    assert [message.content for message in seen] == [
        "system",
        "owned cache",
        "new",
    ]


class _StreamRepository:
    def __init__(self):
        self.owner = uuid4()
        self.auth_session = uuid4()
        self.session_id = uuid4()
        self.turn_id = None
        self.starts = []
        self.user_exists = False
        self.completed = False
        self.result_uncertain = False
        self.uncertain_marks = 0
        self.failed: list[tuple[str, bool]] = []
        self.steps = []
        self.fail_checkpoint = False
        self.fail_model_error_checkpoint = False
        self.fail_completed_tool = False
        self.fail_write_terminal_step = False
        self.fail_complete = False
        now = datetime.now(timezone.utc)
        self.summary = SessionSummary(
            self.session_id, self.owner, "测试", now, now, now
        )

    async def is_auth_session_active(self, owner, auth_session):
        return owner == self.owner and auth_session == self.auth_session

    async def get_session(self, owner, session_id):
        if owner != self.owner or session_id != self.session_id:
            return None
        return SessionDetail(
            id=self.summary.id,
            owner_id=self.summary.owner_id,
            title=self.summary.title,
            created_at=self.summary.created_at,
            updated_at=self.summary.updated_at,
            last_message_at=self.summary.last_message_at,
        )

    async def start_turn(
        self, owner, session_id, turn_id, message_id, content, created_at
    ):
        assert owner == self.owner and session_id == self.session_id
        self.turn_id = turn_id
        self.starts.append((turn_id, message_id, content))
        self.user_exists = True
        return SimpleNamespace(id=turn_id)

    async def upsert_step(self, owner, turn_id, event):
        assert self.user_exists
        if (
            self.fail_checkpoint
            or (
                self.fail_completed_tool
                and event.tool == "create_todo"
                and event.status == "completed"
            )
            or (
                self.fail_write_terminal_step
                and event.tool == "create_todo"
                and event.status in {"completed", "failed"}
            )
            or (
                self.fail_model_error_checkpoint
                and event.error_code == "AGENT_MODEL_ERROR"
            )
        ):
            raise RuntimeError("database unavailable")
        self.steps.append(event)
        return True

    async def complete_turn(self, owner, turn_id, message_id, content, created_at):
        assert self.user_exists
        if self.fail_complete:
            raise RuntimeError("terminal commit unavailable")
        self.completed = True
        self.result_uncertain = False

    async def mark_turn_uncertain(self, owner, turn_id):
        assert owner == self.owner and turn_id == self.turn_id
        self.result_uncertain = True
        self.uncertain_marks += 1

    async def fail_turn(self, owner, turn_id, code, message, uncertain):
        self.failed.append((code, uncertain))


class _StreamService:
    def __init__(self, repo):
        self.repo = repo

    async def get_session(self, owner, session_id):
        return await self.repo.get_session(owner, session_id)


@pytest.fixture
def durable_client():
    repo = _StreamRepository()
    settings = AuthSettings(
        secret="x" * 32,
        access_cookie="todolist_access",
        allowed_origins=frozenset({"http://frontend.test"}),
        issuer="todolist-backend",
        database_url="postgresql://unused",
    )
    app.state.auth_settings = settings
    app.state.history_repository = repo
    app.state.history_service = _StreamService(repo)
    app.state.runtime_coordinator = SessionRuntimeCoordinator()
    app.state.recovery_ready = True
    now = datetime.now(timezone.utc)
    token = jwt.encode(
        {
            "sub": str(repo.owner),
            "sid": str(repo.auth_session),
            "iss": settings.issuer,
            "iat": now,
            "exp": now + timedelta(minutes=5),
        },
        settings.secret,
        algorithm="HS256",
    )
    client = TestClient(app)
    client.headers.update({"origin": "http://frontend.test"})
    client.cookies.set(settings.access_cookie, token)
    client.repo = repo
    yield client


def _stream_url(client) -> str:
    return f"/api/agent/stream?session_id={client.repo.session_id}"


def test_http_chat_uses_same_durable_executor_before_responding(durable_client):
    with patch("app.agent._build_llm", return_value=_ReplyModel()):
        response = durable_client.post(
            "/api/agent/chat",
            json={
                "message": "persist over http",
                "session_id": str(durable_client.repo.session_id),
            },
        )

    assert response.status_code == 200
    assert response.json()["data"]["reply"] == "durable reply"
    assert durable_client.repo.user_exists is True
    assert durable_client.repo.completed is True
    assert durable_client.repo.steps[-1].status == "completed"


def test_http_chat_history_fault_never_returns_false_success(durable_client):
    durable_client.repo.fail_checkpoint = True
    with patch("app.agent._build_llm", return_value=_ReplyModel()):
        response = durable_client.post(
            "/api/agent/chat",
            json={
                "message": "must fail",
                "session_id": str(durable_client.repo.session_id),
            },
        )

    assert response.status_code == 500
    assert durable_client.repo.completed is False
    assert durable_client.repo.failed == [("HISTORY_PERSISTENCE_FAILED", False)]


def test_terminal_reply_is_committed_before_reply_and_done(durable_client):
    with patch(
        "app.agent._build_llm", return_value=_ReplyModel(reply="committed reply")
    ):
        with durable_client.websocket_connect(_stream_url(durable_client)) as ws:
            ws.send_text("hello")
            events = []
            while not events or events[-1]["type"] != "reply":
                events.append(ws.receive_json())
            assert durable_client.repo.completed is True
            done = ws.receive_json()

    assert events[-1] == {"type": "reply", "content": "committed reply"}
    assert done == {"type": "done"}


def test_websocket_disconnect_drains_write_before_reconnect(durable_client):
    import threading

    from app.agent import _tools_by_name
    from app.main import _cancel_and_fully_drain
    from tests.test_agent import FakeToolCallingLLM, StubTool, _aim, _tc

    entered = threading.Event()
    drain_started = threading.Event()
    release = threading.Event()
    effects = 0

    async def write_once(_args):
        nonlocal effects
        effects += 1
        entered.set()
        await asyncio.to_thread(release.wait)
        return {"id": effects}

    async def observe_drain(task, timeout=None):
        drain_started.set()
        return await _cancel_and_fully_drain(task, timeout)

    tool = StubTool()
    tool.ainvoke.side_effect = write_once
    model = FakeToolCallingLLM(
        responses=[
            _aim(tool_calls=[_tc("create_todo", {"title": "once"})]),
            _aim("recovered"),
        ]
    )

    def release_after_disconnect():
        assert drain_started.wait(timeout=2)
        release.set()

    unblocker = threading.Thread(target=release_after_disconnect)
    unblocker.start()
    with (
        patch("app.agent._build_llm", return_value=model),
        patch.dict(_tools_by_name, {"create_todo": tool}),
        patch("app.main._cancel_and_fully_drain", new=observe_drain),
    ):
        with durable_client.websocket_connect(_stream_url(durable_client)) as ws:
            ws.send_text("create once")
            assert entered.wait(timeout=2)

        unblocker.join(timeout=2)
        assert unblocker.is_alive() is False
        assert durable_client.repo.completed is False
        assert durable_client.repo.result_uncertain is True

        with durable_client.websocket_connect(_stream_url(durable_client)) as ws:
            ws.send_text("create once")
            events = []
            while not events or events[-1]["type"] != "done":
                events.append(ws.receive_json())

    assert effects == 1
    assert tool.ainvoke.await_count == 1
    assert durable_client.repo.completed is True
    assert durable_client.repo.result_uncertain is False


@pytest.mark.parametrize("fault_point", ["done", "close"])
def test_success_terminal_transport_fault_adds_no_false_failure(
    durable_client, fault_point
):
    from fastapi import WebSocket
    from app.main import _WebSocketWriter

    original_send = _WebSocketWriter.send_json
    original_close = WebSocket.close
    faulted = False

    async def maybe_fail_send(self, event):
        nonlocal faulted
        if fault_point == "done" and event["type"] == "done" and not faulted:
            faulted = True
            raise RuntimeError("done delivery lost")
        await original_send(self, event)

    async def maybe_fail_close(self, code=1000, reason=None):
        nonlocal faulted
        if fault_point == "close" and not faulted:
            faulted = True
            raise RuntimeError("close failed")
        await original_close(self, code=code, reason=reason)

    with (
        patch("app.agent._build_llm", return_value=_ReplyModel()),
        patch.object(_WebSocketWriter, "send_json", new=maybe_fail_send),
        patch.object(WebSocket, "close", new=maybe_fail_close),
        durable_client.websocket_connect(_stream_url(durable_client)) as ws,
    ):
        ws.send_text("terminal")
        events = []
        while True:
            try:
                events.append(ws.receive_json())
            except Exception:
                break

    terminal = [
        event["type"]
        for event in events
        if event["type"] in {"reply", "done", "step_failed"}
    ]
    assert faulted is True
    assert terminal == (["reply"] if fault_point == "done" else ["reply", "done"])
    assert durable_client.repo.completed is True
    assert durable_client.repo.failed == []


def test_memory_ack_failure_after_committed_reply_emits_no_second_terminal(
    durable_client,
):
    with (
        patch("app.agent._build_llm", return_value=_ReplyModel()),
        patch("app.main.complete_turn", new=AsyncMock(return_value=False)),
        durable_client.websocket_connect(_stream_url(durable_client)) as ws,
    ):
        ws.send_text("hello")
        events = []
        while True:
            try:
                events.append(ws.receive_json())
            except Exception:
                break

    assert durable_client.repo.completed is True
    assert [event["type"] for event in events].count("reply") == 1
    assert all(event["type"] not in {"step_failed", "done"} for event in events)


def test_history_checkpoint_failure_emits_failure_without_reply_or_done(durable_client):
    durable_client.repo.fail_checkpoint = True
    with patch("app.agent._build_llm", return_value=_ReplyModel()):
        with durable_client.websocket_connect(_stream_url(durable_client)) as ws:
            ws.send_text("hello")
            events = []
            while True:
                try:
                    events.append(ws.receive_json())
                except Exception:
                    break

    assert len(events) == 1
    assert events[0]["type"] == "step_failed"
    assert events[0]["error_code"] == "HISTORY_PERSISTENCE_FAILED"
    assert events[0]["retryable"] is False
    assert "retry_token" not in events[0]
    assert durable_client.repo.failed == [("HISTORY_PERSISTENCE_FAILED", False)]


def test_disconnect_keeps_open_turn_and_reconnect_reuses_tool_and_event(durable_client):
    from app.agent import _tools_by_name
    from tests.test_agent import StubTool, _aim, _tc

    entered_second_model = asyncio.Event()

    class DisconnectModel:
        def __init__(self):
            self.calls = 0

        def bind_tools(self, _tools):
            return self

        async def ainvoke(self, _messages):
            self.calls += 1
            if self.calls == 1:
                return _aim(tool_calls=[_tc("create_todo", {"title": "once"})])
            if self.calls == 2:
                entered_second_model.set()
                await asyncio.Future()
            return _aim("reconnected reply")

    model = DisconnectModel()
    tool = StubTool(result={"id": 1})
    first_action = None
    with (
        patch("app.agent._build_llm", return_value=model),
        patch.dict(_tools_by_name, {"create_todo": tool}),
    ):
        with durable_client.websocket_connect(_stream_url(durable_client)) as ws:
            ws.send_text("create once")
            while first_action is None:
                event = ws.receive_json()
                if event["type"] == "action_completed":
                    first_action = event

        assert entered_second_model.is_set()
        assert durable_client.repo.failed == []

        with durable_client.websocket_connect(_stream_url(durable_client)) as ws:
            ws.send_text("create once")
            replayed = []
            while not replayed or replayed[-1]["type"] != "done":
                replayed.append(ws.receive_json())

    tool.ainvoke.assert_awaited_once()
    assert len(durable_client.repo.starts) == 2
    assert durable_client.repo.starts[0][:2] == durable_client.repo.starts[1][:2]
    assert durable_client.repo.completed is True
    assert (
        sum(
            str(step.event_id) == first_action["event_id"]
            and step.status == "completed"
            for step in durable_client.repo.steps
        )
        == 1
    )
    assert all(event.get("event_id") != first_action["event_id"] for event in replayed)


@pytest.mark.parametrize(
    "fault_event",
    ["step_started", "action_completed", "step_failed", "tool_step_failed"],
)
def test_checkpointed_send_fault_reconnects_without_failing_turn_or_repeating_tool(
    durable_client, fault_event
):
    from app.agent import _tools_by_name
    from app.main import _WebSocketWriter
    from tests.test_agent import FakeToolCallingLLM, StubTool, _aim, _tc

    if fault_event == "step_failed":

        class Model:
            def __init__(self):
                self.calls = 0

            def bind_tools(self, _tools):
                return self

            async def ainvoke(self, _messages):
                self.calls += 1
                if self.calls == 1:
                    raise RuntimeError("model unavailable")
                return _aim("recovered")

        model = Model()
    else:
        model = FakeToolCallingLLM(
            responses=[
                _aim(tool_calls=[_tc("create_todo", {"title": "once"})]),
                _aim("recovered"),
            ]
        )
    tool = (
        StubTool(side_effect=TimeoutError("tool unavailable"))
        if fault_event == "tool_step_failed"
        else StubTool(result={"id": 1})
    )
    target_event = "step_failed" if fault_event == "tool_step_failed" else fault_event
    original_send = _WebSocketWriter.send_json
    failed_event = None

    async def fail_once(self, event):
        nonlocal failed_event
        if event["type"] == target_event and failed_event is None:
            failed_event = dict(event)
            raise RuntimeError(f"{target_event} delivery lost")
        await original_send(self, event)

    with (
        patch("app.agent._build_llm", return_value=model),
        patch.dict(_tools_by_name, {"create_todo": tool}),
        patch.object(_WebSocketWriter, "send_json", new=fail_once),
    ):
        with durable_client.websocket_connect(_stream_url(durable_client)) as ws:
            ws.send_text("same request")
            while True:
                try:
                    ws.receive_json()
                except Exception:
                    break

        assert durable_client.repo.failed == []
        with durable_client.websocket_connect(_stream_url(durable_client)) as ws:
            ws.send_text("same request")
            replayed = []
            while not replayed or replayed[-1]["type"] != "done":
                replayed.append(ws.receive_json())

    assert failed_event is not None
    assert len(durable_client.repo.starts) == 2
    assert durable_client.repo.starts[0][:2] == durable_client.repo.starts[1][:2]
    assert durable_client.repo.completed is True
    assert (
        sum(
            event.get("event_id") == failed_event["event_id"]
            and event["type"] == failed_event["type"]
            for event in replayed
        )
        == 1
    )
    if fault_event != "step_failed":
        tool.ainvoke.assert_awaited_once()
    else:
        snapshots = [
            step
            for step in durable_client.repo.steps
            if str(step.event_id) == failed_event["event_id"]
            and step.status in {"running", "failed"}
        ]
        running = next(step for step in snapshots if step.status == "running")
        failed = [step for step in snapshots if step.status == "failed"]
        assert len(failed) == 2  # initial checkpoint plus fresh-sink replay
        for snapshot in failed:
            assert snapshot.label == running.label == "理解请求"
            assert snapshot.started_at == running.started_at
            assert snapshot.tool == running.tool is None
            assert snapshot.args == running.args == {}
            assert snapshot.confirmation_id == running.confirmation_id is None
            assert snapshot.confirmation_message is None
            assert snapshot.confirmation_approved is None


def test_respond_model_failure_replay_preserves_canonical_step_snapshot(
    durable_client,
):
    from app.agent import _tools_by_name
    from app.main import _WebSocketWriter
    from tests.test_agent import StubTool, _aim, _tc

    class Model:
        def __init__(self):
            self.ainvoke = AsyncMock(
                side_effect=[
                    _aim(tool_calls=[_tc("list_todos", {})]),
                    RuntimeError("respond model unavailable"),
                    _aim("recovered"),
                ]
            )

        def bind_tools(self, _tools):
            return self

    model = Model()
    tool = StubTool(result={"items": [], "total": 0})
    original_send = _WebSocketWriter.send_json
    failed_event = None

    async def fail_respond_failure_once(self, event):
        nonlocal failed_event
        if (
            event["type"] == "step_failed"
            and event["step_id"] == "respond"
            and failed_event is None
        ):
            failed_event = dict(event)
            raise RuntimeError("respond failure delivery lost")
        await original_send(self, event)

    with (
        patch("app.agent._build_llm", return_value=model),
        patch.dict(_tools_by_name, {"list_todos": tool}),
        patch.object(_WebSocketWriter, "send_json", new=fail_respond_failure_once),
    ):
        with durable_client.websocket_connect(_stream_url(durable_client)) as ws:
            ws.send_text("list")
            while True:
                try:
                    ws.receive_json()
                except Exception:
                    break

        with durable_client.websocket_connect(_stream_url(durable_client)) as ws:
            ws.send_text("list")
            replayed = []
            while not replayed or replayed[-1]["type"] != "done":
                replayed.append(ws.receive_json())

    assert failed_event is not None
    assert failed_event["label"] == "生成回复"
    assert failed_event["started_at"]
    assert failed_event["tool"] is None
    assert failed_event["args"] == {}
    assert failed_event["confirmation_id"] is None
    assert failed_event["confirmation_message"] is None
    assert failed_event["confirmation_approved"] is None
    failed = [
        step
        for step in durable_client.repo.steps
        if str(step.event_id) == failed_event["event_id"] and step.status == "failed"
    ]
    assert len(failed) == 2  # initial checkpoint plus fresh-sink replay
    assert all(step.label == "生成回复" for step in failed)
    assert failed[0].started_at == failed[1].started_at
    assert all(step.tool is None for step in failed)
    assert all(step.args == {} for step in failed)
    assert all(step.confirmation_id is None for step in failed)
    assert all(step.confirmation_message is None for step in failed)
    assert all(step.confirmation_approved is None for step in failed)
    tool.ainvoke.assert_awaited_once_with({})
    assert durable_client.repo.failed == []
    assert durable_client.repo.completed is True


def test_model_failure_checkpoint_fault_reports_only_history_failure(durable_client):
    class BrokenModel:
        def bind_tools(self, _tools):
            return self

        async def ainvoke(self, _messages):
            raise RuntimeError("model unavailable")

    durable_client.repo.fail_model_error_checkpoint = True
    with (
        patch("app.agent._build_llm", return_value=BrokenModel()),
        durable_client.websocket_connect(_stream_url(durable_client)) as ws,
    ):
        ws.send_text("fail model")
        events = []
        while True:
            try:
                events.append(ws.receive_json())
            except Exception:
                break

    terminal = [event for event in events if event["type"] == "step_failed"]
    assert [event["error_code"] for event in terminal] == ["HISTORY_PERSISTENCE_FAILED"]
    assert all(event["type"] not in {"reply", "done"} for event in events)
    assert durable_client.repo.failed == [("HISTORY_PERSISTENCE_FAILED", False)]


def test_retry_creates_a_new_durable_attempt_before_reply(durable_client):
    from app.agent import _tools_by_name
    from tests.test_agent import FakeToolCallingLLM, StubTool, _aim, _tc

    model = FakeToolCallingLLM(
        responses=[
            _aim(tool_calls=[_tc("list_todos", {})]),
            _aim("original turn finished"),
        ]
    )
    failure_events = []

    async def seed_retry():
        with (
            patch("app.agent._build_llm", return_value=model),
            patch.dict(
                _tools_by_name,
                {"list_todos": StubTool(side_effect=TimeoutError("read timeout"))},
            ),
        ):
            await process_message(
                str(durable_client.repo.session_id),
                "list",
                on_event=failure_events.append,
                owner_id=str(durable_client.repo.owner),
                runtime_generation=0,
            )

    asyncio.run(seed_retry())
    failure = next(event for event in failure_events if event["type"] == "step_failed")
    retry_tool = StubTool(result={"items": [], "total": 0})
    with (
        patch.dict(_tools_by_name, {"list_todos": retry_tool}),
        durable_client.websocket_connect(_stream_url(durable_client)) as ws,
    ):
        ws.send_json(
            {
                "type": "retry_step",
                "session_id": str(durable_client.repo.session_id),
                "step_id": failure["step_id"],
                "retry_token": failure["retry_token"],
            }
        )
        events = []
        while not events or events[-1]["type"] != "done":
            events.append(ws.receive_json())

    retry_tool.ainvoke.assert_awaited_once_with({})
    assert len(durable_client.repo.starts) == 1
    assert durable_client.repo.starts[0][2].startswith("Retry read-only step ")
    assert durable_client.repo.completed is True
    assert [event["type"] for event in events] == [
        "step_started",
        "action_completed",
        "reply",
        "done",
    ]
    with durable_client.websocket_connect(_stream_url(durable_client)) as ws:
        ws.send_json(
            {
                "type": "retry_step",
                "session_id": str(durable_client.repo.session_id),
                "step_id": failure["step_id"],
                "retry_token": failure["retry_token"],
            }
        )
        invalid = ws.receive_json()
        with pytest.raises(WebSocketDisconnect):
            ws.receive_json()
    assert invalid["error_code"] == "INVALID_RETRY_STEP"


def test_retry_reply_send_fault_reconnects_without_repeating_tool(durable_client):
    from app.agent import _tools_by_name
    from app.main import _WebSocketWriter
    from tests.test_agent import FakeToolCallingLLM, StubTool, _aim, _tc

    seed_events = []
    seed_model = FakeToolCallingLLM(
        responses=[
            _aim(tool_calls=[_tc("list_todos", {})]),
            _aim("original turn finished"),
        ]
    )

    async def seed_retry():
        with (
            patch("app.agent._build_llm", return_value=seed_model),
            patch.dict(
                _tools_by_name,
                {"list_todos": StubTool(side_effect=TimeoutError("seed timeout"))},
            ),
        ):
            await process_message(
                str(durable_client.repo.session_id),
                "list",
                on_event=seed_events.append,
                owner_id=str(durable_client.repo.owner),
                runtime_generation=0,
            )

    asyncio.run(seed_retry())
    failure = next(event for event in seed_events if event["type"] == "step_failed")
    retry_tool = StubTool(result={"items": []})
    original_send = _WebSocketWriter.send_json
    reply_failed = False

    async def fail_reply_once(self, event):
        nonlocal reply_failed
        if event["type"] == "reply" and not reply_failed:
            reply_failed = True
            raise RuntimeError("reply delivery lost")
        await original_send(self, event)

    retry_frame = {
        "type": "retry_step",
        "session_id": str(durable_client.repo.session_id),
        "step_id": failure["step_id"],
        "retry_token": failure["retry_token"],
    }
    with (
        patch.dict(_tools_by_name, {"list_todos": retry_tool}),
        patch.object(_WebSocketWriter, "send_json", new=fail_reply_once),
    ):
        with durable_client.websocket_connect(_stream_url(durable_client)) as ws:
            ws.send_json(retry_frame)
            while True:
                try:
                    ws.receive_json()
                except Exception:
                    break
        assert durable_client.repo.failed == []
        with durable_client.websocket_connect(_stream_url(durable_client)) as ws:
            ws.send_json(retry_frame)
            replayed = [ws.receive_json(), ws.receive_json()]

    assert reply_failed is True
    retry_tool.ainvoke.assert_awaited_once_with({})
    assert len(durable_client.repo.starts) == 2
    assert durable_client.repo.starts[0][:2] == durable_client.repo.starts[1][:2]
    assert [event["type"] for event in replayed] == ["reply", "done"]
    assert durable_client.repo.completed is True


@pytest.mark.parametrize("fault_point", ["done", "close"])
def test_retry_success_terminal_transport_fault_adds_no_false_failure(
    durable_client, fault_point
):
    from fastapi import WebSocket
    from app.agent import _tools_by_name
    from app.main import _WebSocketWriter
    from tests.test_agent import FakeToolCallingLLM, StubTool, _aim, _tc

    seed_events = []
    seed_model = FakeToolCallingLLM(
        responses=[
            _aim(tool_calls=[_tc("list_todos", {})]),
            _aim("original turn finished"),
        ]
    )

    async def seed_retry():
        with (
            patch("app.agent._build_llm", return_value=seed_model),
            patch.dict(
                _tools_by_name,
                {"list_todos": StubTool(side_effect=TimeoutError("seed timeout"))},
            ),
        ):
            await process_message(
                str(durable_client.repo.session_id),
                "list",
                on_event=seed_events.append,
                owner_id=str(durable_client.repo.owner),
                runtime_generation=0,
            )

    asyncio.run(seed_retry())
    failure = next(event for event in seed_events if event["type"] == "step_failed")
    retry_tool = StubTool(result={"items": []})
    original_send = _WebSocketWriter.send_json
    original_close = WebSocket.close
    faulted = False

    async def maybe_fail_send(self, event):
        nonlocal faulted
        if fault_point == "done" and event["type"] == "done" and not faulted:
            faulted = True
            raise RuntimeError("done delivery lost")
        await original_send(self, event)

    async def maybe_fail_close(self, code=1000, reason=None):
        nonlocal faulted
        if fault_point == "close" and not faulted:
            faulted = True
            raise RuntimeError("close failed")
        await original_close(self, code=code, reason=reason)

    with (
        patch.dict(_tools_by_name, {"list_todos": retry_tool}),
        patch.object(_WebSocketWriter, "send_json", new=maybe_fail_send),
        patch.object(WebSocket, "close", new=maybe_fail_close),
        durable_client.websocket_connect(_stream_url(durable_client)) as ws,
    ):
        ws.send_json(
            {
                "type": "retry_step",
                "session_id": str(durable_client.repo.session_id),
                "step_id": failure["step_id"],
                "retry_token": failure["retry_token"],
            }
        )
        events = []
        while True:
            try:
                events.append(ws.receive_json())
            except Exception:
                break

    terminal = [
        event["type"]
        for event in events
        if event["type"] in {"reply", "done", "step_failed"}
    ]
    assert faulted is True
    assert terminal == (["reply"] if fault_point == "done" else ["reply", "done"])
    retry_tool.ainvoke.assert_awaited_once_with({})
    assert durable_client.repo.completed is True
    assert durable_client.repo.failed == []


@pytest.mark.parametrize(
    ("terminal_type", "tool_effect", "expected_status"),
    [
        ("action_completed", {"items": [], "total": 0}, "completed"),
        ("step_failed", TimeoutError("retry timeout"), "failed"),
    ],
)
def test_retry_terminal_send_fault_replays_same_attempt_without_repeating_tool(
    durable_client, terminal_type, tool_effect, expected_status
):
    from app.agent import _tools_by_name
    from app.main import _WebSocketWriter
    from tests.test_agent import FakeToolCallingLLM, StubTool, _aim, _tc

    seed_events = []
    seed_model = FakeToolCallingLLM(
        responses=[
            _aim(tool_calls=[_tc("list_todos", {})]),
            _aim("original turn finished"),
        ]
    )

    async def seed_retry():
        with (
            patch("app.agent._build_llm", return_value=seed_model),
            patch.dict(
                _tools_by_name,
                {"list_todos": StubTool(side_effect=TimeoutError("seed timeout"))},
            ),
        ):
            await process_message(
                str(durable_client.repo.session_id),
                "list",
                on_event=seed_events.append,
                owner_id=str(durable_client.repo.owner),
                runtime_generation=0,
            )

    asyncio.run(seed_retry())
    source_failure = next(
        event for event in seed_events if event["type"] == "step_failed"
    )
    retry_tool = (
        StubTool(side_effect=tool_effect)
        if isinstance(tool_effect, Exception)
        else StubTool(result=tool_effect)
    )
    original_send = _WebSocketWriter.send_json
    failed_event = None

    async def fail_once(self, event):
        nonlocal failed_event
        if event["type"] == terminal_type and failed_event is None:
            failed_event = dict(event)
            raise RuntimeError(f"{terminal_type} delivery lost")
        await original_send(self, event)

    retry_frame = {
        "type": "retry_step",
        "session_id": str(durable_client.repo.session_id),
        "step_id": source_failure["step_id"],
        "retry_token": source_failure["retry_token"],
    }
    with (
        patch.dict(_tools_by_name, {"list_todos": retry_tool}),
        patch.object(_WebSocketWriter, "send_json", new=fail_once),
    ):
        with durable_client.websocket_connect(_stream_url(durable_client)) as ws:
            ws.send_json(retry_frame)
            while True:
                try:
                    ws.receive_json()
                except Exception:
                    break

        assert durable_client.repo.failed == []
        with durable_client.websocket_connect(_stream_url(durable_client)) as ws:
            ws.send_json(retry_frame)
            replayed = []
            while True:
                try:
                    replayed.append(ws.receive_json())
                    if replayed[-1]["type"] == "done":
                        break
                except Exception:
                    break

    assert failed_event is not None
    retry_tool.ainvoke.assert_awaited_once_with({})
    assert len(durable_client.repo.starts) == 2
    assert durable_client.repo.starts[0][:2] == durable_client.repo.starts[1][:2]
    assert (
        sum(
            event.get("event_id") == failed_event["event_id"]
            and event["type"] == terminal_type
            for event in replayed
        )
        == 1
    )
    assert all(event["type"] != "done" for event in replayed) == (
        expected_status == "failed"
    )
    if expected_status == "completed":
        assert durable_client.repo.completed is True
        assert durable_client.repo.failed == []
    else:
        assert durable_client.repo.completed is False
        assert durable_client.repo.failed == [("TOOL_TIMEOUT", False)]


@pytest.mark.asyncio
async def test_concurrent_retry_claims_execute_the_tool_only_once():
    from app.agent import InvalidRetryStep, _tools_by_name, retry_failed_step
    from tests.test_agent import FakeToolCallingLLM, StubTool, _aim, _tc

    events = []
    model = FakeToolCallingLLM(
        responses=[
            _aim(tool_calls=[_tc("list_todos", {})]),
            _aim("original finished"),
        ]
    )
    with (
        patch("app.agent._build_llm", return_value=model),
        patch.dict(
            _tools_by_name,
            {"list_todos": StubTool(side_effect=TimeoutError("seed timeout"))},
        ),
    ):
        await process_message(
            "concurrent-retry",
            "list",
            on_event=events.append,
            owner_id="owner-a",
            runtime_generation=2,
        )
    failure = next(event for event in events if event["type"] == "step_failed")
    retry_tool = StubTool(result={"items": []})
    persistence_one = _RecordingPersistence()
    persistence_two = _RecordingPersistence()
    with patch.dict(_tools_by_name, {"list_todos": retry_tool}):
        results = await asyncio.gather(
            retry_failed_step(
                "concurrent-retry",
                failure["step_id"],
                failure["retry_token"],
                owner_id="owner-a",
                runtime_generation=2,
                persistence=persistence_one,
            ),
            retry_failed_step(
                "concurrent-retry",
                failure["step_id"],
                failure["retry_token"],
                owner_id="owner-a",
                runtime_generation=2,
                persistence=persistence_two,
            ),
            return_exceptions=True,
        )

    retry_tool.ainvoke.assert_awaited_once_with({})
    assert sum(isinstance(result, InvalidRetryStep) for result in results) == 1
    assert sum(not isinstance(result, Exception) for result in results) == 1
    assert (
        sum(persistence.started for persistence in (persistence_one, persistence_two))
        == 1
    )


@pytest.mark.asyncio
async def test_terminal_checkpoint_keeps_complete_step_and_confirmation_snapshot():
    repo = _StreamRepository()
    coordinator = SessionRuntimeCoordinator()
    lease = await coordinator.acquire(repo.owner, repo.session_id)
    persistence = RepositoryTurnPersistence(repo, coordinator, lease)
    turn_id = uuid4()
    await persistence.start(
        SimpleNamespace(
            turn_id=turn_id,
            message_id=uuid4(),
            assistant_message_id=uuid4(),
            message="delete",
            created_at=datetime.now(timezone.utc),
        )
    )
    event_id = str(uuid4())
    await persistence.checkpoint(
        {
            "type": "step_started",
            "event_id": event_id,
            "step_id": "delete-1",
            "label": "调用 Todo API",
            "tool": "delete_todo",
            "args": {"todo_id": 7},
            "started_at": datetime.now(timezone.utc).isoformat(),
        }
    )
    await persistence.checkpoint(
        {
            "type": "confirmation_required",
            "event_id": event_id,
            "step_id": "delete-1",
            "confirmation_id": "confirm-7",
            "message": "confirm delete",
        }
    )
    await persistence.checkpoint(
        {
            "type": "action_completed",
            "event_id": event_id,
            "step_id": "delete-1",
            "action": "delete_todo",
            "result": {"deleted": True},
            "confirmation_approved": True,
        }
    )

    terminal = repo.steps[-1]
    assert terminal.label == "调用 Todo API"
    assert terminal.tool == "delete_todo"
    assert terminal.args == {"todo_id": 7}
    assert terminal.confirmation_id == "confirm-7"
    assert terminal.confirmation_message == "confirm delete"
    assert terminal.confirmation_approved is True


@pytest.mark.asyncio
async def test_step_snapshot_survives_reconnect_with_new_persistence_instance():
    repo = _StreamRepository()
    coordinator = SessionRuntimeCoordinator()
    lease = await coordinator.acquire(repo.owner, repo.session_id)
    turn_id = uuid4()
    request = SimpleNamespace(
        turn_id=turn_id,
        message_id=uuid4(),
        assistant_message_id=uuid4(),
        message="delete",
        created_at=datetime.now(timezone.utc),
    )
    event_id = str(uuid4())
    first = RepositoryTurnPersistence(repo, coordinator, lease)
    await first.start(request)
    await first.checkpoint(
        {
            "type": "step_started",
            "event_id": event_id,
            "step_id": "delete-1",
            "label": "调用 Todo API",
            "tool": "delete_todo",
            "args": {"todo_id": 7},
            "started_at": datetime.now(timezone.utc).isoformat(),
        }
    )
    await first.checkpoint(
        {
            "type": "confirmation_required",
            "event_id": event_id,
            "step_id": "delete-1",
            "confirmation_id": "confirm-7",
            "message": "confirm delete",
        }
    )

    second = RepositoryTurnPersistence(repo, coordinator, lease)
    await second.start(request)
    await second.checkpoint(
        {
            "type": "action_completed",
            "event_id": event_id,
            "step_id": "delete-1",
            "label": "调用 Todo API",
            "tool": "delete_todo",
            "args": {"todo_id": 7},
            "started_at": repo.steps[0].started_at.isoformat(),
            "action": "delete_todo",
            "result": {"deleted": True},
            "confirmation_id": "confirm-7",
            "confirmation_message": "confirm delete",
            "confirmation_approved": True,
        }
    )

    terminal = repo.steps[-1]
    assert terminal.label == "调用 Todo API"
    assert terminal.tool == "delete_todo"
    assert terminal.args == {"todo_id": 7}
    assert terminal.confirmation_id == "confirm-7"
    assert terminal.confirmation_message == "confirm delete"
    assert terminal.confirmation_approved is True


def test_write_effect_then_checkpoint_failure_is_uncertain_and_not_retryable(
    durable_client,
):
    from app.agent import _tools_by_name
    from tests.test_agent import FakeToolCallingLLM, StubTool, _aim, _tc

    model = FakeToolCallingLLM(
        responses=[
            _aim(tool_calls=[_tc("create_todo", {"title": "write once"})]),
            _aim("must not be sent"),
        ]
    )
    tool = StubTool(result={"id": 1, "title": "write once"})
    durable_client.repo.fail_completed_tool = True
    with (
        patch("app.agent._build_llm", return_value=model),
        patch.dict(_tools_by_name, {"create_todo": tool}),
        durable_client.websocket_connect(_stream_url(durable_client)) as ws,
    ):
        ws.send_text("create it")
        events = []
        while True:
            try:
                events.append(ws.receive_json())
            except Exception:
                break

    tool.ainvoke.assert_awaited_once_with({"title": "write once"})
    assert events[-1]["error_code"] == "HISTORY_PERSISTENCE_FAILED"
    assert all(event["type"] not in {"reply", "done"} for event in events)
    assert all("retry_token" not in event for event in events)
    assert durable_client.repo.failed == [("HISTORY_PERSISTENCE_FAILED", True)]


def test_write_dispatch_connection_error_then_checkpoint_failure_is_uncertain(
    durable_client,
):
    from app.agent import _tools_by_name
    from tests.test_agent import FakeToolCallingLLM, StubTool, _aim, _tc

    model = FakeToolCallingLLM(
        responses=[_aim(tool_calls=[_tc("create_todo", {"title": "maybe"})])]
    )
    tool = StubTool(side_effect=ConnectionError("response lost after dispatch"))
    durable_client.repo.fail_write_terminal_step = True
    with (
        patch("app.agent._build_llm", return_value=model),
        patch.dict(_tools_by_name, {"create_todo": tool}),
        durable_client.websocket_connect(_stream_url(durable_client)) as ws,
    ):
        ws.send_text("create maybe")
        events = []
        while True:
            try:
                events.append(ws.receive_json())
            except Exception:
                break

    tool.ainvoke.assert_awaited_once_with({"title": "maybe"})
    assert events[-1]["error_code"] == "HISTORY_PERSISTENCE_FAILED"
    assert all(event["type"] not in {"reply", "done"} for event in events)
    assert durable_client.repo.failed == [("HISTORY_PERSISTENCE_FAILED", True)]


def test_write_effect_then_terminal_failure_is_uncertain_without_reply_or_done(
    durable_client,
):
    from app.agent import _tools_by_name
    from tests.test_agent import FakeToolCallingLLM, StubTool, _aim, _tc

    model = FakeToolCallingLLM(
        responses=[
            _aim(tool_calls=[_tc("create_todo", {"title": "write once"})]),
            _aim("must not be sent"),
        ]
    )
    tool = StubTool(result={"id": 1})
    durable_client.repo.fail_complete = True
    with (
        patch("app.agent._build_llm", return_value=model),
        patch.dict(_tools_by_name, {"create_todo": tool}),
        durable_client.websocket_connect(_stream_url(durable_client)) as ws,
    ):
        ws.send_text("create it")
        events = []
        while True:
            try:
                events.append(ws.receive_json())
            except Exception:
                break

    tool.ainvoke.assert_awaited_once()
    assert events[-1]["error_code"] == "HISTORY_PERSISTENCE_FAILED"
    assert all(event["type"] not in {"reply", "done"} for event in events)
    assert durable_client.repo.failed == [("HISTORY_PERSISTENCE_FAILED", True)]


@pytest.mark.asyncio
async def test_delete_barrier_runs_before_cascade_delete():
    order: list[str] = []

    class Repo:
        async def get_session(self, owner, session_id):
            return object()

        async def delete_session(self, owner, session_id):
            order.append("delete")
            return True

    async def barrier(owner_id, session_id, delete_operation):
        order.append("barrier-start")
        result = await delete_operation()
        order.append("barrier-finish")
        return result

    service = HistoryService(Repo(), barrier)
    assert await service.delete_session(uuid4(), uuid4()) is True
    assert order == ["barrier-start", "delete", "barrier-finish"]


@pytest.mark.asyncio
async def test_runtime_coordinator_reclaims_many_chat_and_delete_lifecycles():
    coordinator = SessionRuntimeCoordinator()
    task = asyncio.current_task()
    assert task is not None

    for _ in range(50):
        owner = uuid4()
        session_id = uuid4()
        lease = await coordinator.acquire(owner, session_id)
        await coordinator.attach(lease, task)
        await coordinator.detach(lease, task)
        await coordinator.release(lease)
        assert await coordinator.delete_barrier(
            owner, session_id, AsyncMock(return_value=True)
        )

    assert coordinator.state_size == 0
    with pytest.raises(HistoryPersistenceError, match="lease.*released"):
        await coordinator.release(lease)


@pytest.mark.asyncio
async def test_executor_attach_failure_releases_its_acquired_lease():
    class AttachFaultCoordinator(SessionRuntimeCoordinator):
        async def attach(self, lease, task):
            raise RuntimeError("attach failed")

    coordinator = AttachFaultCoordinator()
    repo = _StreamRepository()
    detail = await repo.get_session(repo.owner, repo.session_id)

    with pytest.raises(RuntimeError, match="attach failed"):
        await _execute_durable_message(
            repo,
            coordinator,
            repo.owner,
            repo.session_id,
            "hello",
            detail,
        )

    assert coordinator.state_size == 0


@pytest.mark.asyncio
async def test_delete_tombstone_survives_decision_and_all_stale_leases():
    coordinator = SessionRuntimeCoordinator()
    owner = uuid4()
    session_id = uuid4()
    first = await coordinator.acquire(owner, session_id)
    second = await coordinator.acquire(owner, session_id)
    deleting = asyncio.Event()
    finish_delete = asyncio.Event()

    async def delete_operation():
        deleting.set()
        await finish_delete.wait()
        return True

    delete_task = asyncio.create_task(
        coordinator.delete_barrier(owner, session_id, delete_operation)
    )
    await deleting.wait()
    assert (owner, session_id) in coordinator._tombstones
    with pytest.raises(HistoryPersistenceError, match="stale"):
        await coordinator.run(first, AsyncMock())

    await coordinator.release(first)
    finish_delete.set()
    assert await delete_task is True
    assert (owner, session_id) in coordinator._tombstones
    assert coordinator.state_size == 1

    await coordinator.release(second)
    assert coordinator.state_size == 0


@pytest.mark.asyncio
async def test_releasing_leases_does_not_replace_lock_with_operations_waiting():
    coordinator = SessionRuntimeCoordinator()
    owner = uuid4()
    session_id = uuid4()
    first = await coordinator.acquire(owner, session_id)
    second = await coordinator.acquire(owner, session_id)
    entered = asyncio.Event()
    release_operation = asyncio.Event()
    concurrent = 0
    maximum = 0

    async def operation():
        nonlocal concurrent, maximum
        concurrent += 1
        maximum = max(maximum, concurrent)
        entered.set()
        await release_operation.wait()
        concurrent -= 1

    first_run = asyncio.create_task(coordinator.run(first, operation))
    await entered.wait()
    second_run = asyncio.create_task(coordinator.run(second, operation))
    while coordinator._operations.get((owner, session_id)) != 2:
        await asyncio.sleep(0)
    await coordinator.release(first)
    await coordinator.release(second)
    assert coordinator.state_size == 1

    release_operation.set()
    await asyncio.gather(first_run, second_run)
    assert maximum == 1
    assert coordinator.state_size == 0


@pytest.mark.asyncio
async def test_delete_generation_guard_rejects_late_checkpoint_before_repository_call():
    coordinator = SessionRuntimeCoordinator()
    owner = uuid4()
    session_id = uuid4()
    lease = await coordinator.acquire(owner, session_id)
    await coordinator.delete_barrier(owner, session_id)
    called = False

    async def late_write():
        nonlocal called
        called = True

    with pytest.raises(HistoryPersistenceError, match="stale"):
        await coordinator.run(lease, late_write)
    assert called is False


@pytest.mark.asyncio
async def test_active_delete_cancels_and_drains_inflight_persistence_before_returning():
    coordinator = SessionRuntimeCoordinator()
    owner = uuid4()
    session_id = uuid4()
    lease = await coordinator.acquire(owner, session_id)
    entered = asyncio.Event()

    async def blocked_write():
        entered.set()
        await asyncio.Future()

    worker = asyncio.create_task(coordinator.run(lease, blocked_write))
    await coordinator.attach(lease, worker)
    await entered.wait()
    await asyncio.wait_for(coordinator.delete_barrier(owner, session_id), timeout=1)

    assert worker.cancelled()


@pytest.mark.asyncio
async def test_delete_barrier_waits_for_task_that_ignores_first_cancellation():
    coordinator = SessionRuntimeCoordinator()
    owner = uuid4()
    session_id = uuid4()
    lease = await coordinator.acquire(owner, session_id)
    entered = asyncio.Event()
    release = asyncio.Event()

    async def stubborn_write():
        entered.set()
        try:
            await asyncio.Future()
        except asyncio.CancelledError:
            await release.wait()

    worker = asyncio.create_task(stubborn_write())
    await coordinator.attach(lease, worker)
    await entered.wait()
    deleting = asyncio.create_task(coordinator.delete_barrier(owner, session_id))
    await asyncio.sleep(0.15)
    assert deleting.done() is False
    release.set()
    await asyncio.wait_for(deleting, timeout=1)
    assert worker.done()


@pytest.mark.asyncio
async def test_delete_drain_timeout_fails_closed_before_cascade(monkeypatch):
    coordinator = SessionRuntimeCoordinator()
    owner = uuid4()
    session_id = uuid4()
    lease = await coordinator.acquire(owner, session_id)
    entered = asyncio.Event()
    release = asyncio.Event()

    async def stubborn_write():
        entered.set()
        try:
            await asyncio.Future()
        except asyncio.CancelledError:
            await release.wait()

    worker = asyncio.create_task(stubborn_write())
    await coordinator.attach(lease, worker)
    await entered.wait()
    monkeypatch.setenv("AGENT_DELETE_DRAIN_TIMEOUT_SECONDS", "0.01")
    with patch("app.main.delete_history", new=AsyncMock()) as cascade:
        with pytest.raises(TimeoutError):
            await coordinator.delete_barrier(owner, session_id)

    cascade.assert_not_awaited()
    assert worker.done() is False
    release.set()
    await worker


@pytest.mark.asyncio
async def test_hydrated_history_uses_existing_message_budget(monkeypatch):
    import app.agent as agent

    monkeypatch.setattr(agent, "MAX_MESSAGES_PER_SESSION", 4)
    seen = []

    def capture(messages):
        seen.extend(messages)

    with patch("app.agent._build_llm", return_value=_ReplyModel(capture)):
        await process_message(
            "bounded-hydration",
            "new",
            persistence=_RecordingPersistence(),
            initial_history=[HumanMessage(content=str(index)) for index in range(8)],
        )

    assert len(seen) == 5  # system + three hydrated messages + current user
    assert [message.content for message in seen[1:-1]] == ["5", "6", "7"]


@pytest.mark.asyncio
async def test_confirmation_is_bound_to_owner_session_turn_and_runtime_generation():
    from app.agent import _tools_by_name, resolve_confirmation
    from tests.test_agent import FakeToolCallingLLM, StubTool, _aim, _tc

    ready = asyncio.Event()
    events = []

    async def sink(event):
        events.append(event)
        if event["type"] == "confirmation_required":
            ready.set()

    model = FakeToolCallingLLM(
        responses=[
            _aim(tool_calls=[_tc("delete_todo", {"todo_id": 7})]),
            _aim("deleted"),
        ]
    )
    tool = StubTool(result={"deleted": True})
    with (
        patch("app.agent._build_llm", return_value=model),
        patch.dict(_tools_by_name, {"delete_todo": tool}),
    ):
        task = asyncio.create_task(
            process_message(
                "bound-session",
                "delete",
                sink,
                owner_id="owner-a",
                runtime_generation=4,
            )
        )
        await asyncio.wait_for(ready.wait(), timeout=1)
        confirmation_id = next(
            event["confirmation_id"]
            for event in events
            if event["type"] == "confirmation_required"
        )
        assert (
            resolve_confirmation(
                "bound-session",
                confirmation_id,
                True,
                owner_id="owner-b",
                runtime_generation=4,
            )
            is False
        )
        assert (
            resolve_confirmation(
                "bound-session",
                confirmation_id,
                True,
                owner_id="owner-a",
                runtime_generation=5,
            )
            is False
        )
        assert (
            resolve_confirmation(
                "bound-session",
                confirmation_id,
                True,
                owner_id="owner-a",
                runtime_generation=4,
            )
            is True
        )
        await task

    tool.ainvoke.assert_awaited_once()


@pytest.mark.asyncio
async def test_retry_token_is_bound_to_owner_session_turn_and_runtime_generation():
    from app.agent import InvalidRetryStep, _tools_by_name, retry_failed_step
    from tests.test_agent import FakeToolCallingLLM, StubTool, _aim, _tc

    events = []
    model = FakeToolCallingLLM(
        responses=[
            _aim(tool_calls=[_tc("list_todos", {}, "read")]),
            _aim("failed read"),
        ]
    )
    tool = StubTool(side_effect=[TimeoutError("timeout"), {"items": []}])
    with (
        patch("app.agent._build_llm", return_value=model),
        patch.dict(_tools_by_name, {"list_todos": tool}),
    ):
        await process_message(
            "bound-retry",
            "list",
            events.append,
            owner_id="owner-a",
            runtime_generation=2,
        )
        failure = next(event for event in events if event["type"] == "step_failed")
        with pytest.raises(InvalidRetryStep):
            await retry_failed_step(
                "bound-retry",
                failure["step_id"],
                failure["retry_token"],
                owner_id="owner-b",
                runtime_generation=2,
            )
        with pytest.raises(InvalidRetryStep):
            await retry_failed_step(
                "bound-retry",
                failure["step_id"],
                failure["retry_token"],
                owner_id="owner-a",
                runtime_generation=3,
            )
        await retry_failed_step(
            "bound-retry",
            failure["step_id"],
            failure["retry_token"],
            owner_id="owner-a",
            runtime_generation=2,
        )

    assert tool.ainvoke.await_count == 2


def test_completed_history_conversion_excludes_non_completed_and_non_chat_roles():
    from app.main import _completed_history_messages

    owner = uuid4()
    session_id = uuid4()
    now = datetime.now(timezone.utc)
    completed_id = uuid4()
    failed_id = uuid4()
    detail = SessionDetail(
        id=session_id,
        owner_id=owner,
        title="history",
        created_at=now,
        updated_at=now,
        last_message_at=now,
        turns=(
            TurnRecord(
                completed_id,
                session_id,
                1,
                "completed",
                now,
                now,
                None,
                None,
                False,
                messages=(
                    MessageRecord(
                        uuid4(), session_id, completed_id, "user", "u", 1, now
                    ),
                    MessageRecord(
                        uuid4(), session_id, completed_id, "tool", "secret", 2, now
                    ),
                    MessageRecord(
                        uuid4(), session_id, completed_id, "assistant", "a", 3, now
                    ),
                ),
            ),
            TurnRecord(
                failed_id,
                session_id,
                2,
                "failed",
                now,
                now,
                "X",
                "x",
                False,
                messages=(
                    MessageRecord(
                        uuid4(), session_id, failed_id, "user", "ignored", 4, now
                    ),
                ),
            ),
        ),
    )

    messages = _completed_history_messages(detail)
    assert [type(message) for message in messages] == [HumanMessage, AIMessage]
    assert [message.content for message in messages] == ["u", "a"]


@pytest.mark.asyncio
async def test_real_postgres_stream_persists_complete_turn_before_terminal_delivery():
    database_url = os.getenv("TEST_DATABASE_URL")
    if not database_url:
        pytest.skip("TEST_DATABASE_URL is required for PostgreSQL durable stream test")

    import asyncpg

    pool = await asyncpg.create_pool(database_url)
    repository = HistoryRepository(pool)
    owner = uuid4()
    suffix = uuid4().hex
    async with pool.acquire() as connection:
        await connection.execute(
            """INSERT INTO users (id, email, display_name, password_hash)
               VALUES ($1, $2, 'Durable Stream', 'test-only')""",
            owner,
            f"durable-{suffix}@example.test",
        )
    try:
        session = await repository.create_session(owner, "Real durable stream")
        session_detail = await repository.get_session(owner, session.id)
        assert session_detail is not None
        coordinator = SessionRuntimeCoordinator()
        events = []

        async def assert_committed_before_terminal(result):
            terminal_detail = await repository.get_session(owner, session.id)
            assert terminal_detail.turns[0].status == "completed"
            events.append({"type": "reply", "content": result.reply})

        with patch("app.agent._build_llm", return_value=_ReplyModel()):
            await _execute_durable_message(
                repository,
                coordinator,
                owner,
                session.id,
                "persist me",
                session_detail,
                on_event=events.append,
                on_terminal=assert_committed_before_terminal,
            )

        detail = await repository.get_session(owner, session.id)
        assert detail is not None
        assert len(detail.turns) == 1
        assert detail.turns[0].status == "completed"
        assert [message.content for message in detail.turns[0].messages] == [
            "persist me",
            "durable reply",
        ]
        assert [str(step.event_id) for step in detail.turns[0].steps] == [
            events[0]["event_id"]
        ]
        assert detail.turns[0].steps[0].status == "completed"
    finally:
        async with pool.acquire() as connection:
            await connection.execute("DELETE FROM users WHERE id = $1", owner)
        await pool.close()


@pytest.mark.asyncio
async def test_real_postgres_cancelled_write_reconnects_without_second_dispatch():
    database_url = os.getenv("TEST_DATABASE_URL")
    if not database_url:
        pytest.skip("TEST_DATABASE_URL is required for write cancellation recovery")

    import asyncpg
    from app.agent import _tools_by_name
    from tests.test_agent import FakeToolCallingLLM, StubTool, _aim, _tc

    pool = await asyncpg.create_pool(database_url)
    repository = HistoryRepository(pool)
    owner = uuid4()
    suffix = uuid4().hex
    async with pool.acquire() as connection:
        await connection.execute(
            """INSERT INTO users (id, email, display_name, password_hash)
               VALUES ($1, $2, 'Cancelled Write', 'test-only')""",
            owner,
            f"cancelled-write-{suffix}@example.test",
        )
    try:
        session = await repository.create_session(owner, "Cancelled write")
        detail = await repository.get_session(owner, session.id)
        assert detail is not None
        coordinator = SessionRuntimeCoordinator()
        entered = asyncio.Event()
        release = asyncio.Event()
        effects = 0

        async def write_once(_args):
            nonlocal effects
            effects += 1
            entered.set()
            await release.wait()
            return {"id": effects}

        tool = StubTool()
        tool.ainvoke.side_effect = write_once
        model = FakeToolCallingLLM(
            responses=[
                _aim(tool_calls=[_tc("create_todo", {"title": "once"})]),
                _aim("recovered"),
            ]
        )
        with (
            patch("app.agent._build_llm", return_value=model),
            patch.dict(_tools_by_name, {"create_todo": tool}),
        ):
            first = asyncio.create_task(
                _execute_durable_message(
                    repository,
                    coordinator,
                    owner,
                    session.id,
                    "create once",
                    detail,
                )
            )
            await entered.wait()
            dispatched = await repository.get_session(owner, session.id)
            assert dispatched.turns[0].status == "running"
            assert dispatched.turns[0].result_uncertain is True

            first.cancel()
            reconnect = asyncio.create_task(
                _execute_durable_message(
                    repository,
                    coordinator,
                    owner,
                    session.id,
                    "create once",
                    detail,
                )
            )
            await asyncio.sleep(0)
            release.set()
            with pytest.raises(asyncio.CancelledError):
                await first
            result = await reconnect

        completed = await repository.get_session(owner, session.id)
        assert result.reply == "recovered"
        assert effects == 1
        assert tool.ainvoke.await_count == 1
        assert len(completed.turns) == 1
        assert completed.turns[0].status == "completed"
        assert completed.turns[0].result_uncertain is False
        assert coordinator.state_size == 0
    finally:
        async with pool.acquire() as connection:
            await connection.execute("DELETE FROM users WHERE id = $1", owner)
        await pool.close()


@pytest.mark.asyncio
async def test_real_postgres_checkpointed_delivery_fault_resumes_open_turn():
    database_url = os.getenv("TEST_DATABASE_URL")
    if not database_url:
        pytest.skip("TEST_DATABASE_URL is required for PostgreSQL delivery recovery")

    import asyncpg
    from app.agent import TransportDeliveryError, _tools_by_name
    from tests.test_agent import FakeToolCallingLLM, StubTool, _aim, _tc

    pool = await asyncpg.create_pool(database_url)
    repository = HistoryRepository(pool)
    owner = uuid4()
    suffix = uuid4().hex
    async with pool.acquire() as connection:
        await connection.execute(
            """INSERT INTO users (id, email, display_name, password_hash)
               VALUES ($1, $2, 'Delivery Recovery', 'test-only')""",
            owner,
            f"delivery-{suffix}@example.test",
        )
    try:
        session = await repository.create_session(owner, "Delivery recovery")
        detail = await repository.get_session(owner, session.id)
        coordinator = SessionRuntimeCoordinator()
        model = FakeToolCallingLLM(
            responses=[
                _aim(tool_calls=[_tc("create_todo", {"title": "once"})]),
                _aim("recovered"),
            ]
        )
        tool = StubTool(result={"id": 1})
        failed_event = None

        async def fail_action_once(event):
            nonlocal failed_event
            if event["type"] == "action_completed" and failed_event is None:
                failed_event = dict(event)
                raise RuntimeError("delivery lost")

        with (
            patch("app.agent._build_llm", return_value=model),
            patch.dict(_tools_by_name, {"create_todo": tool}),
        ):
            with pytest.raises(TransportDeliveryError):
                await _execute_durable_message(
                    repository,
                    coordinator,
                    owner,
                    session.id,
                    "same request",
                    detail,
                    on_event=fail_action_once,
                )
            open_detail = await repository.get_session(owner, session.id)
            assert open_detail.turns[0].status == "running"
            replayed = []
            await _execute_durable_message(
                repository,
                coordinator,
                owner,
                session.id,
                "same request",
                detail,
                on_event=replayed.append,
            )

        final_detail = await repository.get_session(owner, session.id)
        tool.ainvoke.assert_awaited_once()
        assert failed_event is not None
        assert len(final_detail.turns) == 1
        assert final_detail.turns[0].status == "completed"
        assert (
            sum(
                event.get("event_id") == failed_event["event_id"]
                and event["type"] == "action_completed"
                for event in replayed
            )
            == 1
        )
    finally:
        async with pool.acquire() as connection:
            await connection.execute("DELETE FROM users WHERE id = $1", owner)
        await pool.close()


@pytest.mark.asyncio
async def test_real_postgres_http_ack_loss_returns_failure_then_reuses_committed_turn():
    database_url = os.getenv("TEST_DATABASE_URL")
    if not database_url:
        pytest.skip("TEST_DATABASE_URL is required for PostgreSQL HTTP durability test")

    import asyncpg
    from httpx import ASGITransport, AsyncClient
    from app.main import create_app

    pool = await asyncpg.create_pool(database_url)
    repository = HistoryRepository(pool)
    owner = uuid4()
    auth_session = uuid4()
    suffix = uuid4().hex
    now = datetime.now(timezone.utc)
    settings = AuthSettings(
        secret="real-postgres-route-secret-value-32",
        access_cookie="todolist_access",
        allowed_origins=frozenset({"http://frontend.test"}),
        issuer="todolist-backend",
        database_url=database_url,
    )
    async with pool.acquire() as connection:
        await connection.execute(
            """INSERT INTO users (id, email, display_name, password_hash)
               VALUES ($1, $2, 'HTTP Durable', 'test-only')""",
            owner,
            f"http-durable-{suffix}@example.test",
        )
        await connection.execute(
            """INSERT INTO auth_sessions
                   (id, user_id, refresh_token_hash, expires_at)
               VALUES ($1, $2, $3, $4)""",
            auth_session,
            owner,
            suffix.ljust(64, "0")[:64],
            now + timedelta(minutes=10),
        )
    try:
        session = await repository.create_session(owner, "HTTP ack loss")
        application = create_app(settings=settings)
        coordinator = SessionRuntimeCoordinator()
        application.state.auth_settings = settings
        application.state.history_repository = repository
        application.state.history_service = HistoryService(
            repository, coordinator.delete_barrier
        )
        application.state.runtime_coordinator = coordinator
        application.state.recovery_ready = True
        token = jwt.encode(
            {
                "sub": str(owner),
                "sid": str(auth_session),
                "iss": settings.issuer,
                "iat": now,
                "exp": now + timedelta(minutes=5),
            },
            settings.secret,
            algorithm="HS256",
        )
        original_complete = repository.complete_turn
        drop_ack = True

        async def complete_then_maybe_drop(*args, **kwargs):
            nonlocal drop_ack
            result = await original_complete(*args, **kwargs)
            if drop_ack:
                drop_ack = False
                raise ConnectionError("terminal acknowledgement lost")
            return result

        repository.complete_turn = complete_then_maybe_drop
        async with AsyncClient(
            transport=ASGITransport(app=application),
            base_url="http://agent.test",
            cookies={settings.access_cookie: token},
            headers={"origin": "http://frontend.test"},
        ) as client:
            with patch("app.agent._build_llm", return_value=_ReplyModel()):
                first = await client.post(
                    "/api/agent/chat",
                    json={"session_id": str(session.id), "message": "same request"},
                )
                second = await client.post(
                    "/api/agent/chat",
                    json={"session_id": str(session.id), "message": "same request"},
                )

        detail = await repository.get_session(owner, session.id)
        assert first.status_code == 500
        assert second.status_code == 200
        assert len(detail.turns) == 1
        assert detail.turns[0].status == "completed"
        assert [message.content for message in detail.turns[0].messages] == [
            "same request",
            "durable reply",
        ]
    finally:
        async with pool.acquire() as connection:
            await connection.execute("DELETE FROM users WHERE id = $1", owner)
        await pool.close()
