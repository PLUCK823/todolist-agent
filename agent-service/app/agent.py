"""Async Todo agent with in-process turn journals and bounded session state."""

from __future__ import annotations

import asyncio
import copy
import inspect
import logging
import os
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable, Optional

from langchain_core.messages import (
    AIMessage,
    BaseMessage,
    HumanMessage,
    SystemMessage,
    ToolMessage,
)
from langchain_core.tools import BaseTool, tool as langchain_tool

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
    from langchain_openai import ChatOpenAI

    return ChatOpenAI(
        model=os.getenv("OPENAI_MODEL", "gpt-4o"),
        temperature=0.2,
        base_url=os.getenv("OPENAI_BASE_URL", None),
    )


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


_session_slots: dict[str, _SessionSlot] = {}


@dataclass
class _PendingEntry:
    binding: PendingConfirmation
    future: asyncio.Future[bool]


_pending_confirmations: dict[str, _PendingEntry] = {}


def _clear_pending_for_session(session_id: str) -> None:
    for confirmation_id, entry in list(_pending_confirmations.items()):
        if entry.binding.session_id == session_id:
            _pending_confirmations.pop(confirmation_id, None)
            if not entry.future.done():
                entry.future.cancel()


def _evict_session(session_id: str) -> None:
    _conversations.pop(session_id, None)
    _clear_pending_for_session(session_id)
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
    _evict_session(session_id)
    if task is not None and task is not asyncio.current_task():
        await _cancel_and_drain(task)
    if task is None and (slot is None or slot.refs == 0):
        _session_generations.pop(session_id, None)
    return existed


def resolve_confirmation(session_id: str, confirmation_id: str, approved: bool) -> bool:
    entry = _pending_confirmations.get(confirmation_id)
    if entry is None or entry.binding.session_id != session_id:
        return False
    _pending_confirmations.pop(confirmation_id, None)
    if entry.future.done():
        return False
    entry.future.set_result(approved)
    return True


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


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
        return "TOOL_TIMEOUT", False
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
    return {
        "request": message,
        "turn_id": str(uuid.uuid4()),
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
) -> ProcessResult:
    session_id = session_id or str(uuid.uuid4())
    slot = _slot_for(session_id)
    captured_epoch = slot.epoch
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
        try:
            _prune_sessions(protected=session_id)
            existing = copy.deepcopy(_conversations.get(session_id, {}))
            committed = list(
                existing.get("messages", [SystemMessage(content=SYSTEM_PROMPT)])
            )
            state = existing.get("incomplete")
            if state is not None:
                if state["request"] != message:
                    raise AgentExecutionError(
                        "session has an incomplete different request", phase="session"
                    )
                if state.get("error_code") == "AGENT_LIMIT_EXCEEDED":
                    await _raise_limit(
                        session_id, generation, existing, state, on_event
                    )
                state["error_code"] = None
            else:
                state = _new_incomplete(message, committed)

            # Forward-compatible defaults for journals created by older workers.
            state.setdefault("turn_id", str(uuid.uuid4()))
            state.setdefault("tool_steps", {})
            state.setdefault("confirmations", {})
            state.setdefault("pending_event", None)
            state.setdefault("pending_event_kind", None)

            record = dict(existing)
            record["messages"] = committed
            record["incomplete"] = state
            _save_record(session_id, generation, record)
            await _replay_pending_event(session_id, generation, record, state, on_event)
            if state["phase"] == "ready_reply":
                reply = state["reply"]
                actions = list(state["actions"])
                if on_event is None:
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
                    await _deliver_checkpointed_event(
                        session_id,
                        generation,
                        record,
                        state,
                        on_event,
                        {
                            "type": "step_started",
                            "step_id": "understand",
                            "label": "理解请求",
                            "started_at": _now_iso(),
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
                            on_event,
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
                                session_id, generation, record, state, on_event
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
                            on_event,
                            {
                                "type": "step_completed",
                                "step_id": "understand",
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
                                session_id, generation, record, state, on_event
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
                            on_event,
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
                        if name == "delete_todo" and on_event is not None:
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
                                    "message": binding.message,
                                    "confirmation_id": confirmation_id,
                                }
                            future: asyncio.Future[bool] = (
                                asyncio.get_running_loop().create_future()
                            )
                            entry = _PendingEntry(binding=binding, future=future)
                            _pending_confirmations[confirmation_id] = entry
                            try:
                                if state.get("pending_event_kind") == "confirmation":
                                    await _emit(
                                        on_event,
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
                                        on_event,
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
                                    on_event,
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
                            try:
                                result = await tool.ainvoke(args)
                            except Exception as exc:
                                error_code, retryable = _failure_metadata(exc)
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
                        on_event,
                        event,
                    )
                    tool_messages.append(tool_message)

                state["messages"].extend(tool_messages)
                state["phase"] = "awaiting_model"
                state.pop("response", None)
                response = None
                _save_record(session_id, generation, record)

            reply = _reply_from(state["messages"])
            if on_event is not None:
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
