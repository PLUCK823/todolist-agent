"""PostgreSQL contract tests for durable, user-owned Agent history."""

from __future__ import annotations

import asyncio
import os
import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import pytest
from httpx import ASGITransport, AsyncClient

from app.auth import AuthSettings
from app.history_models import PersistedStepEvent
from app.history_repository import HistoryConflictError, HistoryRepository
from app.main import create_app


pytestmark = pytest.mark.asyncio


@pytest.fixture
async def repo():
    database_url = os.getenv("TEST_DATABASE_URL")
    if not database_url:
        pytest.skip(
            "TEST_DATABASE_URL is required for PostgreSQL history integration tests"
        )

    import asyncpg

    pool = await asyncpg.create_pool(database_url)
    repository = HistoryRepository(pool)
    suffix = uuid.uuid4().hex
    alice = uuid.uuid4()
    bob = uuid.uuid4()
    async with pool.acquire() as conn:
        for user, email in (
            (alice, f"alice-{suffix}@example.test"),
            (bob, f"bob-{suffix}@example.test"),
        ):
            await conn.execute(
                """INSERT INTO users (id, email, display_name, password_hash)
                   VALUES ($1, $2, 'Test User', 'not-a-real-password')""",
                user,
                email,
            )
    try:
        yield repository, alice, bob
    finally:
        async with pool.acquire() as conn:
            await conn.execute(
                "DELETE FROM users WHERE email LIKE $1", f"%-{suffix}@example.test"
            )
        await pool.close()


async def test_session_is_never_visible_to_another_owner(repo):
    repository, alice, bob = repo
    session = await repository.create_session(alice, "Alice session")

    assert await repository.get_session(alice, session.id) is not None
    assert await repository.get_session(bob, session.id) is None
    assert await repository.delete_session(bob, session.id) is False


async def test_detail_is_ordered_and_cascade_delete_removes_turns(repo):
    repository, alice, _ = repo
    session = await repository.create_session(alice, "Ordered")
    now = datetime.now(timezone.utc)
    turn_one = await repository.start_turn(
        alice, session.id, uuid.uuid4(), uuid.uuid4(), "first", now
    )
    await repository.complete_turn(alice, turn_one.id, uuid.uuid4(), "first reply", now)
    turn_two = await repository.start_turn(
        alice, session.id, uuid.uuid4(), uuid.uuid4(), "second", now
    )
    await repository.complete_turn(
        alice, turn_two.id, uuid.uuid4(), "second reply", now
    )

    detail = await repository.get_session(alice, session.id)
    assert [turn.ordinal for turn in detail.turns] == [1, 2]
    assert [message.content for message in detail.turns[0].messages] == [
        "first",
        "first reply",
    ]
    assert await repository.delete_session(alice, session.id) is True
    assert await repository.get_session(alice, session.id) is None


async def test_concurrent_start_turns_allocate_distinct_ordinals(repo):
    repository, alice, _ = repo
    session = await repository.create_session(alice, "Concurrent")
    now = datetime.now(timezone.utc)

    turns = await asyncio.gather(
        *[
            repository.start_turn(
                alice, session.id, uuid.uuid4(), uuid.uuid4(), f"message {index}", now
            )
            for index in range(10)
        ]
    )

    assert sorted(turn.ordinal for turn in turns) == list(range(1, 11))


async def test_start_turn_is_idempotent_for_same_stable_turn_and_user_message(repo):
    repository, alice, _ = repo
    session = await repository.create_session(alice, "Reconnect")
    now = datetime.now(timezone.utc)
    turn_id = uuid.uuid4()
    message_id = uuid.uuid4()

    first = await repository.start_turn(
        alice, session.id, turn_id, message_id, "same request", now
    )
    second = await repository.start_turn(
        alice,
        session.id,
        turn_id,
        message_id,
        "same request",
        now + timedelta(seconds=1),
    )

    detail = await repository.get_session(alice, session.id)
    assert second == first
    assert len(detail.turns) == 1
    assert [message.content for message in detail.turns[0].messages] == ["same request"]


async def test_upsert_step_is_idempotent_and_rejects_cross_owner_collision(repo):
    repository, alice, bob = repo
    alice_session = await repository.create_session(alice, "Alice")
    bob_session = await repository.create_session(bob, "Bob")
    now = datetime.now(timezone.utc)
    alice_turn = await repository.start_turn(
        alice, alice_session.id, uuid.uuid4(), uuid.uuid4(), "hello", now
    )
    bob_turn = await repository.start_turn(
        bob, bob_session.id, uuid.uuid4(), uuid.uuid4(), "hello", now
    )
    event_id = uuid.uuid4()
    event = PersistedStepEvent(
        event_id=event_id,
        label="Call Todo API",
        status="completed",
        args={"b": 2, "a": 1},
        result={"ok": True},
    )

    assert await repository.upsert_step(alice, alice_turn.id, event) is True
    assert await repository.upsert_step(alice, alice_turn.id, event) is True
    assert await repository.upsert_step(bob, bob_turn.id, event) is False
    detail = await repository.get_session(alice, alice_session.id)
    assert len(detail.turns[0].steps) == 1


async def test_result_is_bounded_by_utf8_bytes_with_preview(repo, monkeypatch):
    repository, alice, _ = repo
    monkeypatch.setattr("app.history_repository.RESULT_MAX_BYTES", 48)
    session = await repository.create_session(alice, "Results")
    now = datetime.now(timezone.utc)
    turn = await repository.start_turn(
        alice, session.id, uuid.uuid4(), uuid.uuid4(), "hello", now
    )
    await repository.upsert_step(
        alice,
        turn.id,
        PersistedStepEvent(
            event_id=uuid.uuid4(),
            label="Big",
            status="completed",
            result={"text": "你" * 100},
        ),
    )
    detail = await repository.get_session(alice, session.id)
    step = detail.turns[0].steps[0]
    assert step.result is None
    assert step.result_truncated is True
    assert step.result_preview.startswith('{"text":"')


async def test_rename_fail_and_interrupt_open_turns(repo):
    repository, alice, _ = repo
    session = await repository.create_session(alice, "Old")
    renamed = await repository.rename_session(alice, session.id, "  New name  ")
    assert renamed.title == "New name"
    now = datetime.now(timezone.utc)
    failed = await repository.start_turn(
        alice, session.id, uuid.uuid4(), uuid.uuid4(), "fail", now
    )
    await repository.fail_turn(
        alice, failed.id, "MODEL_FAILED", "model unavailable", uncertain=True
    )
    interrupted = await repository.start_turn(
        alice, session.id, uuid.uuid4(), uuid.uuid4(), "open", now
    )
    assert await repository.interrupt_open_turns() >= 1
    detail = await repository.get_session(alice, session.id)
    by_id = {turn.id: turn for turn in detail.turns}
    assert by_id[failed.id].status == "failed"
    assert by_id[failed.id].result_uncertain is True
    assert by_id[interrupted.id].status == "interrupted"


async def test_write_dispatch_marks_open_turn_uncertain_before_completion(repo):
    repository, alice, _ = repo
    session = await repository.create_session(alice, "Write barrier")
    now = datetime.now(timezone.utc)
    turn = await repository.start_turn(
        alice, session.id, uuid.uuid4(), uuid.uuid4(), "write", now
    )

    await repository.mark_turn_uncertain(alice, turn.id)

    open_detail = await repository.get_session(alice, session.id)
    assert open_detail.turns[0].status == "running"
    assert open_detail.turns[0].result_uncertain is True

    await repository.complete_turn(alice, turn.id, uuid.uuid4(), "write complete", now)
    completed_detail = await repository.get_session(alice, session.id)
    assert completed_detail.turns[0].status == "completed"
    assert completed_detail.turns[0].result_uncertain is False


async def test_failed_turn_cannot_clear_persisted_write_uncertainty(repo):
    repository, alice, _ = repo
    session = await repository.create_session(alice, "Sticky uncertainty")
    now = datetime.now(timezone.utc)
    turn = await repository.start_turn(
        alice, session.id, uuid.uuid4(), uuid.uuid4(), "write", now
    )
    await repository.mark_turn_uncertain(alice, turn.id)

    await repository.fail_turn(
        alice, turn.id, "WRITE_FAILED", "response lost", uncertain=False
    )

    detail = await repository.get_session(alice, session.id)
    assert detail.turns[0].status == "failed"
    assert detail.turns[0].result_uncertain is True


async def test_complete_turn_rejects_message_id_owned_by_another_turn_and_rolls_back(
    repo,
):
    """A forged/reused message ID cannot complete a turn without its reply."""
    repository, alice, bob = repo
    now = datetime.now(timezone.utc)
    alice_session = await repository.create_session(alice, "Alice")
    bob_session = await repository.create_session(bob, "Bob")
    alice_turn = await repository.start_turn(
        alice, alice_session.id, uuid.uuid4(), uuid.uuid4(), "alice", now
    )
    reply_id = uuid.uuid4()
    await repository.complete_turn(alice, alice_turn.id, reply_id, "Alice reply", now)

    bob_turn = await repository.start_turn(
        bob, bob_session.id, uuid.uuid4(), uuid.uuid4(), "bob", now
    )
    with pytest.raises(HistoryConflictError, match="completion message conflict"):
        await repository.complete_turn(bob, bob_turn.id, reply_id, "Bob reply", now)

    detail = await repository.get_session(bob, bob_session.id)
    assert detail.turns[0].status == "running"
    assert [message.content for message in detail.turns[0].messages] == ["bob"]


async def test_complete_turn_allows_exact_same_turn_assistant_retry_without_duplication(
    repo,
):
    repository, alice, _ = repo
    now = datetime.now(timezone.utc)
    session = await repository.create_session(alice, "Idempotent completion")
    turn = await repository.start_turn(
        alice, session.id, uuid.uuid4(), uuid.uuid4(), "request", now
    )
    reply_id = uuid.uuid4()

    await repository.complete_turn(alice, turn.id, reply_id, "same reply", now)
    first = await repository.get_session(alice, session.id)
    await repository.complete_turn(
        alice, turn.id, reply_id, "same reply", now + timedelta(seconds=1)
    )

    detail = await repository.get_session(alice, session.id)
    assert detail.turns[0].status == "completed"
    assert [message.content for message in detail.turns[0].messages] == [
        "request",
        "same reply",
    ]
    assert detail.turns[0].completed_at == first.turns[0].completed_at
    assert detail.updated_at == first.updated_at
    assert detail.last_message_at == first.last_message_at

    with pytest.raises(HistoryConflictError, match="completion"):
        await repository.complete_turn(alice, turn.id, reply_id, "different reply", now)


async def test_completed_turn_rejects_late_failure_without_mutation(repo):
    repository, alice, _ = repo
    now = datetime.now(timezone.utc)
    session = await repository.create_session(alice, "Completed")
    turn = await repository.start_turn(
        alice, session.id, uuid.uuid4(), uuid.uuid4(), "request", now
    )
    await repository.complete_turn(alice, turn.id, uuid.uuid4(), "reply", now)
    before = await repository.get_session(alice, session.id)

    with pytest.raises(HistoryConflictError, match="terminal"):
        await repository.fail_turn(
            alice, turn.id, "LATE_FAILURE", "must not overwrite", uncertain=True
        )

    after = await repository.get_session(alice, session.id)
    assert after == before


async def test_failed_turn_rejects_late_completion_without_mutation(repo):
    repository, alice, _ = repo
    now = datetime.now(timezone.utc)
    session = await repository.create_session(alice, "Failed")
    turn = await repository.start_turn(
        alice, session.id, uuid.uuid4(), uuid.uuid4(), "request", now
    )
    await repository.fail_turn(alice, turn.id, "MODEL_FAILED", "unavailable", True)
    before = await repository.get_session(alice, session.id)

    with pytest.raises(HistoryConflictError, match="terminal"):
        await repository.complete_turn(alice, turn.id, uuid.uuid4(), "late reply", now)

    after = await repository.get_session(alice, session.id)
    assert after == before


async def test_interrupted_turn_rejects_late_completion_without_mutation(repo):
    repository, alice, _ = repo
    now = datetime.now(timezone.utc)
    session = await repository.create_session(alice, "Interrupted")
    turn = await repository.start_turn(
        alice, session.id, uuid.uuid4(), uuid.uuid4(), "request", now
    )
    await repository.interrupt_open_turns()
    before = await repository.get_session(alice, session.id)

    with pytest.raises(HistoryConflictError, match="terminal"):
        await repository.complete_turn(alice, turn.id, uuid.uuid4(), "late reply", now)

    after = await repository.get_session(alice, session.id)
    assert after == before


@pytest.mark.parametrize("terminal_status", ["completed", "failed", "interrupted"])
async def test_terminal_turn_rejects_late_step_create_and_mutation(
    repo, terminal_status
):
    repository, alice, _ = repo
    now = datetime.now(timezone.utc)
    session = await repository.create_session(alice, f"Terminal {terminal_status}")
    turn = await repository.start_turn(
        alice, session.id, uuid.uuid4(), uuid.uuid4(), "request", now
    )
    event_id = uuid.uuid4()
    initial = PersistedStepEvent(
        event_id=event_id, label="Initial", status="running", args={"version": 1}
    )
    assert await repository.upsert_step(alice, turn.id, initial) is True
    if terminal_status == "completed":
        await repository.complete_turn(alice, turn.id, uuid.uuid4(), "reply", now)
    elif terminal_status == "failed":
        await repository.fail_turn(alice, turn.id, "FAILED", "failed", False)
    else:
        await repository.interrupt_open_turns()
    before = await repository.get_session(alice, session.id)

    assert (
        await repository.upsert_step(
            alice,
            turn.id,
            PersistedStepEvent(
                event_id=event_id,
                label="Mutated",
                status="completed",
                args={"version": 2},
            ),
        )
        is False
    )
    assert (
        await repository.upsert_step(
            alice,
            turn.id,
            PersistedStepEvent(event_id=uuid.uuid4(), label="Late", status="running"),
        )
        is False
    )

    after = await repository.get_session(alice, session.id)
    assert after == before


async def test_fail_turn_exact_retry_is_noop_and_conflicting_retry_is_rejected(repo):
    repository, alice, _ = repo
    now = datetime.now(timezone.utc)
    session = await repository.create_session(alice, "Idempotent failure")
    turn = await repository.start_turn(
        alice, session.id, uuid.uuid4(), uuid.uuid4(), "request", now
    )
    await repository.fail_turn(alice, turn.id, "MODEL_FAILED", "unavailable", True)
    first = await repository.get_session(alice, session.id)

    await repository.fail_turn(alice, turn.id, "MODEL_FAILED", "unavailable", True)
    repeated = await repository.get_session(alice, session.id)
    assert repeated == first

    with pytest.raises(HistoryConflictError, match="failure"):
        await repository.fail_turn(alice, turn.id, "MODEL_FAILED", "different", True)
    assert await repository.get_session(alice, session.id) == first


async def test_recovery_ownership_prevents_a_second_instance_interrupting_active_turn(
    repo, monkeypatch
):
    repository_a, alice, _ = repo
    import asyncpg

    database_url = os.environ["TEST_DATABASE_URL"]
    pool_b = await asyncpg.create_pool(database_url, min_size=1, max_size=2)
    settings = AuthSettings(
        secret="x" * 32,
        access_cookie="todolist_access",
        allowed_origins=frozenset({"http://frontend.test"}),
        issuer="todolist-backend",
        database_url=database_url,
        pool_min_size=1,
        pool_max_size=2,
    )
    app_a = create_app(settings=settings, pool=repository_a._pool)
    app_b = create_app(settings=settings, pool=pool_b)
    monkeypatch.setattr("app.main.validate_model_configuration", lambda: None)

    try:
        async with app_a.router.lifespan_context(app_a):
            session = await repository_a.create_session(alice, "Recovery ownership")
            now = datetime.now(timezone.utc)
            active = await repository_a.start_turn(
                alice, session.id, uuid.uuid4(), uuid.uuid4(), "active", now
            )

            with pytest.raises(RuntimeError, match="another Agent instance"):
                async with app_b.router.lifespan_context(app_b):
                    pass

            detail = await repository_a.get_session(alice, session.id)
            assert detail.turns[0].status == "running"
            await repository_a.complete_turn(
                alice, active.id, uuid.uuid4(), "completed by A", now
            )
            stale = await repository_a.start_turn(
                alice, session.id, uuid.uuid4(), uuid.uuid4(), "stale", now
            )

        async with app_b.router.lifespan_context(app_b):
            repository_b = app_b.state.history_repository
            detail = await repository_b.get_session(alice, session.id)
            by_id = {turn.id: turn for turn in detail.turns}
            assert by_id[active.id].status == "completed"
            assert by_id[stale.id].status == "interrupted"
    finally:
        await pool_b.close()


async def test_terminated_lock_holder_fails_closed_and_successor_recovers(
    repo, monkeypatch
):
    repository_a, alice, _ = repo
    import asyncpg

    database_url = os.environ["TEST_DATABASE_URL"]
    pool_b = await asyncpg.create_pool(database_url, min_size=1, max_size=2)
    settings = AuthSettings(
        secret="x" * 32,
        access_cookie="todolist_access",
        allowed_origins=frozenset({"http://frontend.test"}),
        issuer="todolist-backend",
        database_url=database_url,
        pool_min_size=1,
        pool_max_size=2,
    )
    lost = asyncio.Event()
    handler_calls = 0

    async def on_ownership_lost():
        nonlocal handler_calls
        handler_calls += 1
        lost.set()

    app_a = create_app(
        settings=settings,
        pool=repository_a._pool,
        ownership_lost_handler=on_ownership_lost,
    )
    app_b = create_app(settings=settings, pool=pool_b)
    monkeypatch.setattr("app.main.validate_model_configuration", lambda: None)

    try:
        async with app_a.router.lifespan_context(app_a):
            ownership = app_a.state.recovery_ownership
            session = await repository_a.create_session(alice, "Lost ownership")
            now = datetime.now(timezone.utc)
            active = await repository_a.start_turn(
                alice, session.id, uuid.uuid4(), uuid.uuid4(), "active", now
            )

            async with pool_b.acquire() as killer:
                assert (
                    await killer.fetchval(
                        "SELECT pg_terminate_backend($1)", ownership.holder_pid
                    )
                    is True
                )
            await asyncio.wait_for(lost.wait(), timeout=2)

            assert ownership.ready is False
            assert ownership.lost is True
            assert app_a.state.recovery_ready is False
            assert handler_calls == 1
            process = AsyncMock()
            with patch("app.main.process_message", new=process):
                async with AsyncClient(
                    transport=ASGITransport(app=app_a), base_url="http://test"
                ) as client:
                    assert (await client.get("/api/agent/health")).status_code == 503
                    assert (await client.get("/api/agent/sessions")).status_code == 503
                    assert (
                        await client.post(
                            "/api/agent/chat",
                            headers={"Origin": "http://frontend.test"},
                            json={"message": "must not run"},
                        )
                    ).status_code == 503

                class WebSocket:
                    def __init__(self):
                        self.app = app_a
                        self.accept_count = 0
                        self.close_codes = []

                    async def accept(self):
                        self.accept_count += 1

                    async def close(self, code=1000):
                        self.close_codes.append(code)

                route = next(
                    route
                    for route in app_a.router.routes
                    if getattr(route, "path", None) == "/api/agent/stream"
                )
                websocket = WebSocket()
                await route.endpoint(websocket)
                assert websocket.accept_count == 0
                assert websocket.close_codes == [1011]
            process.assert_not_awaited()

            async with app_b.router.lifespan_context(app_b):
                repository_b = app_b.state.history_repository
                detail = await repository_b.get_session(alice, session.id)
                by_id = {turn.id: turn for turn in detail.turns}
                assert by_id[active.id].status == "interrupted"

        assert repository_a._pool.get_idle_size() == repository_a._pool.get_size()
        assert pool_b.get_idle_size() == pool_b.get_size()
    finally:
        await pool_b.close()
