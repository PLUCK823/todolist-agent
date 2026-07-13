"""Async Todo agent with real-time progress and destructive-action approval."""

from __future__ import annotations

import asyncio
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

_tool_defs: list[BaseTool] = [
    langchain_tool(create_todo),
    langchain_tool(list_todos),
    langchain_tool(get_todo),
    langchain_tool(update_todo),
    langchain_tool(complete_todo),
    langchain_tool(delete_todo),
]
_tools_by_name: dict[str, BaseTool] = {tool.name: tool for tool in _tool_defs}


def _build_llm():
    """Create the configured tool-capable chat model."""
    from langchain_openai import ChatOpenAI

    return ChatOpenAI(
        model=os.getenv("OPENAI_MODEL", "gpt-4o"),
        temperature=0.2,
        base_url=os.getenv("OPENAI_BASE_URL", None),
    )


_compiled_graph = None


def _reset_graph() -> None:
    """Clear the cached tool-bound model (keeps the historic test seam)."""
    global _compiled_graph
    _compiled_graph = None


def _get_graph():
    """Return a cached tool-bound model.

    The public behavior remains the former LangGraph ReAct loop, while the
    loop is now explicit so events can bracket the actual awaited operations.
    """
    global _compiled_graph
    if _compiled_graph is None:
        _compiled_graph = _build_llm().bind_tools(_tool_defs)
    return _compiled_graph


_conversations: dict[str, dict[str, Any]] = {}


@dataclass
class _PendingEntry:
    binding: PendingConfirmation
    future: asyncio.Future[bool]


_pending_confirmations: dict[str, _PendingEntry] = {}


def get_history(session_id: str) -> Optional[dict]:
    return _conversations.get(session_id)


def delete_history(session_id: str) -> bool:
    if session_id not in _conversations:
        return False
    del _conversations[session_id]
    return True


def resolve_confirmation(session_id: str, confirmation_id: str, approved: bool) -> bool:
    """Resolve one confirmation if and only if it belongs to *session_id*.

    The entry is removed before waking the tool task, which makes the token
    single-use even when duplicate frames arrive in the same event-loop turn.
    """
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
    # Supporting a synchronous collector is useful for lightweight consumers;
    # production WebSocket sinks return an awaitable.
    if inspect.isawaitable(result):
        await result


async def _await_confirmation(
    *,
    session_id: str,
    step_id: str,
    args: dict[str, Any],
    on_event: AgentEventSink,
) -> bool:
    confirmation_id = f"confirm-{uuid.uuid4()}"
    binding = PendingConfirmation(
        confirmation_id=confirmation_id,
        session_id=session_id,
        tool="delete_todo",
        args=dict(args),
        message="确认删除这个待办吗？此操作不可撤销。",
    )
    future: asyncio.Future[bool] = asyncio.get_running_loop().create_future()
    entry = _PendingEntry(binding=binding, future=future)
    _pending_confirmations[confirmation_id] = entry
    try:
        await _emit(
            on_event,
            {
                "type": "confirmation_required",
                "step_id": step_id,
                "message": binding.message,
                "confirmation_id": confirmation_id,
            },
        )
        return await asyncio.wait_for(future, timeout=CONFIRMATION_TIMEOUT_SECONDS)
    finally:
        # Cancellation/disconnect must not leave an approval token reusable.
        if _pending_confirmations.get(confirmation_id) is entry:
            _pending_confirmations.pop(confirmation_id, None)


def _failure_metadata(exc: Exception) -> tuple[str, bool]:
    message = str(exc).lower()
    if (
        isinstance(exc, (TimeoutError, asyncio.TimeoutError))
        or "超时" in message
        or "timeout" in message
    ):
        return "TOOL_TIMEOUT", True
    return "TOOL_ERROR", True


async def process_message(
    session_id: Optional[str],
    message: str,
    on_event: Optional[AgentEventSink] = None,
) -> tuple[str, list[dict[str, Any]], str]:
    """Run one ReAct turn and emit events around the real awaited work.

    With no event sink the return shape stays compatible with the REST API.
    Destructive deletion is never executed without an interactive approval
    channel; its result is returned to the LLM as a safe cancellation.
    """
    session_id = session_id or str(uuid.uuid4())
    existing = _conversations.get(session_id)
    messages: list[BaseMessage] = list(
        existing["messages"] if existing else [SystemMessage(content=SYSTEM_PROMPT)]
    )
    messages.append(HumanMessage(content=message))
    actions: list[dict[str, Any]] = []

    understand_started = time.monotonic()
    await _emit(
        on_event,
        {
            "type": "step_started",
            "step_id": "understand",
            "label": "理解请求",
            "started_at": _now_iso(),
        },
    )

    model = _get_graph()
    response = await model.ainvoke(messages)
    messages.append(response)
    await _emit(
        on_event,
        {
            "type": "step_completed",
            "step_id": "understand",
            "duration_ms": int((time.monotonic() - understand_started) * 1000),
        },
    )

    while isinstance(response, AIMessage) and response.tool_calls:
        tool_messages: list[ToolMessage] = []
        for tool_call in response.tool_calls:
            name = str(tool_call["name"])
            args = dict(tool_call.get("args") or {})
            tool_call_id = str(tool_call["id"])
            step_id = f"{name}-{uuid.uuid4().hex[:8]}"
            started = time.monotonic()
            await _emit(
                on_event,
                {
                    "type": "step_started",
                    "step_id": step_id,
                    "label": "调用 Todo API",
                    "tool": name,
                    "args": args,
                    "started_at": _now_iso(),
                },
            )

            tool = _tools_by_name.get(name)
            if tool is None:
                error = f"未知工具: {name}"
                actions.append({"type": name, "args": args, "error": error})
                tool_messages.append(
                    ToolMessage(content=error, tool_call_id=tool_call_id)
                )
                await _emit(
                    on_event,
                    {
                        "type": "step_failed",
                        "step_id": step_id,
                        "error_code": "UNKNOWN_TOOL",
                        "message": error,
                        "retryable": False,
                        "duration_ms": int((time.monotonic() - started) * 1000),
                    },
                )
                continue

            if name == "delete_todo":
                approved = False
                if on_event is not None:
                    try:
                        approved = await _await_confirmation(
                            session_id=session_id,
                            step_id=step_id,
                            args=args,
                            on_event=on_event,
                        )
                    except asyncio.TimeoutError:
                        error = "确认请求已超时"
                        actions.append({"type": name, "args": args, "error": error})
                        tool_messages.append(
                            ToolMessage(content=error, tool_call_id=tool_call_id)
                        )
                        await _emit(
                            on_event,
                            {
                                "type": "step_failed",
                                "step_id": step_id,
                                "error_code": "CONFIRMATION_TIMEOUT",
                                "message": error,
                                "retryable": True,
                                "duration_ms": int((time.monotonic() - started) * 1000),
                            },
                        )
                        continue
                if not approved:
                    result = {"cancelled": True}
                    actions.append({"type": name, "args": args, "result": result})
                    tool_messages.append(
                        ToolMessage(
                            content="用户取消了删除操作", tool_call_id=tool_call_id
                        )
                    )
                    await _emit(
                        on_event,
                        {
                            "type": "action_completed",
                            "step_id": step_id,
                            "action": name,
                            "result": result,
                            "duration_ms": int((time.monotonic() - started) * 1000),
                        },
                    )
                    continue

            try:
                result = await tool.ainvoke(args)
            except Exception as exc:
                error = str(exc)
                error_code, retryable = _failure_metadata(exc)
                logger.warning("Tool %s failed: %s", name, error)
                actions.append({"type": name, "args": args, "error": error})
                tool_messages.append(
                    ToolMessage(content=f"Error: {error}", tool_call_id=tool_call_id)
                )
                await _emit(
                    on_event,
                    {
                        "type": "step_failed",
                        "step_id": step_id,
                        "error_code": error_code,
                        "message": error,
                        "retryable": retryable,
                        "duration_ms": int((time.monotonic() - started) * 1000),
                    },
                )
            else:
                actions.append({"type": name, "args": args, "result": result})
                tool_messages.append(
                    ToolMessage(content=str(result), tool_call_id=tool_call_id)
                )
                await _emit(
                    on_event,
                    {
                        "type": "action_completed",
                        "step_id": step_id,
                        "action": name,
                        "result": result,
                        "duration_ms": int((time.monotonic() - started) * 1000),
                    },
                )

        messages.extend(tool_messages)
        response = await model.ainvoke(messages)
        messages.append(response)

    _conversations[session_id] = {"messages": messages}
    reply = "操作已完成"
    for item in reversed(messages):
        if isinstance(item, AIMessage) and item.content:
            reply = str(item.content)
            break
    return reply, actions, session_id
