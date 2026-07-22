"""Async PostgreSQL persistence for user-owned Agent conversations.

The repository is intentionally the only place that knows the durable schema.
Every externally reachable operation scopes its lookup through ``owner_id``;
an identifier alone is never authority to read, mutate, or remove a session.
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from typing import Any
from uuid import UUID, uuid4

import asyncpg

from .history_models import (
    MessageRecord,
    PersistedStepEvent,
    SessionDetail,
    SessionSummary,
    StepRecord,
    TurnRecord,
)


DEFAULT_SESSION_TITLE = "新对话"
RESULT_MAX_BYTES = int(os.getenv("AGENT_RESULT_MAX_BYTES", "65536"))
RESULT_PREVIEW_CHARS = 4096
OPEN_TURN_STATUSES = ("running", "waiting_confirmation")


class HistoryNotFoundError(LookupError):
    """A session or turn is absent for this owner (without leaking ownership)."""


class HistoryConflictError(RuntimeError):
    """A caller attempted an incompatible identity or terminal-state transition."""


def _utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        raise ValueError("timestamps must be timezone-aware")
    return value.astimezone(timezone.utc)


def _json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str)


def _json_from_database(value: Any) -> Any:
    if isinstance(value, str):
        return json.loads(value)
    return value


def _collapsed_title(content: str) -> str:
    return " ".join(content.split())[:48]


def _session_from_row(row: asyncpg.Record) -> SessionSummary:
    return SessionSummary(
        id=row["id"], owner_id=row["owner_id"], title=row["title"],
        created_at=row["created_at"], updated_at=row["updated_at"],
        last_message_at=row["last_message_at"],
    )


def _message_from_row(row: asyncpg.Record) -> MessageRecord:
    return MessageRecord(
        id=row["id"], session_id=row["session_id"], turn_id=row["turn_id"],
        role=row["role"], content=row["content"], ordinal=row["ordinal"],
        created_at=row["created_at"],
    )


def _step_from_row(row: asyncpg.Record) -> StepRecord:
    return StepRecord(
        id=row["id"], turn_id=row["turn_id"], event_id=row["event_id"], ordinal=row["ordinal"],
        label=row["label"], status=row["status"], tool=row["tool"],
        args=_json_from_database(row["args"]) or {}, result=_json_from_database(row["result"]),
        result_preview=row["result_preview"], result_truncated=row["result_truncated"],
        duration_ms=row["duration_ms"], error_code=row["error_code"],
        error_message=row["error_message"], retryable=row["retryable"],
        confirmation_id=row["confirmation_id"], confirmation_message=row["confirmation_message"],
        confirmation_approved=row["confirmation_approved"], started_at=row["started_at"],
        completed_at=row["completed_at"],
    )


class HistoryRepository:
    """Repository over a bounded asyncpg pool with short transactions."""

    def __init__(self, pool: asyncpg.Pool):
        self._pool = pool

    async def ping(self) -> None:
        async with self._pool.acquire() as conn:
            await conn.execute("SELECT 1")

    async def list_sessions(self, owner_id: UUID) -> list[SessionSummary]:
        async with self._pool.acquire() as conn:
            rows = await conn.fetch(
                """SELECT id, owner_id, title, created_at, updated_at, last_message_at
                   FROM agent_sessions WHERE owner_id = $1
                   ORDER BY last_message_at DESC, id DESC""", owner_id
            )
        return [_session_from_row(row) for row in rows]

    async def create_session(self, owner_id: UUID, title: str = DEFAULT_SESSION_TITLE) -> SessionSummary:
        normalized = title.strip()
        if not 1 <= len(normalized) <= 160:
            raise ValueError("title must contain 1–160 non-whitespace characters")
        session_id = uuid4()
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                """INSERT INTO agent_sessions (id, owner_id, title)
                   SELECT $1, $2, $3 WHERE EXISTS (SELECT 1 FROM users WHERE id = $2)
                   RETURNING id, owner_id, title, created_at, updated_at, last_message_at""",
                session_id, owner_id, normalized,
            )
        if row is None:
            raise HistoryNotFoundError("owner not found")
        return _session_from_row(row)

    async def get_session(self, owner_id: UUID, session_id: UUID) -> SessionDetail | None:
        async with self._pool.acquire() as conn:
            session = await conn.fetchrow(
                """SELECT id, owner_id, title, created_at, updated_at, last_message_at
                   FROM agent_sessions WHERE id = $1 AND owner_id = $2""", session_id, owner_id
            )
            if session is None:
                return None
            turn_rows = await conn.fetch(
                """SELECT t.id, t.session_id, t.ordinal, t.status, t.started_at, t.completed_at,
                          t.failure_code, t.failure_message, t.result_uncertain
                   FROM agent_turns t JOIN agent_sessions s ON s.id = t.session_id
                   WHERE t.session_id = $1 AND s.owner_id = $2 ORDER BY t.ordinal""", session_id, owner_id
            )
            message_rows = await conn.fetch(
                """SELECT m.id, m.session_id, m.turn_id, m.role, m.content, m.ordinal, m.created_at
                   FROM agent_messages m JOIN agent_sessions s ON s.id = m.session_id
                   WHERE m.session_id = $1 AND s.owner_id = $2 ORDER BY m.ordinal""", session_id, owner_id
            )
            step_rows = await conn.fetch(
                """SELECT st.id, st.turn_id, st.event_id, st.ordinal, st.label, st.status, st.tool,
                          st.args, st.result, st.result_preview, st.result_truncated, st.duration_ms,
                          st.error_code, st.error_message, st.retryable, st.confirmation_id,
                          st.confirmation_message, st.confirmation_approved, st.started_at, st.completed_at
                   FROM agent_steps st
                   JOIN agent_turns t ON t.id = st.turn_id
                   JOIN agent_sessions s ON s.id = t.session_id
                   WHERE t.session_id = $1 AND s.owner_id = $2 ORDER BY t.ordinal, st.ordinal""", session_id, owner_id
            )
        messages: dict[UUID, list[MessageRecord]] = {}
        for row in message_rows:
            message = _message_from_row(row)
            messages.setdefault(message.turn_id, []).append(message)
        steps: dict[UUID, list[StepRecord]] = {}
        for row in step_rows:
            step = _step_from_row(row)
            steps.setdefault(step.turn_id, []).append(step)
        turns = tuple(
            TurnRecord(
                id=row["id"], session_id=row["session_id"], ordinal=row["ordinal"], status=row["status"],
                started_at=row["started_at"], completed_at=row["completed_at"],
                failure_code=row["failure_code"], failure_message=row["failure_message"],
                result_uncertain=row["result_uncertain"], messages=tuple(messages.get(row["id"], ())),
                steps=tuple(steps.get(row["id"], ())),
            ) for row in turn_rows
        )
        summary = _session_from_row(session)
        return SessionDetail(
            id=summary.id,
            owner_id=summary.owner_id,
            title=summary.title,
            created_at=summary.created_at,
            updated_at=summary.updated_at,
            last_message_at=summary.last_message_at,
            turns=turns,
        )

    async def rename_session(self, owner_id: UUID, session_id: UUID, title: str) -> SessionSummary | None:
        normalized = title.strip()
        if not 1 <= len(normalized) <= 160:
            raise ValueError("title must contain 1–160 non-whitespace characters")
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                """UPDATE agent_sessions SET title = $3, updated_at = NOW()
                   WHERE id = $1 AND owner_id = $2
                   RETURNING id, owner_id, title, created_at, updated_at, last_message_at""",
                session_id, owner_id, normalized,
            )
        return _session_from_row(row) if row else None

    async def delete_session(self, owner_id: UUID, session_id: UUID) -> bool:
        async with self._pool.acquire() as conn:
            result = await conn.execute(
                "DELETE FROM agent_sessions WHERE id = $1 AND owner_id = $2", session_id, owner_id
            )
        return result.endswith("1")

    async def start_turn(
        self, owner_id: UUID, session_id: UUID, turn_id: UUID, message_id: UUID,
        content: str, created_at: datetime,
    ) -> TurnRecord:
        now = _utc(created_at)
        async with self._pool.acquire() as conn, conn.transaction():
            session = await conn.fetchrow(
                """SELECT id, title FROM agent_sessions
                   WHERE id = $1 AND owner_id = $2 FOR UPDATE""", session_id, owner_id
            )
            if session is None:
                raise HistoryNotFoundError("session not found")
            turn_ordinal = await conn.fetchval(
                "SELECT COALESCE(MAX(ordinal), 0) + 1 FROM agent_turns WHERE session_id = $1", session_id
            )
            message_ordinal = await conn.fetchval(
                "SELECT COALESCE(MAX(ordinal), 0) + 1 FROM agent_messages WHERE session_id = $1", session_id
            )
            await conn.execute(
                """INSERT INTO agent_turns (id, session_id, ordinal, status, started_at)
                   VALUES ($1, $2, $3, 'running', $4)""", turn_id, session_id, turn_ordinal, now
            )
            await conn.execute(
                """INSERT INTO agent_messages (id, session_id, turn_id, role, content, ordinal, created_at)
                   VALUES ($1, $2, $3, 'user', $4, $5, $6)""",
                message_id, session_id, turn_id, content, message_ordinal, now,
            )
            title = _collapsed_title(content)
            await conn.execute(
                """UPDATE agent_sessions
                   SET title = CASE WHEN title = $3 AND $4 <> '' THEN $4 ELSE title END,
                       updated_at = $5, last_message_at = $5
                   WHERE id = $1 AND owner_id = $2""",
                session_id, owner_id, DEFAULT_SESSION_TITLE, title, now,
            )
        return TurnRecord(
            id=turn_id, session_id=session_id, ordinal=turn_ordinal, status="running", started_at=now,
            completed_at=None, failure_code=None, failure_message=None, result_uncertain=False,
        )

    async def upsert_step(self, owner_id: UUID, turn_id: UUID, event: PersistedStepEvent) -> bool:
        started_at = _utc(event.started_at or datetime.now(timezone.utc))
        completed_at = _utc(event.completed_at) if event.completed_at else None
        args_json = _json(event.args)
        result_json = _json(event.result) if event.result is not None else None
        truncated = result_json is not None and len(result_json.encode("utf-8")) > RESULT_MAX_BYTES
        stored_result = None if truncated else result_json
        preview = result_json[:RESULT_PREVIEW_CHARS] if truncated else None
        async with self._pool.acquire() as conn, conn.transaction():
            owned_turn = await conn.fetchrow(
                """SELECT t.id, t.status FROM agent_turns t JOIN agent_sessions s ON s.id = t.session_id
                   WHERE t.id = $1 AND s.owner_id = $2 FOR UPDATE""", turn_id, owner_id
            )
            if owned_turn is None:
                return False
            if owned_turn["status"] not in OPEN_TURN_STATUSES:
                return False
            existing = await conn.fetchrow(
                """SELECT st.turn_id FROM agent_steps st
                   JOIN agent_turns t ON t.id = st.turn_id
                   JOIN agent_sessions s ON s.id = t.session_id
                   WHERE st.event_id = $1 AND s.owner_id = $2""",
                event.event_id, owner_id,
            )
            if existing is not None and existing["turn_id"] != turn_id:
                return False
            if existing is None:
                ordinal = await conn.fetchval(
                    "SELECT COALESCE(MAX(ordinal), 0) + 1 FROM agent_steps WHERE turn_id = $1", turn_id
                )
                inserted = await conn.fetchval(
                    """INSERT INTO agent_steps (
                         id, turn_id, event_id, ordinal, label, tool, status, args, result,
                         result_preview, result_truncated, duration_ms, error_code, error_message,
                         retryable, confirmation_id, confirmation_message, confirmation_approved,
                         started_at, completed_at)
                       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
                       ON CONFLICT (event_id) DO NOTHING RETURNING id""",
                    uuid4(), turn_id, event.event_id, ordinal, event.label, event.tool, event.status,
                    args_json, stored_result, preview, truncated, event.duration_ms, event.error_code,
                    event.error_message, event.retryable, event.confirmation_id,
                    event.confirmation_message, event.confirmation_approved, started_at, completed_at,
                )
                if inserted is None:
                    existing = await conn.fetchrow(
                        """SELECT st.turn_id FROM agent_steps st
                           JOIN agent_turns t ON t.id = st.turn_id
                           JOIN agent_sessions s ON s.id = t.session_id
                           WHERE st.event_id = $1 AND s.owner_id = $2""",
                        event.event_id, owner_id,
                    )
                    if existing is None or existing["turn_id"] != turn_id:
                        return False
                    await conn.execute(
                        """UPDATE agent_steps SET label=$3, tool=$4, status=$5, args=$6::jsonb,
                             result=$7::jsonb, result_preview=$8, result_truncated=$9, duration_ms=$10,
                             error_code=$11, error_message=$12, retryable=$13, confirmation_id=$14,
                             confirmation_message=$15, confirmation_approved=$16, started_at=$17, completed_at=$18
                           WHERE event_id=$1 AND turn_id=$2""",
                        event.event_id, turn_id, event.label, event.tool, event.status, args_json,
                        stored_result, preview, truncated, event.duration_ms, event.error_code,
                        event.error_message, event.retryable, event.confirmation_id,
                        event.confirmation_message, event.confirmation_approved, started_at, completed_at,
                    )
            else:
                await conn.execute(
                    """UPDATE agent_steps SET label=$3, tool=$4, status=$5, args=$6::jsonb,
                         result=$7::jsonb, result_preview=$8, result_truncated=$9, duration_ms=$10,
                         error_code=$11, error_message=$12, retryable=$13, confirmation_id=$14,
                         confirmation_message=$15, confirmation_approved=$16, started_at=$17, completed_at=$18
                       WHERE event_id=$1 AND turn_id=$2""",
                    event.event_id, turn_id, event.label, event.tool, event.status, args_json,
                    stored_result, preview, truncated, event.duration_ms, event.error_code,
                    event.error_message, event.retryable, event.confirmation_id,
                    event.confirmation_message, event.confirmation_approved, started_at, completed_at,
                )
        return True

    async def complete_turn(
        self, owner_id: UUID, turn_id: UUID, message_id: UUID, content: str, created_at: datetime
    ) -> None:
        now = _utc(created_at)
        async with self._pool.acquire() as conn, conn.transaction():
            row = await conn.fetchrow(
                """SELECT t.id, t.session_id, t.status FROM agent_turns t
                   JOIN agent_sessions s ON s.id=t.session_id
                   WHERE t.id=$1 AND s.owner_id=$2 FOR UPDATE OF t, s""", turn_id, owner_id
            )
            if row is None:
                raise HistoryNotFoundError("turn not found")
            session_id = row["session_id"]
            existing_message = await conn.fetchrow(
                """SELECT id, session_id, turn_id, role, content
                   FROM agent_messages WHERE id=$1 FOR UPDATE""",
                message_id,
            )
            message_matches = existing_message is not None and (
                existing_message["session_id"] == session_id
                and existing_message["turn_id"] == turn_id
                and existing_message["role"] == "assistant"
                and existing_message["content"] == content
            )
            if row["status"] == "completed":
                if message_matches:
                    return
                raise HistoryConflictError("completion terminal conflict")
            if row["status"] not in OPEN_TURN_STATUSES:
                raise HistoryConflictError("turn terminal state conflict")
            if existing_message is not None:
                if not message_matches:
                    raise HistoryConflictError("completion message conflict")
            else:
                ordinal = await conn.fetchval(
                    "SELECT COALESCE(MAX(ordinal), 0) + 1 FROM agent_messages WHERE session_id=$1", session_id
                )
                await conn.execute(
                    """INSERT INTO agent_messages (id, session_id, turn_id, role, content, ordinal, created_at)
                       VALUES ($1,$2,$3,'assistant',$4,$5,$6)""",
                    message_id, session_id, turn_id, content, ordinal, now,
                )
            await conn.execute(
                """UPDATE agent_turns SET status='completed', completed_at=$3,
                       failure_code=NULL, failure_message=NULL, result_uncertain=false
                   WHERE id=$1 AND session_id=$2
                     AND status IN ('running', 'waiting_confirmation')""",
                turn_id, session_id, now,
            )
            await conn.execute(
                """UPDATE agent_sessions SET updated_at=$3, last_message_at=$3
                   WHERE id=$1 AND owner_id=$2""", session_id, owner_id, now
            )

    async def fail_turn(self, owner_id: UUID, turn_id: UUID, code: str, message: str, uncertain: bool) -> None:
        failure_code = code[:128]
        async with self._pool.acquire() as conn, conn.transaction():
            row = await conn.fetchrow(
                """SELECT t.status, t.failure_code, t.failure_message, t.result_uncertain
                   FROM agent_turns t
                   JOIN agent_sessions s ON s.id=t.session_id
                   WHERE t.id=$1 AND s.owner_id=$2 FOR UPDATE OF t""",
                turn_id, owner_id,
            )
            if row is None:
                raise HistoryNotFoundError("turn not found")
            if row["status"] == "failed":
                if (
                    row["failure_code"] == failure_code
                    and row["failure_message"] == message
                    and row["result_uncertain"] == uncertain
                ):
                    return
                raise HistoryConflictError("failure terminal conflict")
            if row["status"] not in OPEN_TURN_STATUSES:
                raise HistoryConflictError("turn terminal state conflict")
            await conn.execute(
                """UPDATE agent_turns SET status='failed', completed_at=NOW(), failure_code=$2,
                       failure_message=$3, result_uncertain=$4
                   WHERE id=$1 AND status IN ('running', 'waiting_confirmation')""",
                turn_id, failure_code, message, uncertain,
            )

    async def interrupt_open_turns(self) -> int:
        async with self._pool.acquire() as conn:
            result = await conn.execute(
                """UPDATE agent_turns SET status='interrupted', completed_at=NOW(),
                       failure_code='AGENT_RESTARTED', failure_message='Agent process restarted'
                   WHERE status IN ('running', 'waiting_confirmation')"""
            )
        return int(result.rsplit(" ", 1)[-1])

    async def is_auth_session_active(self, owner_id: UUID, auth_session_id: UUID) -> bool:
        """Return true only for an unrevoked, unexpired Backend auth session."""
        async with self._pool.acquire() as conn:
            value = await conn.fetchval(
                """SELECT EXISTS(
                     SELECT 1 FROM auth_sessions
                     WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL AND expires_at > NOW()
                   )""", auth_session_id, owner_id,
            )
        return bool(value)
