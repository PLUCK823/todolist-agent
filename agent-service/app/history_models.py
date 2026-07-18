"""Immutable records that form the durable Agent history boundary."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Literal
from uuid import UUID


TurnStatus = Literal["running", "waiting_confirmation", "completed", "failed", "interrupted"]
MessageRole = Literal["user", "assistant", "system", "tool"]
StepStatus = Literal[
    "waiting", "running", "waiting_confirmation", "completed", "failed", "interrupted"
]


@dataclass(frozen=True, slots=True)
class SessionSummary:
    id: UUID
    owner_id: UUID
    title: str
    created_at: datetime
    updated_at: datetime
    last_message_at: datetime


@dataclass(frozen=True, slots=True)
class MessageRecord:
    id: UUID
    session_id: UUID
    turn_id: UUID
    role: MessageRole
    content: str
    ordinal: int
    created_at: datetime


@dataclass(frozen=True, slots=True)
class StepRecord:
    id: UUID
    turn_id: UUID
    event_id: UUID
    ordinal: int
    label: str
    status: StepStatus
    tool: str | None
    args: dict[str, Any]
    result: Any | None
    result_preview: str | None
    result_truncated: bool
    duration_ms: int | None
    error_code: str | None
    error_message: str | None
    retryable: bool
    confirmation_id: str | None
    confirmation_message: str | None
    confirmation_approved: bool | None
    started_at: datetime
    completed_at: datetime | None


@dataclass(frozen=True, slots=True)
class TurnRecord:
    id: UUID
    session_id: UUID
    ordinal: int
    status: TurnStatus
    started_at: datetime
    completed_at: datetime | None
    failure_code: str | None
    failure_message: str | None
    result_uncertain: bool
    messages: tuple[MessageRecord, ...] = field(default_factory=tuple)
    steps: tuple[StepRecord, ...] = field(default_factory=tuple)


@dataclass(frozen=True, slots=True)
class SessionDetail(SessionSummary):
    turns: tuple[TurnRecord, ...] = field(default_factory=tuple)


@dataclass(frozen=True, slots=True)
class PersistedStepEvent:
    """One stable checkpoint emitted by the Agent execution loop."""

    event_id: UUID
    label: str
    status: StepStatus
    tool: str | None = None
    args: dict[str, Any] = field(default_factory=dict)
    result: Any | None = None
    duration_ms: int | None = None
    error_code: str | None = None
    error_message: str | None = None
    retryable: bool = False
    confirmation_id: str | None = None
    confirmation_message: str | None = None
    confirmation_approved: bool | None = None
    started_at: datetime | None = None
    completed_at: datetime | None = None
