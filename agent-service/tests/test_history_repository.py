"""PostgreSQL contract tests for durable, user-owned Agent history."""

from __future__ import annotations

import asyncio
import os
import uuid
from datetime import datetime, timedelta, timezone

import pytest

from app.history_models import PersistedStepEvent
from app.history_repository import HistoryConflictError, HistoryRepository


pytestmark = pytest.mark.asyncio


@pytest.fixture
async def repo():
    database_url = os.getenv("TEST_DATABASE_URL")
    if not database_url:
        pytest.skip("TEST_DATABASE_URL is required for PostgreSQL history integration tests")

    import asyncpg

    pool = await asyncpg.create_pool(database_url)
    repository = HistoryRepository(pool)
    suffix = uuid.uuid4().hex
    alice = uuid.uuid4()
    bob = uuid.uuid4()
    async with pool.acquire() as conn:
        for user, email in ((alice, f"alice-{suffix}@example.test"), (bob, f"bob-{suffix}@example.test")):
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
            await conn.execute("DELETE FROM users WHERE email LIKE $1", f"%-{suffix}@example.test")
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
    turn_one = await repository.start_turn(alice, session.id, uuid.uuid4(), uuid.uuid4(), "first", now)
    await repository.complete_turn(alice, turn_one.id, uuid.uuid4(), "first reply", now)
    turn_two = await repository.start_turn(alice, session.id, uuid.uuid4(), uuid.uuid4(), "second", now)
    await repository.complete_turn(alice, turn_two.id, uuid.uuid4(), "second reply", now)

    detail = await repository.get_session(alice, session.id)
    assert [turn.ordinal for turn in detail.turns] == [1, 2]
    assert [message.content for message in detail.turns[0].messages] == ["first", "first reply"]
    assert await repository.delete_session(alice, session.id) is True
    assert await repository.get_session(alice, session.id) is None


async def test_concurrent_start_turns_allocate_distinct_ordinals(repo):
    repository, alice, _ = repo
    session = await repository.create_session(alice, "Concurrent")
    now = datetime.now(timezone.utc)

    turns = await asyncio.gather(*[
        repository.start_turn(alice, session.id, uuid.uuid4(), uuid.uuid4(), f"message {index}", now)
        for index in range(10)
    ])

    assert sorted(turn.ordinal for turn in turns) == list(range(1, 11))


async def test_upsert_step_is_idempotent_and_rejects_cross_owner_collision(repo):
    repository, alice, bob = repo
    alice_session = await repository.create_session(alice, "Alice")
    bob_session = await repository.create_session(bob, "Bob")
    now = datetime.now(timezone.utc)
    alice_turn = await repository.start_turn(alice, alice_session.id, uuid.uuid4(), uuid.uuid4(), "hello", now)
    bob_turn = await repository.start_turn(bob, bob_session.id, uuid.uuid4(), uuid.uuid4(), "hello", now)
    event_id = uuid.uuid4()
    event = PersistedStepEvent(event_id=event_id, label="Call Todo API", status="completed", args={"b": 2, "a": 1}, result={"ok": True})

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
    turn = await repository.start_turn(alice, session.id, uuid.uuid4(), uuid.uuid4(), "hello", now)
    await repository.upsert_step(
        alice,
        turn.id,
        PersistedStepEvent(event_id=uuid.uuid4(), label="Big", status="completed", result={"text": "你" * 100}),
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
    failed = await repository.start_turn(alice, session.id, uuid.uuid4(), uuid.uuid4(), "fail", now)
    await repository.fail_turn(alice, failed.id, "MODEL_FAILED", "model unavailable", uncertain=True)
    interrupted = await repository.start_turn(alice, session.id, uuid.uuid4(), uuid.uuid4(), "open", now)
    assert await repository.interrupt_open_turns() >= 1
    detail = await repository.get_session(alice, session.id)
    by_id = {turn.id: turn for turn in detail.turns}
    assert by_id[failed.id].status == "failed"
    assert by_id[failed.id].result_uncertain is True
    assert by_id[interrupted.id].status == "interrupted"


async def test_complete_turn_rejects_message_id_owned_by_another_turn_and_rolls_back(repo):
    """A forged/reused message ID cannot complete a turn without its reply."""
    repository, alice, bob = repo
    now = datetime.now(timezone.utc)
    alice_session = await repository.create_session(alice, "Alice")
    bob_session = await repository.create_session(bob, "Bob")
    alice_turn = await repository.start_turn(alice, alice_session.id, uuid.uuid4(), uuid.uuid4(), "alice", now)
    reply_id = uuid.uuid4()
    await repository.complete_turn(alice, alice_turn.id, reply_id, "Alice reply", now)

    bob_turn = await repository.start_turn(bob, bob_session.id, uuid.uuid4(), uuid.uuid4(), "bob", now)
    with pytest.raises(HistoryConflictError, match="completion message conflict"):
        await repository.complete_turn(bob, bob_turn.id, reply_id, "Bob reply", now)

    detail = await repository.get_session(bob, bob_session.id)
    assert detail.turns[0].status == "running"
    assert [message.content for message in detail.turns[0].messages] == ["bob"]


async def test_complete_turn_allows_exact_same_turn_assistant_retry_without_duplication(repo):
    repository, alice, _ = repo
    now = datetime.now(timezone.utc)
    session = await repository.create_session(alice, "Idempotent completion")
    turn = await repository.start_turn(alice, session.id, uuid.uuid4(), uuid.uuid4(), "request", now)
    reply_id = uuid.uuid4()

    await repository.complete_turn(alice, turn.id, reply_id, "same reply", now)
    first = await repository.get_session(alice, session.id)
    await repository.complete_turn(
        alice, turn.id, reply_id, "same reply", now + timedelta(seconds=1)
    )

    detail = await repository.get_session(alice, session.id)
    assert detail.turns[0].status == "completed"
    assert [message.content for message in detail.turns[0].messages] == ["request", "same reply"]
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
        await repository.complete_turn(
            alice, turn.id, uuid.uuid4(), "late reply", now
        )

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
        await repository.complete_turn(
            alice, turn.id, uuid.uuid4(), "late reply", now
        )

    after = await repository.get_session(alice, session.id)
    assert after == before


@pytest.mark.parametrize("terminal_status", ["completed", "failed", "interrupted"])
async def test_terminal_turn_rejects_late_step_create_and_mutation(repo, terminal_status):
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

    assert await repository.upsert_step(
        alice,
        turn.id,
        PersistedStepEvent(
            event_id=event_id,
            label="Mutated",
            status="completed",
            args={"version": 2},
        ),
    ) is False
    assert await repository.upsert_step(
        alice,
        turn.id,
        PersistedStepEvent(event_id=uuid.uuid4(), label="Late", status="running"),
    ) is False

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
