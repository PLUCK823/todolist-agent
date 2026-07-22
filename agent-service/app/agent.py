"""Async Todo agent with in-process turn journals and bounded session state."""

from __future__ import annotations

import asyncio
import copy
import inspect
import logging
import os
import re
import secrets
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable, Optional, Protocol
from uuid import NAMESPACE_URL, uuid5

from langchain_core.messages import (
    AIMessage,
    BaseMessage,
    HumanMessage,
    SystemMessage,
    ToolMessage,
)
from langchain_core.tools import BaseTool, tool as langchain_tool

from .llm import ModelConfig, create_model
from .prompts import SYSTEM_PROMPT
from .schemas import PendingConfirmation
from .tools import (
    complete_todo,
    create_todo,
    delete_todo,
    get_todo,
    list_todos,
    update_todo,
)

logger = logging.getLogger(__name__)

AgentEventSink = Callable[[dict[str, Any]], Awaitable[None]]
CONFIRMATION_TIMEOUT_SECONDS = float(os.getenv("CONFIRMATION_TIMEOUT_SECONDS", "120"))
SESSION_TTL_SECONDS = float(os.getenv("AGENT_SESSION_TTL_SECONDS", "3600"))
MAX_SESSIONS = int(os.getenv("AGENT_MAX_SESSIONS", "1000"))
MAX_MESSAGES_PER_SESSION = int(os.getenv("AGENT_MAX_MESSAGES_PER_SESSION", "200"))
MAX_TOOL_ROUNDS = int(os.getenv("AGENT_MAX_TOOL_ROUNDS", "8"))
MAX_TOOL_CALLS = int(os.getenv("AGENT_MAX_TOOL_CALLS", "32"))
READ_ONLY_RETRY_TOOLS = frozenset({"list_todos", "get_todo"})

_tool_defs: list[BaseTool] = [
    langchain_tool(create_todo),
    langchain_tool(list_todos),
    langchain_tool(get_todo),
    langchain_tool(update_todo),
    langchain_tool(complete_todo),
    langchain_tool(delete_todo),
]
_tools_by_name: dict[str, BaseTool] = {tool.name: tool for tool in _tool_defs}


class AgentExecutionError(RuntimeError):
    """Failure annotated with the protocol phase that actually failed."""

    def __init__(self, message: str, *, phase: str, event_emitted: bool = False):
        super().__init__(message)
        self.phase = phase
        self.event_emitted = event_emitted


class AgentLimitExceeded(AgentExecutionError):
    pass


class SessionDeletedError(AgentExecutionError):
    pass


class AgentCapacityExceeded(AgentExecutionError):
    pass


class InvalidRetryStep(RuntimeError):
    """A retry identity is missing, consumed, stale, or bound elsewhere."""


@dataclass(frozen=True, slots=True)
class DurableTurnRequest:
    """Stable identities required to atomically persist a user turn."""

    turn_id: str
    message_id: str
    assistant_message_id: str
    message: str
    created_at: datetime


class TurnPersistence(Protocol):
    """Durable history boundary injected into the shared Agent loop."""

    async def start(self, request: DurableTurnRequest) -> None: ...

    async def checkpoint(self, event: dict[str, Any]) -> None: ...

    async def complete(self, reply: str) -> None: ...

    async def fail(self, code: str, message: str, *, uncertain: bool) -> None: ...

    def mark_write_applied(self) -> None: ...


@dataclass(frozen=True)
class ProcessResult:
    """Streaming metadata with legacy three-value unpacking compatibility."""

    reply: str
    actions: list[dict[str, Any]]
    session_id: str
    turn_id: str
    generation: int

    def __iter__(self):
        yield self.reply
        yield self.actions
        yield self.session_id


def _build_llm():
    provider = os.getenv("LLM_PROVIDER", "openai").strip().lower()
    if _validate_provider_environment(provider):
        return _DeterministicE2ELLM()
    return create_model(ModelConfig.from_env())


class _DeterministicE2ELLM:
    """Small opt-in model used only by the real-stack E2E environment.

    It still drives the production agent loop and real Todo tools; only the
    external model boundary is deterministic and credential-free.
    """

    def bind_tools(self, _tools: list[BaseTool]) -> "_DeterministicE2ELLM":
        return self

    async def ainvoke(self, messages: list[BaseMessage]) -> AIMessage:
        last_human_index = max(
            (
                index
                for index, message in enumerate(messages)
                if isinstance(message, HumanMessage)
            ),
            default=-1,
        )
        prompt = (
            str(messages[last_human_index].content) if last_human_index >= 0 else ""
        )
        if any(
            isinstance(message, ToolMessage)
            for message in messages[last_human_index + 1 :]
        ):
            title = self._create_title(prompt)
            return AIMessage(content=f"已创建高优先级任务「{title}」。")

        title = self._create_title(prompt)
        return AIMessage(
            content="",
            tool_calls=[
                {
                    "name": "create_todo",
                    "args": {"title": title, "priority": "high"},
                    "id": "e2e-create-todo",
                    "type": "tool_call",
                }
            ],
        )

    @staticmethod
    def _create_title(prompt: str) -> str:
        match = re.search(r"(?:任务|待办)\s*[：:]\s*(.+)$", prompt.strip())
        title = (
            match.group(1).strip(" \t\r\n。.!！?？\"'「」") if match else prompt.strip()
        )
        return title or "真实联调任务"


def _validate_provider_environment(provider: str | None = None) -> bool:
    """Fail closed when the deterministic provider escapes the E2E stack."""
    selected = (provider or os.getenv("LLM_PROVIDER", "openai")).strip().lower()
    if selected not in {"fake", "e2e"}:
        return False
    app_env = os.getenv("APP_ENV", "").strip().lower()
    explicitly_enabled = os.getenv("ENABLE_E2E_PROVIDER", "").strip().lower() == "true"
    if app_env != "e2e" or not explicitly_enabled:
        raise RuntimeError(
            "Deterministic LLM provider is disabled outside the isolated E2E environment"
        )
    return True


def validate_model_configuration() -> None:
    """Validate the selected provider without making a model API request."""

    provider = os.getenv("LLM_PROVIDER", "openai").strip().lower()
    if not _validate_provider_environment(provider):
        ModelConfig.from_env()


# A misconfigured deployed process fails during import/startup, before health
# checks can report a service that would later execute deterministic writes.
_validate_provider_environment()


_compiled_graph = None


def _reset_graph() -> None:
    global _compiled_graph
    _compiled_graph = None


def _get_graph():
    global _compiled_graph
    if _compiled_graph is None:
        _compiled_graph = _build_llm().bind_tools(_tool_defs)
    return _compiled_graph


# Records intentionally remain dictionaries for backward-compatible history
# fixtures. New records add updated_at, generation and incomplete journal.
_conversations: dict[str, dict[str, Any]] = {}
_session_locks: dict[str, asyncio.Lock] = {}
_session_generations: dict[str, int] = {}
_active_tasks: dict[str, asyncio.Task[Any]] = {}


@dataclass
class _SessionSlot:
    lock: asyncio.Lock
    epoch: int = 0
    waiters: int = 0
    refs: int = 0
    active: asyncio.Task[Any] | None = None
    draining: bool = False


_session_slots: dict[str, _SessionSlot] = {}


@dataclass
class _PendingEntry:
    binding: PendingConfirmation
    future: asyncio.Future[bool]
    owner_id: str | None = None
    turn_id: str = ""
    generation: int = 0
    runtime_generation: int | None = None


_pending_confirmations: dict[str, _PendingEntry] = {}


@dataclass(frozen=True)
class _PendingRetry:
    owner_id: str | None
    session_id: str
    step_id: str
    tool: str
    args: dict[str, Any]
    turn_id: str
    generation: int
    runtime_generation: int | None
    attempt_turn_id: str
    attempt_message_id: str
    attempt_assistant_message_id: str
    attempt_message: str
    attempt_created_at: datetime


_pending_retries: dict[str, _PendingRetry] = {}


def _clear_retries_for_session(session_id: str, *, turn_id: str | None = None) -> None:
    for token, retry in list(_pending_retries.items()):
        if retry.session_id == session_id and (
            turn_id is None or retry.turn_id == turn_id
        ):
            _pending_retries.pop(token, None)


def _register_retry(
    session_id: str,
    generation: int,
    owner_id: str | None,
    runtime_generation: int | None,
    state: dict[str, Any],
    step_id: str,
    tool: str,
    args: dict[str, Any],
) -> str:
    token = secrets.token_urlsafe(32)
    attempt_turn_id = str(uuid.uuid4())
    _pending_retries[token] = _PendingRetry(
        owner_id=owner_id,
        session_id=session_id,
        step_id=step_id,
        tool=tool,
        args=copy.deepcopy(args),
        turn_id=state["turn_id"],
        generation=generation,
        runtime_generation=runtime_generation,
        attempt_turn_id=attempt_turn_id,
        attempt_message_id=str(uuid5(NAMESPACE_URL, f"agent:{attempt_turn_id}:user")),
        attempt_assistant_message_id=str(
            uuid5(NAMESPACE_URL, f"agent:{attempt_turn_id}:assistant")
        ),
        attempt_message=f"Retry read-only step {step_id}",
        attempt_created_at=datetime.now(timezone.utc),
    )
    return token


def _clear_pending_for_session(session_id: str) -> None:
    for confirmation_id, entry in list(_pending_confirmations.items()):
        if entry.binding.session_id == session_id:
            _pending_confirmations.pop(confirmation_id, None)
            if not entry.future.done():
                entry.future.cancel()


def invalidate_turn_tokens(
    session_id: str, turn_id: str | None, generation: int | None
) -> None:
    """Disable retry and confirmation capabilities after a terminal fault."""
    _clear_retries_for_session(session_id, turn_id=turn_id)
    for confirmation_id, entry in list(_pending_confirmations.items()):
        if (
            entry.binding.session_id == session_id
            and (turn_id is None or entry.turn_id == turn_id)
            and (generation is None or entry.generation == generation)
        ):
            _pending_confirmations.pop(confirmation_id, None)
            if not entry.future.done():
                entry.future.cancel()


def _evict_session(session_id: str) -> None:
    _conversations.pop(session_id, None)
    _clear_pending_for_session(session_id)
    _clear_retries_for_session(session_id)
    slot = _session_slots.get(session_id)
    if slot is None or slot.refs == 0:
        _session_slots.pop(session_id, None)
        _session_locks.pop(session_id, None)


def _slot_for(session_id: str) -> _SessionSlot:
    slot = _session_slots.get(session_id)
    if slot is None:
        lock = _session_locks.get(session_id) or asyncio.Lock()
        slot = _SessionSlot(lock=lock, epoch=_session_generations.get(session_id, 0))
        _session_slots[session_id] = slot
        _session_locks[session_id] = lock
    return slot


def _safe_to_evict(session_id: str, record: dict[str, Any]) -> bool:
    slot = _session_slots.get(session_id)
    idle = slot is None or (
        slot.refs == 0 and slot.waiters == 0 and slot.active is None
    )
    return idle and record.get("incomplete") is None


def _prune_sessions(
    *, now: Optional[float] = None, protected: str | None = None
) -> None:
    """Expire idle records then enforce the LRU session-count budget."""
    now = time.monotonic() if now is None else now
    expired = [
        session_id
        for session_id, record in _conversations.items()
        if session_id != protected
        and _safe_to_evict(session_id, record)
        and now - float(record.get("updated_at", now)) > SESSION_TTL_SECONDS
    ]
    for session_id in expired:
        _session_generations[session_id] = _session_generations.get(session_id, 0) + 1
        task = _active_tasks.get(session_id)
        if task is not None:
            task.cancel()
        _evict_session(session_id)
        if task is None:
            _session_generations.pop(session_id, None)

    candidates = sorted(
        (
            (float(record.get("updated_at", 0)), session_id)
            for session_id, record in _conversations.items()
            if session_id != protected and _safe_to_evict(session_id, record)
        )
    )
    while len(_conversations) > max(1, MAX_SESSIONS) and candidates:
        _, session_id = candidates.pop(0)
        _session_generations[session_id] = _session_generations.get(session_id, 0) + 1
        task = _active_tasks.get(session_id)
        if task is not None:
            task.cancel()
        _evict_session(session_id)
        if task is None:
            _session_generations.pop(session_id, None)


def _ensure_capacity(session_id: str) -> None:
    if session_id in _conversations:
        return
    _prune_sessions(protected=session_id)
    if len(_conversations) < max(1, MAX_SESSIONS):
        return
    candidates = sorted(
        (
            (float(record.get("updated_at", 0)), candidate)
            for candidate, record in _conversations.items()
            if candidate != session_id and _safe_to_evict(candidate, record)
        )
    )
    if not candidates:
        raise AgentCapacityExceeded("Agent session capacity exceeded", phase="session")
    _, candidate = candidates[0]
    _session_generations[candidate] = _session_generations.get(candidate, 0) + 1
    _evict_session(candidate)
    _session_generations.pop(candidate, None)


def _trim_messages(messages: list[BaseMessage]) -> list[BaseMessage]:
    budget = max(2, MAX_MESSAGES_PER_SESSION)
    if len(messages) <= budget:
        return messages
    system = messages[0] if isinstance(messages[0], SystemMessage) else None
    tail_budget = budget - (1 if system else 0)
    tail = list(messages[-tail_budget:])
    # Never start retained context with orphaned tool responses.
    while tail and isinstance(tail[0], ToolMessage):
        tail.pop(0)
    return ([system] if system else []) + tail


def get_history(session_id: str) -> Optional[dict]:
    record = _conversations.get(session_id)
    if record is not None:
        record["updated_at"] = time.monotonic()
    return record


async def _cancel_and_drain(task: asyncio.Task[Any], timeout: float = 0.1) -> None:
    if task.done():
        try:
            task.result()
        except BaseException:
            pass
        return
    task.cancel()
    done, _ = await asyncio.wait({task}, timeout=timeout)
    if done:
        try:
            task.result()
        except BaseException:
            pass
    else:
        task.add_done_callback(
            lambda finished: finished.exception() if not finished.cancelled() else None
        )


async def delete_history(session_id: str) -> bool:
    """Tombstone and cancel a session without allowing an inflight turn to revive it."""
    slot = _session_slots.get(session_id)
    existed = (
        session_id in _conversations
        or session_id in _active_tasks
        or (slot is not None and slot.refs > 0)
    )
    next_epoch = _session_generations.get(session_id, 0) + 1
    _session_generations[session_id] = next_epoch
    if slot is not None:
        slot.epoch = next_epoch
    task = slot.active if slot is not None else _active_tasks.get(session_id)
    if slot is not None and task is not None:
        slot.draining = True
    _evict_session(session_id)
    if task is not None and task is not asyncio.current_task():
        await _cancel_and_drain(task)
    if task is None and (slot is None or slot.refs == 0):
        _session_generations.pop(session_id, None)
    return existed


def resolve_confirmation(
    session_id: str,
    confirmation_id: str,
    approved: bool,
    *,
    owner_id: str | None = None,
    runtime_generation: int | None = None,
) -> bool:
    entry = _pending_confirmations.get(confirmation_id)
    slot = _session_slots.get(session_id)
    record = _conversations.get(session_id)
    state = record.get("incomplete") if record is not None else None
    if (
        entry is None
        or entry.binding.session_id != session_id
        or slot is None
        or slot.epoch != entry.generation
        or state is None
        or state.get("turn_id") != entry.turn_id
        or (entry.owner_id is not None and entry.owner_id != owner_id)
        or (
            entry.runtime_generation is not None
            and entry.runtime_generation != runtime_generation
        )
    ):
        return False
    _pending_confirmations.pop(confirmation_id, None)
    if entry.future.done():
        return False
    entry.future.set_result(approved)
    return True


async def retry_failed_step(
    session_id: str,
    step_id: str,
    retry_token: str,
    on_event: Optional[AgentEventSink] = None,
    *,
    owner_id: str | None = None,
    runtime_generation: int | None = None,
    persistence: TurnPersistence | None = None,
) -> dict[str, Any]:
    """Execute one exact server-recorded read-only call without invoking the LLM."""
    slot = _session_slots.get(session_id)
    if slot is None or slot.active is not None:
        raise InvalidRetryStep("retry step does not exist or is no longer available")
    async with slot.lock:
        pending = _pending_retries.get(retry_token)
        record = _conversations.get(session_id)
        if (
            pending is None
            or (pending.owner_id is not None and pending.owner_id != owner_id)
            or pending.session_id != session_id
            or pending.step_id != step_id
            or pending.generation != slot.epoch
            or (
                pending.runtime_generation is not None
                and pending.runtime_generation != runtime_generation
            )
            or pending.tool not in READ_ONLY_RETRY_TOOLS
            or record is None
        ):
            raise InvalidRetryStep(
                "retry step does not exist or is no longer available"
            )
        state = record.get("incomplete")
        if state is not None:
            if (
                state.get("turn_id") != pending.turn_id
                or state.get("phase") != "ready_reply"
            ):
                raise InvalidRetryStep(
                    "retry step is not available before its turn is terminal"
                )
            _commit_state(session_id, pending.generation, record, state)
            record = _conversations.get(session_id)
            assert record is not None
            record["pending_terminal_ack_turn_id"] = pending.turn_id
            _save_record(session_id, pending.generation, record)
            record = _conversations.get(session_id)
        if record is None or record.get("last_completed_turn_id") != pending.turn_id:
            raise InvalidRetryStep("retry step is not bound to the completed turn")
        tool = _tools_by_name.get(pending.tool)
        if tool is None:
            raise InvalidRetryStep("retry tool is no longer available")
        if persistence is not None:
            # Start before consuming the capability. If the commit succeeds
            # but its acknowledgement is lost, the same token retries these
            # pre-generated identities idempotently.
            await persistence.start(
                DurableTurnRequest(
                    turn_id=pending.attempt_turn_id,
                    message_id=pending.attempt_message_id,
                    assistant_message_id=pending.attempt_assistant_message_id,
                    message=pending.attempt_message,
                    created_at=pending.attempt_created_at,
                )
            )
        if _pending_retries.pop(retry_token, None) is not pending:
            raise InvalidRetryStep(
                "retry step does not exist or is no longer available"
            )
        started = time.monotonic()
        event_id = str(
            uuid5(
                NAMESPACE_URL,
                f"agent:{pending.attempt_turn_id}:retry:{pending.step_id}",
            )
        )
        started_at = _now_iso()

        async def emit(event: dict[str, Any]) -> None:
            if persistence is not None:
                await persistence.checkpoint(event)
            await _emit(on_event, event)

        await emit(
            {
                "type": "step_started",
                "event_id": event_id,
                "step_id": step_id,
                "label": "重试 Todo API 查询",
                "tool": pending.tool,
                "args": copy.deepcopy(pending.args),
                "started_at": started_at,
            }
        )
        try:
            result = await tool.ainvoke(copy.deepcopy(pending.args))
        except Exception as exc:
            error_code, _ = _failure_metadata(exc)
            await emit(
                {
                    "type": "step_failed",
                    "event_id": event_id,
                    "step_id": step_id,
                    "label": "重试 Todo API 查询",
                    "tool": pending.tool,
                    "args": copy.deepcopy(pending.args),
                    "started_at": started_at,
                    "error_code": error_code,
                    "message": str(exc),
                    "retryable": False,
                    "duration_ms": int((time.monotonic() - started) * 1000),
                }
            )
            if persistence is not None:
                await persistence.fail(error_code, str(exc), uncertain=False)
            raise AgentExecutionError(
                str(exc), phase=step_id, event_emitted=on_event is not None
            ) from exc
        event = {
            "type": "action_completed",
            "event_id": event_id,
            "step_id": step_id,
            "label": "重试 Todo API 查询",
            "tool": pending.tool,
            "args": copy.deepcopy(pending.args),
            "started_at": started_at,
            "action": pending.tool,
            "result": result,
            "duration_ms": int((time.monotonic() - started) * 1000),
        }
        await emit(event)
        if persistence is None:
            await _emit(on_event, {"type": "reply", "content": "已重新执行查询。"})
        return result


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _ensure_event_id(event: dict[str, Any], turn_id: str) -> dict[str, Any]:
    """Give all visible transitions one stable identity per logical step."""
    if event.get("type") in {
        "step_started",
        "step_completed",
        "action_completed",
        "step_failed",
        "confirmation_required",
    }:
        step_id = str(event.get("step_id", event["type"]))
        event.setdefault(
            "event_id", str(uuid5(NAMESPACE_URL, f"agent:{turn_id}:{step_id}"))
        )
    return event


async def _emit(on_event: Optional[AgentEventSink], event: dict[str, Any]) -> None:
    if on_event is None:
        return
    result = on_event(event)
    if inspect.isawaitable(result):
        await result


def _failure_metadata(exc: Exception) -> tuple[str, bool]:
    message = str(exc).lower()
    if isinstance(exc, (TimeoutError, asyncio.TimeoutError)) or any(
        marker in message for marker in ("超时", "timeout")
    ):
        return "TOOL_TIMEOUT", True
    if isinstance(exc, ConnectionError) or any(
        marker in message
        for marker in (
            "无法连接",
            "connection",
            "temporar",
            "服务不可用",
            "内部错误",
            "http 429",
            "http 5",
        )
    ):
        return "TOOL_TRANSIENT", False
    if isinstance(exc, (ValueError, TypeError, KeyError)):
        return "TOOL_VALIDATION", False
    return "TOOL_ERROR", False


def _save_record(session_id: str, generation: int, record: dict[str, Any]) -> None:
    if _session_generations.get(session_id, 0) != generation:
        raise SessionDeletedError("session was deleted", phase="session")
    snapshot = copy.deepcopy(record)
    snapshot["generation"] = generation
    snapshot["updated_at"] = time.monotonic()
    _conversations.pop(session_id, None)
    _conversations[session_id] = snapshot
    _prune_sessions(protected=session_id)


def _new_incomplete(message: str, committed: list[BaseMessage]) -> dict[str, Any]:
    turn_id = str(uuid.uuid4())
    return {
        "request": message,
        "turn_id": turn_id,
        "user_message_id": str(uuid5(NAMESPACE_URL, f"agent:{turn_id}:user")),
        "assistant_message_id": str(uuid5(NAMESPACE_URL, f"agent:{turn_id}:assistant")),
        "messages": list(committed) + [HumanMessage(content=message)],
        "actions": [],
        "journal": {},
        "tool_steps": {},
        "confirmations": {},
        "pending_event": None,
        "pending_event_kind": None,
        "phase": "understand",
        "tool_rounds": 0,
        "tool_calls": 0,
        "attempted_calls": set(),
        "error_code": None,
    }


async def _deliver_checkpointed_event(
    session_id: str,
    generation: int,
    record: dict[str, Any],
    state: dict[str, Any],
    on_event: Optional[AgentEventSink],
    event: dict[str, Any],
    *,
    kind: str = "event",
) -> None:
    """Persist the exact event before crossing the fallible stream boundary."""
    _ensure_event_id(event, state["turn_id"])
    state["pending_event"] = copy.deepcopy(event)
    state["pending_event_kind"] = kind
    record["incomplete"] = state
    _save_record(session_id, generation, record)
    await _emit(on_event, event)
    state["pending_event"] = None
    state["pending_event_kind"] = None
    _save_record(session_id, generation, record)


async def _replay_pending_event(
    session_id: str,
    generation: int,
    record: dict[str, Any],
    state: dict[str, Any],
    on_event: Optional[AgentEventSink],
) -> None:
    event = state.get("pending_event")
    if event is None or state.get("pending_event_kind") == "confirmation":
        return
    _ensure_event_id(event, state["turn_id"])
    await _emit(on_event, copy.deepcopy(event))
    state["pending_event"] = None
    state["pending_event_kind"] = None
    _save_record(session_id, generation, record)


def _reply_from(messages: list[BaseMessage]) -> str:
    for item in reversed(messages):
        if isinstance(item, AIMessage) and item.content:
            return str(item.content)
    return "操作已完成"


def _commit_state(
    session_id: str,
    generation: int,
    record: dict[str, Any],
    state: dict[str, Any],
) -> None:
    record["messages"] = _trim_messages(state["messages"])
    record["last_completed_turn_id"] = state["turn_id"]
    record["incomplete"] = None
    _save_record(session_id, generation, record)


async def complete_turn(session_id: str, turn_id: str, generation: int) -> bool:
    """Acknowledge that a streamed final reply and done event were delivered."""
    slot = _session_slots.get(session_id)
    if slot is None or slot.epoch != generation:
        return False
    async with slot.lock:
        if slot.epoch != generation:
            return False
        record = _conversations.get(session_id)
        if record is None:
            return False
        state = record.get("incomplete")
        if (
            state is None
            and record.get("generation") == generation
            and record.get("pending_terminal_ack_turn_id") == turn_id
        ):
            record.pop("pending_terminal_ack_turn_id", None)
            _save_record(session_id, generation, record)
            return True
        if (
            state is None
            or state.get("phase") != "ready_reply"
            or state.get("turn_id") != turn_id
            or record.get("generation") != generation
        ):
            return False
        _commit_state(session_id, generation, record, state)
        return True


async def _emit_model_failure(
    session_id: str,
    generation: int,
    record: dict[str, Any],
    state: dict[str, Any],
    on_event: Optional[AgentEventSink],
    phase: str,
    exc: Exception,
) -> bool:
    try:
        await _deliver_checkpointed_event(
            session_id,
            generation,
            record,
            state,
            on_event,
            {
                "type": "step_failed",
                "step_id": phase,
                "error_code": "AGENT_MODEL_ERROR",
                "message": str(exc),
                "retryable": True,
                "duration_ms": 0,
            },
        )
        return on_event is not None
    except Exception:
        return False


async def _raise_limit(
    session_id: str,
    generation: int,
    record: dict[str, Any],
    state: dict[str, Any],
    on_event: Optional[AgentEventSink],
) -> None:
    state["error_code"] = "AGENT_LIMIT_EXCEEDED"
    record["incomplete"] = state
    await _deliver_checkpointed_event(
        session_id,
        generation,
        record,
        state,
        on_event,
        {
            "type": "step_failed",
            "step_id": "agent",
            "error_code": "AGENT_LIMIT_EXCEEDED",
            "message": "Agent execution limit exceeded",
            "retryable": False,
            "duration_ms": 0,
        },
    )
    raise AgentLimitExceeded(
        "Agent execution limit exceeded",
        phase="agent",
        event_emitted=on_event is not None,
    )


async def process_message(
    session_id: Optional[str],
    message: str,
    on_event: Optional[AgentEventSink] = None,
    *,
    persistence: TurnPersistence | None = None,
    initial_history: list[BaseMessage] | None = None,
    owner_id: str | None = None,
    runtime_generation: int | None = None,
) -> ProcessResult:
    session_id = session_id or str(uuid.uuid4())
    slot = _slot_for(session_id)
    captured_epoch = slot.epoch
    if slot.draining and slot.active is not None:
        raise SessionDeletedError(
            "deleted session still has an active task draining",
            phase="session",
        )
    slot.waiters += 1
    slot.refs += 1
    acquired = False
    current_task = asyncio.current_task()
    try:
        await slot.lock.acquire()
        acquired = True
        slot.waiters -= 1
        if slot.epoch != captured_epoch:
            raise SessionDeletedError(
                "session was deleted while request waited", phase="session"
            )
        generation = captured_epoch
        _ensure_capacity(session_id)
        if current_task is not None:
            _active_tasks[session_id] = current_task
            slot.active = current_task
            slot.draining = False
        try:
            _prune_sessions(protected=session_id)
            existing = copy.deepcopy(_conversations.get(session_id, {}))
            hydrated = [SystemMessage(content=SYSTEM_PROMPT)] + list(
                initial_history or []
            )
            committed = list(existing.get("messages", _trim_messages(hydrated)))
            original_event_sink = on_event

            async def durable_event_sink(event: dict[str, Any]) -> None:
                assert persistence is not None
                await persistence.checkpoint(event)
                await _emit(original_event_sink, event)

            event_sink = durable_event_sink if persistence is not None else on_event
            state = existing.get("incomplete")
            if state is not None:
                if state["request"] != message:
                    raise AgentExecutionError(
                        "session has an incomplete different request", phase="session"
                    )
                if state.get("error_code") == "AGENT_LIMIT_EXCEEDED":
                    await _raise_limit(
                        session_id, generation, existing, state, event_sink
                    )
                state["error_code"] = None
            else:
                _clear_retries_for_session(session_id)
                state = _new_incomplete(message, committed)

            # Forward-compatible defaults for journals created by older workers.
            state.setdefault("turn_id", str(uuid.uuid4()))
            state.setdefault(
                "user_message_id",
                str(uuid5(NAMESPACE_URL, f"agent:{state['turn_id']}:user")),
            )
            state.setdefault(
                "assistant_message_id",
                str(
                    uuid5(
                        NAMESPACE_URL,
                        f"agent:{state['turn_id']}:assistant",
                    )
                ),
            )
            state.setdefault("tool_steps", {})
            state.setdefault("confirmations", {})
            state.setdefault("pending_event", None)
            state.setdefault("pending_event_kind", None)

            # Journal stable durable identities before the database call. If
            # the commit succeeds but its acknowledgement is lost, reconnect
            # retries the exact same turn/user identities idempotently.
            record = dict(existing)
            record["messages"] = committed
            record["incomplete"] = state
            _save_record(session_id, generation, record)

            if persistence is not None:
                await persistence.start(
                    DurableTurnRequest(
                        turn_id=state["turn_id"],
                        message_id=state["user_message_id"],
                        assistant_message_id=state["assistant_message_id"],
                        message=message,
                        created_at=datetime.now(timezone.utc),
                    )
                )

            await _replay_pending_event(
                session_id, generation, record, state, event_sink
            )
            if state["phase"] == "ready_reply":
                reply = state["reply"]
                actions = list(state["actions"])
                if event_sink is None:
                    _commit_state(session_id, generation, record, state)
                return ProcessResult(
                    reply,
                    actions,
                    session_id,
                    state["turn_id"],
                    generation,
                )
            model = _get_graph()
            response: AIMessage | None = state.get("response")

            while True:
                phase = state["phase"]
                if phase == "understand":
                    state["phase"] = "understand_model"
                    understand_started_at = state.setdefault(
                        "understand_started_at", _now_iso()
                    )
                    await _deliver_checkpointed_event(
                        session_id,
                        generation,
                        record,
                        state,
                        event_sink,
                        {
                            "type": "step_started",
                            "step_id": "understand",
                            "label": "理解请求",
                            "started_at": understand_started_at,
                        },
                    )
                    continue

                if phase in ("understand_model", "awaiting_model"):
                    step_id = "understand" if phase == "understand_model" else "respond"
                    try:
                        response = await model.ainvoke(state["messages"])
                    except Exception as exc:
                        state["phase"] = phase
                        state["error_code"] = "AGENT_MODEL_ERROR"
                        record["incomplete"] = state
                        _save_record(session_id, generation, record)
                        emitted = await _emit_model_failure(
                            session_id,
                            generation,
                            record,
                            state,
                            event_sink,
                            step_id,
                            exc,
                        )
                        raise AgentExecutionError(
                            str(exc), phase=step_id, event_emitted=emitted
                        ) from exc
                    state["messages"].append(response)
                    has_tools = isinstance(response, AIMessage) and bool(
                        response.tool_calls
                    )
                    if has_tools:
                        state["tool_rounds"] += 1
                        if state["tool_rounds"] > MAX_TOOL_ROUNDS:
                            await _raise_limit(
                                session_id, generation, record, state, event_sink
                            )
                        state["response"] = response
                        state["phase"] = "executing_tools"
                    else:
                        state["phase"] = "ready_to_finish"

                    if phase == "understand_model":
                        await _deliver_checkpointed_event(
                            session_id,
                            generation,
                            record,
                            state,
                            event_sink,
                            {
                                "type": "step_completed",
                                "step_id": "understand",
                                "label": "理解请求",
                                "started_at": state.get("understand_started_at"),
                                "duration_ms": 0,
                            },
                        )
                    else:
                        _save_record(session_id, generation, record)
                    continue

                if phase == "ready_to_finish":
                    break

                if phase != "executing_tools":
                    raise AgentExecutionError(
                        f"unknown persisted phase: {phase}", phase="session"
                    )
                response = state.get("response")
                assert response is not None
                round_is_read_only = bool(response.tool_calls) and all(
                    str(call["name"]) in READ_ONLY_RETRY_TOOLS
                    for call in response.tool_calls
                )
                turn_is_read_only = round_is_read_only and all(
                    action.get("type") in READ_ONLY_RETRY_TOOLS
                    for action in state["actions"]
                )
                if not turn_is_read_only:
                    _clear_retries_for_session(session_id, turn_id=state["turn_id"])
                tool_messages: list[ToolMessage] = []
                for tool_call in response.tool_calls:
                    call_id = str(tool_call["id"])
                    journal_key = f"{state['tool_rounds']}:{call_id}"
                    journaled = state["journal"].get(journal_key)
                    if journaled is not None:
                        tool_messages.append(journaled["tool_message"])
                        continue
                    if journal_key not in state["attempted_calls"]:
                        if state["tool_calls"] >= MAX_TOOL_CALLS:
                            await _raise_limit(
                                session_id, generation, record, state, event_sink
                            )
                        state["tool_calls"] += 1
                        state["attempted_calls"].add(journal_key)
                    name = str(tool_call["name"])
                    args = dict(tool_call.get("args") or {})
                    step = state["tool_steps"].setdefault(
                        journal_key,
                        {
                            "step_id": f"{name}-{uuid.uuid4().hex[:8]}",
                            "started": time.monotonic(),
                            "started_at": _now_iso(),
                            "started_sent": False,
                        },
                    )
                    step_id = step["step_id"]
                    started = float(step["started"])
                    if not step["started_sent"]:
                        step["started_sent"] = True
                        await _deliver_checkpointed_event(
                            session_id,
                            generation,
                            record,
                            state,
                            event_sink,
                            {
                                "type": "step_started",
                                "step_id": step_id,
                                "label": "调用 Todo API",
                                "tool": name,
                                "args": args,
                                "started_at": step["started_at"],
                            },
                        )
                    tool = _tools_by_name.get(name)
                    confirmation_id: str | None = None
                    if tool is None:
                        action = {
                            "type": name,
                            "args": args,
                            "error": f"未知工具: {name}",
                        }
                        tool_message = ToolMessage(
                            content=action["error"], tool_call_id=call_id
                        )
                        event = {
                            "type": "step_failed",
                            "step_id": step_id,
                            "error_code": "UNKNOWN_TOOL",
                            "message": action["error"],
                            "retryable": False,
                            "duration_ms": 0,
                        }
                    else:
                        approved = name != "delete_todo"
                        if name == "delete_todo" and event_sink is not None:
                            confirmation = state["confirmations"].setdefault(
                                journal_key,
                                {
                                    "confirmation_id": f"confirm-{uuid.uuid4()}",
                                    "event": None,
                                },
                            )
                            confirmation_id = confirmation["confirmation_id"]
                            binding = PendingConfirmation(
                                confirmation_id=confirmation_id,
                                session_id=session_id,
                                tool="delete_todo",
                                args=dict(args),
                                message="确认删除这个待办吗？此操作不可撤销。",
                            )
                            if confirmation["event"] is None:
                                confirmation["event"] = {
                                    "type": "confirmation_required",
                                    "step_id": step_id,
                                    "label": "调用 Todo API",
                                    "tool": name,
                                    "args": args,
                                    "started_at": step["started_at"],
                                    "message": binding.message,
                                    "confirmation_id": confirmation_id,
                                }
                            future: asyncio.Future[bool] = (
                                asyncio.get_running_loop().create_future()
                            )
                            entry = _PendingEntry(
                                binding=binding,
                                future=future,
                                owner_id=owner_id,
                                turn_id=state["turn_id"],
                                generation=generation,
                                runtime_generation=runtime_generation,
                            )
                            _pending_confirmations[confirmation_id] = entry
                            try:
                                if state.get("pending_event_kind") == "confirmation":
                                    await _emit(
                                        event_sink,
                                        copy.deepcopy(confirmation["event"]),
                                    )
                                    state["pending_event"] = None
                                    state["pending_event_kind"] = None
                                    _save_record(session_id, generation, record)
                                else:
                                    await _deliver_checkpointed_event(
                                        session_id,
                                        generation,
                                        record,
                                        state,
                                        event_sink,
                                        confirmation["event"],
                                        kind="confirmation",
                                    )
                                approved = await asyncio.wait_for(
                                    future,
                                    timeout=CONFIRMATION_TIMEOUT_SECONDS,
                                )
                            except asyncio.TimeoutError:
                                action = {
                                    "type": name,
                                    "args": args,
                                    "error": "确认请求已超时",
                                }
                                tool_message = ToolMessage(
                                    content=action["error"], tool_call_id=call_id
                                )
                                event = {
                                    "type": "step_failed",
                                    "step_id": step_id,
                                    "label": "调用 Todo API",
                                    "tool": name,
                                    "args": args,
                                    "started_at": step["started_at"],
                                    "error_code": "CONFIRMATION_TIMEOUT",
                                    "message": action["error"],
                                    "retryable": False,
                                    "duration_ms": int(
                                        (time.monotonic() - started) * 1000
                                    ),
                                }
                                approved = False
                                state["journal"][journal_key] = {
                                    "action": action,
                                    "tool_message": tool_message,
                                    "event": event,
                                }
                                state["actions"].append(action)
                                _save_record(session_id, generation, record)
                                await _deliver_checkpointed_event(
                                    session_id,
                                    generation,
                                    record,
                                    state,
                                    event_sink,
                                    event,
                                )
                                tool_messages.append(tool_message)
                                continue
                            finally:
                                if _pending_confirmations.get(confirmation_id) is entry:
                                    _pending_confirmations.pop(confirmation_id, None)
                            state["confirmations"].pop(journal_key, None)
                        if not approved:
                            result = {"cancelled": True}
                            action = {"type": name, "args": args, "result": result}
                            tool_message = ToolMessage(
                                content="用户取消了删除操作", tool_call_id=call_id
                            )
                            event = {
                                "type": "action_completed",
                                "step_id": step_id,
                                "action": name,
                                "result": result,
                                "duration_ms": int((time.monotonic() - started) * 1000),
                            }
                        else:
                            # Once a non-read-only request is dispatched, an
                            # exception cannot prove the remote side effect did
                            # not happen. Keep uncertainty sticky before await.
                            if (
                                persistence is not None
                                and name not in READ_ONLY_RETRY_TOOLS
                            ):
                                persistence.mark_write_applied()
                            try:
                                result = await tool.ainvoke(args)
                            except Exception as exc:
                                error_code, retryable = _failure_metadata(exc)
                                retryable = (
                                    retryable
                                    and turn_is_read_only
                                    and name in READ_ONLY_RETRY_TOOLS
                                )
                                action = {"type": name, "args": args, "error": str(exc)}
                                tool_message = ToolMessage(
                                    content=f"Error: {exc}", tool_call_id=call_id
                                )
                                event = {
                                    "type": "step_failed",
                                    "step_id": step_id,
                                    "error_code": error_code,
                                    "message": str(exc),
                                    "retryable": retryable,
                                    "duration_ms": int(
                                        (time.monotonic() - started) * 1000
                                    ),
                                }
                                if retryable:
                                    event["retry_token"] = _register_retry(
                                        session_id,
                                        generation,
                                        owner_id,
                                        runtime_generation,
                                        state,
                                        step_id,
                                        name,
                                        args,
                                    )
                            else:
                                action = {"type": name, "args": args, "result": result}
                                tool_message = ToolMessage(
                                    content=str(result), tool_call_id=call_id
                                )
                                event = {
                                    "type": "action_completed",
                                    "step_id": step_id,
                                    "action": name,
                                    "result": result,
                                    "duration_ms": int(
                                        (time.monotonic() - started) * 1000
                                    ),
                                }

                    # Every replayable journal entry carries its canonical
                    # snapshot so a fresh persistence sink cannot degrade it.
                    event.update(
                        {
                            "label": "调用 Todo API",
                            "tool": name,
                            "args": args,
                            "started_at": step["started_at"],
                        }
                    )
                    if confirmation_id is not None:
                        event["confirmation_id"] = confirmation_id
                        event["confirmation_message"] = (
                            "确认删除这个待办吗？此操作不可撤销。"
                        )
                        event["confirmation_approved"] = approved

                    # Journal before emitting: a send/model failure can resume
                    # without replaying a successful side effect.
                    state["journal"][journal_key] = {
                        "action": action,
                        "tool_message": tool_message,
                        "event": event,
                    }
                    state["actions"].append(action)
                    record["incomplete"] = state
                    _save_record(session_id, generation, record)
                    await _deliver_checkpointed_event(
                        session_id,
                        generation,
                        record,
                        state,
                        event_sink,
                        event,
                    )
                    tool_messages.append(tool_message)

                state["messages"].extend(tool_messages)
                state["phase"] = "awaiting_model"
                state.pop("response", None)
                response = None
                _save_record(session_id, generation, record)

            reply = _reply_from(state["messages"])
            if event_sink is not None:
                state["phase"] = "ready_reply"
                state["reply"] = reply
                record["incomplete"] = state
                _save_record(session_id, generation, record)
            else:
                _commit_state(session_id, generation, record, state)
            return ProcessResult(
                reply,
                list(state["actions"]),
                session_id,
                state["turn_id"],
                generation,
            )
        finally:
            if _active_tasks.get(session_id) is current_task:
                _active_tasks.pop(session_id, None)
            if slot.active is current_task:
                slot.active = None
                slot.draining = False
    finally:
        if not acquired:
            slot.waiters -= 1
        elif slot.lock.locked():
            slot.lock.release()
        slot.refs -= 1
        if slot.refs == 0 and session_id not in _conversations:
            _session_slots.pop(session_id, None)
            _session_locks.pop(session_id, None)
            _session_generations.pop(session_id, None)
