"""Durable production-stream ordering and isolation contracts."""

from __future__ import annotations

import asyncio
import os
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import patch
from uuid import UUID, uuid4

import jwt
import pytest
from fastapi.testclient import TestClient
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage

from app.agent import _conversations, _reset_graph, process_message
from app.auth import AuthSettings
from app.history_models import MessageRecord, SessionDetail, SessionSummary, TurnRecord
from app.history_service import HistoryService
from app.history_repository import HistoryRepository
from app.main import (
    HistoryPersistenceError,
    RepositoryTurnPersistence,
    SessionRuntimeCoordinator,
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

    def mark_write_applied(self):
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
        self.user_exists = False
        self.completed = False
        self.failed: list[tuple[str, bool]] = []
        self.steps = []
        self.fail_checkpoint = False
        self.fail_completed_tool = False
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
        self.user_exists = True
        return SimpleNamespace(id=turn_id)

    async def upsert_step(self, owner, turn_id, event):
        assert self.user_exists
        if self.fail_checkpoint or (
            self.fail_completed_tool
            and event.tool == "create_todo"
            and event.status == "completed"
        ):
            raise RuntimeError("database unavailable")
        self.steps.append(event)
        return True

    async def complete_turn(self, owner, turn_id, message_id, content, created_at):
        assert self.user_exists
        if self.fail_complete:
            raise RuntimeError("terminal commit unavailable")
        self.completed = True

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

    async def barrier(owner_id, session_id):
        order.append("barrier")
        return True

    service = HistoryService(Repo(), barrier)
    assert await service.delete_session(uuid4(), uuid4()) is True
    assert order == ["barrier", "delete"]


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
        coordinator = SessionRuntimeCoordinator()
        lease = await coordinator.acquire(owner, session.id)
        persistence = RepositoryTurnPersistence(repository, coordinator, lease)
        events = []
        with patch("app.agent._build_llm", return_value=_ReplyModel()):
            result = await process_message(
                str(session.id),
                "persist me",
                events.append,
                persistence=persistence,
                owner_id=str(owner),
                runtime_generation=lease.generation,
            )
        await persistence.complete(result.reply)

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
