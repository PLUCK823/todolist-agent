"""Tests for the LangGraph agent engine."""

from __future__ import annotations

import asyncio
import time
from typing import Any, Sequence
from unittest.mock import AsyncMock, patch

import pytest

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AIMessage, BaseMessage
from langchain_core.outputs import ChatGeneration, ChatResult


# ---------------------------------------------------------------------------
# Fake tool-calling LLM
# ---------------------------------------------------------------------------


class FakeToolCallingLLM(BaseChatModel):
    """Returns predetermined AIMessages — including tool_calls.

    Each call consumes one response from ``responses`` (wraps around).
    """

    responses: list[AIMessage] = []
    _call_count: int = 0

    def _generate(
        self,
        messages: list[BaseMessage],
        stop: Sequence[str] | None = None,
        run_manager: Any = None,
        **kwargs: Any,
    ) -> ChatResult:
        idx = self._call_count % len(self.responses)
        self._call_count += 1
        return ChatResult(generations=[ChatGeneration(message=self.responses[idx])])

    def bind_tools(
        self,
        tools: Sequence[Any],
        **kwargs: Any,
    ) -> "FakeToolCallingLLM":
        return self

    @property
    def _llm_type(self) -> str:
        return "fake-tool-calling"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _tc(name: str, args: dict, call_id: str = "1") -> dict:
    """Shortcut to build a tool_call dict."""
    return {"name": name, "args": args, "id": call_id, "type": "tool_call"}


def _aim(content: str = "", tool_calls: list | None = None) -> AIMessage:
    return AIMessage(content=content, tool_calls=tool_calls or [])


class StubTool:
    """Complete test double for the single tool boundary Agent consumes."""

    def __init__(self, *, result: Any = None, side_effect: Any = None):
        self.ainvoke = AsyncMock(return_value=result, side_effect=side_effect)


@pytest.fixture(autouse=True)
def _reset_agent():
    """Reset the agent graph and conversation state before every test."""
    import app.agent

    app.agent._reset_graph()
    app.agent._conversations.clear()
    app.agent._session_locks.clear()
    app.agent._session_slots.clear()
    app.agent._session_generations.clear()
    app.agent._active_tasks.clear()
    pending = getattr(app.agent, "_pending_confirmations", None)
    if pending is not None:
        pending.clear()


# Also don't assert that all httpx mocks were consumed, because
# some test branches might not trigger every mocked backend call.
pytestmark = pytest.mark.httpx_mock(assert_all_responses_were_requested=False)


# ===================================================================
# Tests
# ===================================================================


@pytest.mark.asyncio
async def test_agent_creates_session_when_none_provided():
    """process_message with session_id=None creates a new session."""
    from app.agent import _conversations, process_message

    llm = FakeToolCallingLLM(responses=[_aim("你好！有什么可以帮你的？")])

    with patch("app.agent._build_llm", return_value=llm):
        reply, actions, sid = await process_message(None, "你好")

    assert isinstance(sid, str) and len(sid) > 0
    assert reply == "你好！有什么可以帮你的？"
    assert actions == []
    assert sid in _conversations


@pytest.mark.asyncio
async def test_agent_reuses_session():
    """Messages in the same session accumulate history."""
    from app.agent import process_message, _conversations

    llm = FakeToolCallingLLM(
        responses=[
            _aim("你好！有什么可以帮你的？"),
            _aim("当然可以！"),
        ]
    )

    with patch("app.agent._build_llm", return_value=llm):
        _, _, sid = await process_message(None, "你好")
        reply2, _, sid2 = await process_message(sid, "帮我创建待办")

    assert sid == sid2
    assert reply2 == "当然可以！"
    # History: system + human + ai + human + ai = 5
    hist = _conversations[sid]["messages"]
    assert len(hist) == 5


@pytest.mark.asyncio
async def test_agent_routes_to_create_todo(httpx_mock):
    """Agent calls create_todo when the LLM returns a tool_call."""
    from app.agent import process_message, _conversations

    httpx_mock.add_response(
        url="http://localhost:8080/api/todos",
        method="POST",
        json={
            "code": 0,
            "message": "ok",
            "data": {
                "id": 42,
                "title": "买牛奶",
                "priority": "high",
                "description": "",
                "completed": False,
                "due_date": None,
                "created_at": "2026-07-13T10:30:00Z",
                "updated_at": "2026-07-13T10:30:00Z",
            },
        },
        status_code=201,
    )

    llm = FakeToolCallingLLM(
        responses=[
            _aim(
                tool_calls=[_tc("create_todo", {"title": "买牛奶", "priority": "high"})]
            ),
            _aim("已为你创建高优先级待办「买牛奶」"),
        ]
    )

    with patch("app.agent._build_llm", return_value=llm):
        reply, actions, sid = await process_message(
            None, "帮我创建一个高优先级的待办：买牛奶"
        )

    assert reply == "已为你创建高优先级待办「买牛奶」"
    assert len(actions) == 1
    assert actions[0]["type"] == "create_todo"
    assert actions[0]["result"]["id"] == 42
    assert sid in _conversations


@pytest.mark.asyncio
async def test_agent_handles_multiple_tools(httpx_mock):
    """Agent can call multiple tools in a single turn."""
    from app.agent import process_message

    httpx_mock.add_response(
        url="http://localhost:8080/api/todos",
        method="POST",
        json={
            "code": 0,
            "message": "ok",
            "data": {
                "id": 1,
                "title": "买牛奶",
                "priority": "high",
                "description": "",
                "completed": False,
                "due_date": None,
                "created_at": "2026-07-13T10:30:00Z",
                "updated_at": "2026-07-13T10:30:00Z",
            },
        },
        status_code=201,
    )
    httpx_mock.add_response(
        url="http://localhost:8080/api/todos",
        method="POST",
        json={
            "code": 0,
            "message": "ok",
            "data": {
                "id": 2,
                "title": "买面包",
                "priority": "medium",
                "description": "",
                "completed": False,
                "due_date": None,
                "created_at": "2026-07-13T10:31:00Z",
                "updated_at": "2026-07-13T10:31:00Z",
            },
        },
        status_code=201,
    )

    llm = FakeToolCallingLLM(
        responses=[
            _aim(
                tool_calls=[
                    _tc("create_todo", {"title": "买牛奶", "priority": "high"}, "1"),
                    _tc("create_todo", {"title": "买面包"}, "2"),
                ]
            ),
            _aim("已为你创建两个待办：买牛奶（高优先级）和买面包"),
        ]
    )

    with patch("app.agent._build_llm", return_value=llm):
        reply, actions, _ = await process_message(None, "创建两个待办")

    assert len(actions) == 2
    assert {a["result"]["title"] for a in actions} == {"买牛奶", "买面包"}


@pytest.mark.asyncio
async def test_agent_handles_no_tool_needed():
    """When the user just chats, no tools are called."""
    from app.agent import process_message

    llm = FakeToolCallingLLM(
        responses=[_aim("你好，我是待办管理助手，有什么可以帮你的？")]
    )

    with patch("app.agent._build_llm", return_value=llm):
        reply, actions, _ = await process_message(None, "你好")

    assert actions == []
    assert "你好" in reply


@pytest.mark.asyncio
async def test_agent_handles_list_todos(httpx_mock):
    """Agent calls list_todos when the LLM requests it."""
    from app.agent import process_message

    httpx_mock.add_response(
        url="http://localhost:8080/api/todos?page_size=20",
        method="GET",
        json={
            "code": 0,
            "message": "ok",
            "data": {
                "items": [
                    {
                        "id": 1,
                        "title": "买牛奶",
                        "priority": "high",
                        "completed": False,
                        "description": "",
                        "due_date": None,
                        "created_at": "2026-07-13T10:30:00Z",
                        "updated_at": "2026-07-13T10:30:00Z",
                    }
                ],
                "total": 1,
                "page": 1,
                "page_size": 20,
            },
        },
    )

    llm = FakeToolCallingLLM(
        responses=[
            _aim(tool_calls=[_tc("list_todos", {})]),
            _aim("你目前有 1 个待办：买牛奶（高优先级，未完成）"),
        ]
    )

    with patch("app.agent._build_llm", return_value=llm):
        reply, actions, _ = await process_message(None, "查看所有待办")

    assert len(actions) == 1
    assert actions[0]["type"] == "list_todos"


@pytest.mark.asyncio
async def test_agent_tool_error_graceful(httpx_mock):
    """When a tool raises an error, the agent includes the error in context."""
    from app.agent import process_message

    httpx_mock.add_response(
        url="http://localhost:8080/api/todos/999",
        method="GET",
        json={"code": 40401, "message": "待办不存在", "data": None},
        status_code=404,
    )

    llm = FakeToolCallingLLM(
        responses=[
            _aim(tool_calls=[_tc("get_todo", {"todo_id": 999})]),
            _aim("抱歉，找不到 ID 为 999 的待办事项。"),
        ]
    )

    with patch("app.agent._build_llm", return_value=llm):
        reply, actions, _ = await process_message(None, "查看待办 999")

    assert len(actions) == 1
    assert "error" in actions[0]


@pytest.mark.asyncio
async def test_agent_emits_tool_started_before_tool_finishes():
    """A slow backend call is bracketed by live progress events."""
    from app.agent import _tools_by_name, process_message

    release_tool = asyncio.Event()
    tool_started = asyncio.Event()
    events: list[dict[str, Any]] = []

    async def slow_create(_args):
        await release_tool.wait()
        return {"id": 42, "title": "慢请求"}

    async def record_event(event: dict[str, Any]) -> None:
        events.append(event)
        if event.get("type") == "step_started" and event.get("tool") == "create_todo":
            tool_started.set()

    llm = FakeToolCallingLLM(
        responses=[
            _aim(tool_calls=[_tc("create_todo", {"title": "慢请求"})]),
            _aim("已创建"),
        ]
    )

    slow_tool = StubTool(side_effect=slow_create)
    with (
        patch("app.agent._build_llm", return_value=llm),
        patch.dict(_tools_by_name, {"create_todo": slow_tool}),
    ):
        task = asyncio.create_task(
            process_message("slow-session", "创建任务", record_event)
        )
        await asyncio.wait_for(tool_started.wait(), timeout=1)
        assert [event["type"] for event in events] == [
            "step_started",
            "step_completed",
            "step_started",
        ]
        release_tool.set()
        await task

    assert events[3]["type"] == "action_completed"
    assert events[3]["action"] == "create_todo"


@pytest.mark.asyncio
async def test_delete_rejection_never_calls_backend():
    """Rejecting a destructive action resumes the agent without deleting."""
    from app.agent import (
        _pending_confirmations,
        _tools_by_name,
        process_message,
        resolve_confirmation,
    )

    confirmation_ready = asyncio.Event()
    events: list[dict[str, Any]] = []

    async def record_event(event: dict[str, Any]) -> None:
        events.append(event)
        if event["type"] == "confirmation_required":
            confirmation_ready.set()

    llm = FakeToolCallingLLM(
        responses=[
            _aim(tool_calls=[_tc("delete_todo", {"todo_id": 9})]),
            _aim("已取消删除"),
        ]
    )

    delete_tool = StubTool()
    with (
        patch("app.agent._build_llm", return_value=llm),
        patch.dict(_tools_by_name, {"delete_todo": delete_tool}),
    ):
        task = asyncio.create_task(
            process_message("delete-session", "删除 9", record_event)
        )
        await asyncio.wait_for(confirmation_ready.wait(), timeout=1)
        confirmation = next(
            event for event in events if event["type"] == "confirmation_required"
        )
        assert (
            resolve_confirmation(
                "delete-session", confirmation["confirmation_id"], approved=False
            )
            is True
        )
        reply, actions, _ = await task

    delete_tool.ainvoke.assert_not_awaited()
    assert reply == "已取消删除"
    assert actions == [
        {
            "type": "delete_todo",
            "args": {"todo_id": 9},
            "result": {"cancelled": True},
        }
    ]
    assert _pending_confirmations == {}


@pytest.mark.asyncio
async def test_delete_confirmation_is_bound_to_session_and_consumed_once():
    """A confirmation cannot cross sessions or execute a tool twice."""
    from app.agent import (
        _pending_confirmations,
        _tools_by_name,
        process_message,
        resolve_confirmation,
    )

    confirmation_ready = asyncio.Event()
    events: list[dict[str, Any]] = []

    async def record_event(event: dict[str, Any]) -> None:
        events.append(event)
        if event["type"] == "confirmation_required":
            confirmation_ready.set()

    llm = FakeToolCallingLLM(
        responses=[
            _aim(tool_calls=[_tc("delete_todo", {"todo_id": 11})]),
            _aim("已删除"),
        ]
    )
    delete_result = {"deleted": True, "id": 11}

    delete_tool = StubTool(result=delete_result)
    with (
        patch("app.agent._build_llm", return_value=llm),
        patch.dict(_tools_by_name, {"delete_todo": delete_tool}),
    ):
        task = asyncio.create_task(
            process_message("owner-session", "删除 11", record_event)
        )
        await asyncio.wait_for(confirmation_ready.wait(), timeout=1)
        confirmation = next(
            event for event in events if event["type"] == "confirmation_required"
        )
        confirmation_id = confirmation["confirmation_id"]
        assert (
            resolve_confirmation("other-session", confirmation_id, approved=True)
            is False
        )
        assert (
            resolve_confirmation("owner-session", confirmation_id, approved=True)
            is True
        )
        assert (
            resolve_confirmation("owner-session", confirmation_id, approved=True)
            is False
        )
        await task

    delete_tool.ainvoke.assert_awaited_once_with({"todo_id": 11})
    assert _pending_confirmations == {}


@pytest.mark.asyncio
async def test_backend_timeout_is_not_falsely_marked_safe_to_retry():
    """The protocol has no idempotency key, so tool retries are user-controlled."""
    from app.agent import _tools_by_name, process_message

    events: list[dict[str, Any]] = []
    llm = FakeToolCallingLLM(
        responses=[
            _aim(tool_calls=[_tc("get_todo", {"todo_id": 3})]),
            _aim("稍后重试"),
        ]
    )

    timeout_tool = StubTool(side_effect=ConnectionError("后端服务响应超时，请稍后重试"))
    with (
        patch("app.agent._build_llm", return_value=llm),
        patch.dict(_tools_by_name, {"get_todo": timeout_tool}),
    ):
        await process_message("timeout-session", "查看 3", events.append)

    failure = next(event for event in events if event["type"] == "step_failed")
    assert failure["error_code"] == "TOOL_TIMEOUT"
    assert failure["retryable"] is False


@pytest.mark.asyncio
async def test_cancelling_process_message_cancels_running_tool():
    """Disconnect cancellation propagates into an in-flight backend operation."""
    from app.agent import _tools_by_name, process_message

    entered_tool = asyncio.Event()
    cancelled_tool = asyncio.Event()

    async def blocking_tool(_args):
        entered_tool.set()
        try:
            await asyncio.Future()
        except asyncio.CancelledError:
            cancelled_tool.set()
            raise

    llm = FakeToolCallingLLM(
        responses=[_aim(tool_calls=[_tc("create_todo", {"title": "不会完成"})])]
    )
    blocking_stub = StubTool(side_effect=blocking_tool)
    with (
        patch("app.agent._build_llm", return_value=llm),
        patch.dict(_tools_by_name, {"create_todo": blocking_stub}),
    ):
        task = asyncio.create_task(
            process_message("cancel-session", "创建", AsyncMock())
        )
        await asyncio.wait_for(entered_tool.wait(), timeout=1)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

    await asyncio.wait_for(cancelled_tool.wait(), timeout=1)


@pytest.mark.asyncio
async def test_agent_accumulates_actions_across_multiple_tool_rounds():
    """Actions from an earlier ReAct round are not overwritten by later rounds."""
    from app.agent import _tools_by_name, process_message

    llm = FakeToolCallingLLM(
        responses=[
            _aim(tool_calls=[_tc("create_todo", {"title": "第一步"}, "create")]),
            _aim(tool_calls=[_tc("complete_todo", {"todo_id": 1}, "complete")]),
            _aim("两步都完成"),
        ]
    )
    create = StubTool(result={"id": 1, "title": "第一步"})
    complete = StubTool(result={"id": 1, "completed": True})
    with (
        patch("app.agent._build_llm", return_value=llm),
        patch.dict(
            _tools_by_name,
            {"create_todo": create, "complete_todo": complete},
        ),
    ):
        reply, actions, _ = await process_message("multi-round", "创建后完成")

    assert reply == "两步都完成"
    assert [action["type"] for action in actions] == ["create_todo", "complete_todo"]


@pytest.mark.asyncio
async def test_rest_compatible_call_without_sink_safely_cancels_delete():
    """The two-argument API returns normally but never deletes unconfirmed data."""
    from app.agent import _tools_by_name, process_message

    llm = FakeToolCallingLLM(
        responses=[
            _aim(tool_calls=[_tc("delete_todo", {"todo_id": 12})]),
            _aim("需要在流式会话中确认"),
        ]
    )
    delete = StubTool(result={"deleted": True, "id": 12})
    with (
        patch("app.agent._build_llm", return_value=llm),
        patch.dict(_tools_by_name, {"delete_todo": delete}),
    ):
        reply, actions, session_id = await process_message(None, "删除 12")

    delete.ainvoke.assert_not_awaited()
    assert reply == "需要在流式会话中确认"
    assert actions[0]["result"] == {"cancelled": True}
    assert session_id


@pytest.mark.asyncio
async def test_failed_turn_does_not_partially_persist_conversation():
    """A failed LLM call leaves the last successful history unchanged."""
    from app.agent import _conversations, process_message

    class FailSecondCallLLM(FakeToolCallingLLM):
        def _generate(self, messages, stop=None, run_manager=None, **kwargs):
            if self._call_count == 1:
                raise RuntimeError("LLM unavailable")
            return super()._generate(messages, stop, run_manager, **kwargs)

    llm = FailSecondCallLLM(responses=[_aim("第一轮成功")])
    with patch("app.agent._build_llm", return_value=llm):
        await process_message("atomic-history", "第一轮")
        before = list(_conversations["atomic-history"]["messages"])
        with pytest.raises(RuntimeError, match="LLM unavailable"):
            await process_message("atomic-history", "失败的一轮")

    assert _conversations["atomic-history"]["messages"] == before


@pytest.mark.asyncio
async def test_confirmation_timeout_cleans_registry_and_does_not_delete():
    """An abandoned confirmation expires without leaking or mutating data."""
    from app.agent import _pending_confirmations, _tools_by_name, process_message

    events: list[dict[str, Any]] = []
    llm = FakeToolCallingLLM(
        responses=[
            _aim(tool_calls=[_tc("delete_todo", {"todo_id": 13})]),
            _aim("确认已超时"),
        ]
    )
    delete = StubTool(result={"deleted": True, "id": 13})
    with (
        patch("app.agent._build_llm", return_value=llm),
        patch.dict(_tools_by_name, {"delete_todo": delete}),
        patch("app.agent.CONFIRMATION_TIMEOUT_SECONDS", 0.001),
    ):
        await process_message("timeout-confirm", "删除 13", events.append)

    delete.ainvoke.assert_not_awaited()
    assert _pending_confirmations == {}
    failure = next(event for event in events if event["type"] == "step_failed")
    assert failure["error_code"] == "CONFIRMATION_TIMEOUT"


@pytest.mark.asyncio
async def test_confirmation_sink_exception_cleans_registry():
    """A failed WebSocket send cannot leave a reusable confirmation token."""
    from app.agent import _pending_confirmations, process_message

    async def disconnected_sink(event: dict[str, Any]) -> None:
        if event["type"] == "confirmation_required":
            raise RuntimeError("socket closed")

    llm = FakeToolCallingLLM(
        responses=[_aim(tool_calls=[_tc("delete_todo", {"todo_id": 21})])]
    )
    with patch("app.agent._build_llm", return_value=llm):
        with pytest.raises(RuntimeError, match="socket closed"):
            await process_message("sink-failed", "删除 21", disconnected_sink)

    assert _pending_confirmations == {}


@pytest.mark.asyncio
async def test_cancelling_while_confirmation_pending_cleans_registry():
    """A disconnect while waiting for approval invalidates the token."""
    from app.agent import _pending_confirmations, process_message

    confirmation_ready = asyncio.Event()

    async def record_event(event: dict[str, Any]) -> None:
        if event["type"] == "confirmation_required":
            confirmation_ready.set()

    llm = FakeToolCallingLLM(
        responses=[_aim(tool_calls=[_tc("delete_todo", {"todo_id": 22})])]
    )
    with patch("app.agent._build_llm", return_value=llm):
        task = asyncio.create_task(
            process_message("cancel-confirm", "删除 22", record_event)
        )
        await asyncio.wait_for(confirmation_ready.wait(), timeout=1)
        assert len(_pending_confirmations) == 1
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

    assert _pending_confirmations == {}


@pytest.mark.asyncio
async def test_one_turn_can_complete_multiple_one_time_confirmations():
    """Each destructive tool call gets a fresh token in the same session."""
    from app.agent import (
        _pending_confirmations,
        _tools_by_name,
        process_message,
        resolve_confirmation,
    )

    confirmation_ids: list[str] = []

    async def approve_each(event: dict[str, Any]) -> None:
        if event["type"] == "confirmation_required":
            confirmation_ids.append(event["confirmation_id"])
            assert resolve_confirmation(
                "multi-confirm", event["confirmation_id"], approved=True
            )

    llm = FakeToolCallingLLM(
        responses=[
            _aim(
                tool_calls=[
                    _tc("delete_todo", {"todo_id": 30}, "delete-30"),
                    _tc("delete_todo", {"todo_id": 31}, "delete-31"),
                ]
            ),
            _aim("已删除两个待办"),
        ]
    )
    delete = StubTool(
        side_effect=[
            {"deleted": True, "id": 30},
            {"deleted": True, "id": 31},
        ]
    )
    with (
        patch("app.agent._build_llm", return_value=llm),
        patch.dict(_tools_by_name, {"delete_todo": delete}),
    ):
        _reply, actions, _sid = await process_message(
            "multi-confirm", "删除两个待办", approve_each
        )

    assert len(set(confirmation_ids)) == 2
    assert [action["args"]["todo_id"] for action in actions] == [30, 31]
    assert delete.ainvoke.await_count == 2
    assert _pending_confirmations == {}


@pytest.mark.asyncio
async def test_retry_resumes_after_tool_success_without_repeating_side_effect():
    """A failed final LLM call reuses the durable tool journal on retry."""
    from app.agent import _conversations, _tools_by_name, process_message

    class ScriptedModel:
        def __init__(self):
            self.ainvoke = AsyncMock(
                side_effect=[
                    _aim(
                        tool_calls=[
                            _tc("create_todo", {"title": "只创建一次"}, "stable-call")
                        ]
                    ),
                    RuntimeError("final model failed"),
                    _aim("恢复成功"),
                ]
            )

        def bind_tools(self, _tools):
            return self

    model = ScriptedModel()
    create = StubTool(result={"id": 88, "title": "只创建一次"})
    first_events: list[dict[str, Any]] = []
    with (
        patch("app.agent._build_llm", return_value=model),
        patch.dict(_tools_by_name, {"create_todo": create}),
    ):
        with pytest.raises(RuntimeError, match="final model failed"):
            await process_message("recoverable", "创建一次", first_events.append)
        incomplete = _conversations["recoverable"]["incomplete"]
        assert incomplete["actions"][0]["result"]["id"] == 88

        reply, actions, _ = await process_message("recoverable", "创建一次")

    create.ainvoke.assert_awaited_once_with({"title": "只创建一次"})
    assert reply == "恢复成功"
    assert actions[0]["result"]["id"] == 88
    failure = next(event for event in first_events if event["type"] == "step_failed")
    assert failure["step_id"] == "respond"


@pytest.mark.asyncio
async def test_retry_after_action_event_send_failure_reuses_journaled_side_effect():
    from app.agent import _tools_by_name, process_message

    model = FakeToolCallingLLM(
        responses=[
            _aim(tool_calls=[_tc("create_todo", {"title": "已写入"}, "send-call")]),
            _aim("恢复回复"),
        ]
    )
    create = StubTool(result={"id": 89, "title": "已写入"})

    async def fail_after_action(event: dict[str, Any]) -> None:
        if event["type"] == "action_completed":
            raise RuntimeError("socket send failed")

    with (
        patch("app.agent._build_llm", return_value=model),
        patch.dict(_tools_by_name, {"create_todo": create}),
    ):
        with pytest.raises(RuntimeError, match="socket send failed"):
            await process_message("send-resume", "创建", fail_after_action)
        reply, actions, _ = await process_message("send-resume", "创建")

    create.ainvoke.assert_awaited_once_with({"title": "已写入"})
    assert reply == "恢复回复"
    assert actions[0]["result"]["id"] == 89


@pytest.mark.asyncio
async def test_stream_turn_stays_recoverable_until_reply_delivery_is_acked():
    """A failed final reply send can replay the result without replaying tools."""
    from app.agent import _conversations, _tools_by_name, process_message

    model = FakeToolCallingLLM(
        responses=[
            _aim(tool_calls=[_tc("create_todo", {"title": "待交付"}, "delivery")]),
            _aim("最终回复"),
        ]
    )
    create = StubTool(result={"id": 90})

    async def collect(_event):
        pass

    with (
        patch("app.agent._build_llm", return_value=model),
        patch.dict(_tools_by_name, {"create_todo": create}),
    ):
        await process_message("delivery-session", "创建", collect)
        assert (
            _conversations["delivery-session"]["incomplete"]["phase"] == "ready_reply"
        )
        reply, actions, _ = await process_message("delivery-session", "创建")

    create.ainvoke.assert_awaited_once()
    assert reply == "最终回复"
    assert actions[0]["result"]["id"] == 90
    assert _conversations["delivery-session"]["incomplete"] is None


@pytest.mark.asyncio
async def test_same_session_turns_are_serial_but_different_sessions_run_in_parallel():
    """Session gates prevent lost updates without globally serializing the service."""
    from app.agent import _conversations, process_message

    active = 0
    max_active = 0
    first_entered = asyncio.Event()
    release = asyncio.Event()

    class CoordinatedModel:
        def bind_tools(self, _tools):
            return self

        async def ainvoke(self, _messages):
            nonlocal active, max_active
            active += 1
            max_active = max(max_active, active)
            first_entered.set()
            await release.wait()
            active -= 1
            return _aim("完成")

    with patch("app.agent._build_llm", return_value=CoordinatedModel()):
        first = asyncio.create_task(process_message("same", "第一条"))
        await first_entered.wait()
        second = asyncio.create_task(process_message("same", "第二条"))
        other = asyncio.create_task(process_message("other", "并行条目"))
        await asyncio.sleep(0)
        assert max_active == 2
        release.set()
        await asyncio.gather(first, second, other)

    assert max_active == 2
    same_contents = [message.content for message in _conversations["same"]["messages"]]
    assert "第一条" in same_contents
    assert "第二条" in same_contents


@pytest.mark.asyncio
async def test_tool_call_limit_stops_execution_with_stable_diagnostic():
    """Runaway tool plans stop before an unbounded number of side effects."""
    from app.agent import _conversations, _tools_by_name, process_message

    events: list[dict[str, Any]] = []
    llm = FakeToolCallingLLM(
        responses=[
            _aim(
                tool_calls=[
                    _tc("create_todo", {"title": "允许"}, "one"),
                    _tc("create_todo", {"title": "禁止"}, "two"),
                ]
            )
        ]
    )
    create = StubTool(result={"id": 1})
    with (
        patch("app.agent._build_llm", return_value=llm),
        patch.dict(_tools_by_name, {"create_todo": create}),
        patch("app.agent.MAX_TOOL_CALLS", 1),
    ):
        with pytest.raises(Exception, match="Agent execution limit exceeded"):
            await process_message("limited", "循环", events.append)

    create.ainvoke.assert_awaited_once()
    failure = next(event for event in events if event["type"] == "step_failed")
    assert failure["error_code"] == "AGENT_LIMIT_EXCEEDED"
    assert failure["retryable"] is False
    assert (
        _conversations["limited"]["incomplete"]["error_code"] == "AGENT_LIMIT_EXCEEDED"
    )


@pytest.mark.parametrize(
    "error,retryable",
    [
        (ConnectionError("无法连接到后端服务"), False),
        (TimeoutError("timeout"), False),
        (ValueError("待办不存在"), False),
        (ValueError("参数校验失败"), False),
        (RuntimeError("permanent failure"), False),
    ],
)
def test_tool_failure_retryability_is_classified(error, retryable):
    from app.agent import _failure_metadata

    assert _failure_metadata(error)[1] is retryable


def test_capacity_evicts_only_safe_idle_completed_session():
    from app.agent import (
        _conversations,
        _ensure_capacity,
        _session_slots,
        _SessionSlot,
    )

    _conversations.update(
        {
            "safe": {
                "messages": [],
                "incomplete": None,
                "updated_at": time.monotonic(),
            },
            "unsafe": {
                "messages": [],
                "incomplete": {"phase": "executing_tools"},
                "updated_at": time.monotonic(),
            },
        }
    )
    _session_slots["safe"] = _SessionSlot(lock=asyncio.Lock())
    _session_slots["unsafe"] = _SessionSlot(lock=asyncio.Lock())

    with patch("app.agent.MAX_SESSIONS", 2):
        _ensure_capacity("new")

    assert "safe" not in _conversations
    assert "unsafe" in _conversations


def test_capacity_rejects_when_every_session_is_unsafe():
    from app.agent import AgentCapacityExceeded, _conversations, _ensure_capacity

    _conversations["unsafe"] = {
        "messages": [],
        "incomplete": {"phase": "executing_tools"},
        "updated_at": 0.0,
    }
    with patch("app.agent.MAX_SESSIONS", 1):
        with pytest.raises(AgentCapacityExceeded):
            _ensure_capacity("new")


@pytest.mark.asyncio
async def test_storage_limits_evict_lru_and_expired_sessions_with_pending_state():
    """Bounded storage removes old sessions and their confirmation entries."""
    from app.agent import (
        _PendingEntry,
        _conversations,
        _pending_confirmations,
        _prune_sessions,
        _session_locks,
    )
    from app.schemas import PendingConfirmation

    _conversations.update(
        {
            "expired": {"messages": [], "updated_at": 0.0},
            "old": {"messages": [], "updated_at": 90.0},
            "recent": {"messages": [], "updated_at": 99.0},
        }
    )
    _session_locks.update({key: asyncio.Lock() for key in _conversations})
    pending_future = asyncio.get_running_loop().create_future()
    _pending_confirmations["expired-confirmation"] = _PendingEntry(
        binding=PendingConfirmation(
            confirmation_id="expired-confirmation",
            session_id="expired",
            tool="delete_todo",
            args={"todo_id": 1},
            message="confirm",
        ),
        future=pending_future,
    )
    with (
        patch("app.agent.SESSION_TTL_SECONDS", 50),
        patch("app.agent.MAX_SESSIONS", 1),
    ):
        _prune_sessions(now=100.0)

    assert list(_conversations) == ["recent"]
    assert set(_session_locks) == {"recent"}
    assert _pending_confirmations == {}
    assert pending_future.cancelled()


@pytest.mark.asyncio
async def test_delete_tombstone_prevents_noncooperative_inflight_turn_resurrection():
    """A cancelled turn that finishes late cannot recreate deleted history."""
    from app.agent import (
        SessionDeletedError,
        _conversations,
        _tools_by_name,
        delete_history,
        process_message,
    )

    entered = asyncio.Event()
    release = asyncio.Event()

    async def late_tool(_args):
        entered.set()
        try:
            await asyncio.Future()
        except asyncio.CancelledError:
            await release.wait()
            return {"id": 55}

    llm = FakeToolCallingLLM(
        responses=[
            _aim(tool_calls=[_tc("create_todo", {"title": "晚到"}, "late")]),
            _aim("完成"),
        ]
    )
    tool = StubTool(side_effect=late_tool)
    with (
        patch("app.agent._build_llm", return_value=llm),
        patch.dict(_tools_by_name, {"create_todo": tool}),
    ):
        turn = asyncio.create_task(process_message("delete-race", "创建"))
        await entered.wait()
        assert await delete_history("delete-race") is True
        assert "delete-race" not in _conversations
        release.set()
        with pytest.raises(SessionDeletedError):
            await turn

    assert "delete-race" not in _conversations


@pytest.mark.asyncio
async def test_tool_round_limit_stops_before_next_round_side_effect():
    from app.agent import _tools_by_name, process_message

    events: list[dict[str, Any]] = []
    llm = FakeToolCallingLLM(
        responses=[
            _aim(tool_calls=[_tc("create_todo", {"title": "一次"}, "one")]),
            _aim(tool_calls=[_tc("create_todo", {"title": "二次"}, "two")]),
        ]
    )
    create = StubTool(result={"id": 1})
    with (
        patch("app.agent._build_llm", return_value=llm),
        patch.dict(_tools_by_name, {"create_todo": create}),
        patch("app.agent.MAX_TOOL_ROUNDS", 1),
    ):
        with pytest.raises(Exception, match="Agent execution limit exceeded"):
            await process_message("round-limit", "循环", events.append)

    create.ainvoke.assert_awaited_once()
    assert any(event.get("error_code") == "AGENT_LIMIT_EXCEEDED" for event in events)


def test_message_budget_keeps_system_and_recent_context():
    from app.agent import _trim_messages
    from langchain_core.messages import HumanMessage, SystemMessage

    messages = [SystemMessage(content="system")] + [
        HumanMessage(content=str(index)) for index in range(10)
    ]
    with patch("app.agent.MAX_MESSAGES_PER_SESSION", 4):
        trimmed = _trim_messages(messages)

    assert len(trimmed) == 4
    assert trimmed[0].content == "system"
    assert [message.content for message in trimmed[1:]] == ["7", "8", "9"]


@pytest.mark.asyncio
async def test_turn_identity_rejects_stale_ack_and_allows_same_text_new_turn():
    from app.agent import complete_turn, process_message

    llm = FakeToolCallingLLM(responses=[_aim("A"), _aim("B")])

    async def sink(_event):
        pass

    with patch("app.agent._build_llm", return_value=llm):
        first = await process_message("turn-session", "相同文本", sink)
        replay = await process_message("turn-session", "相同文本", sink)
        assert replay.turn_id == first.turn_id
        assert (
            await complete_turn("turn-session", "stale-turn", first.generation) is False
        )
        assert (
            await complete_turn("turn-session", first.turn_id, first.generation) is True
        )
        assert (
            await complete_turn("turn-session", first.turn_id, first.generation)
            is False
        )
        second = await process_message("turn-session", "相同文本", sink)

    assert second.turn_id != first.turn_id


@pytest.mark.asyncio
async def test_ack_loses_to_delete_tombstone():
    from app.agent import complete_turn, delete_history, process_message

    async def sink(_event):
        pass

    llm = FakeToolCallingLLM(responses=[_aim("ready")])
    with patch("app.agent._build_llm", return_value=llm):
        result = await process_message("ack-delete", "内容", sink)
        await delete_history("ack-delete")
        assert (
            await complete_turn("ack-delete", result.turn_id, result.generation)
            is False
        )


@pytest.mark.asyncio
async def test_delete_invalidates_active_and_all_old_epoch_waiters_then_new_epoch_runs():
    from app.agent import SessionDeletedError, delete_history, process_message

    entered = asyncio.Event()

    class BlockingThenReady:
        def __init__(self):
            self.calls = 0

        def bind_tools(self, _tools):
            return self

        async def ainvoke(self, _messages):
            self.calls += 1
            if self.calls == 1:
                entered.set()
                await asyncio.Future()
            return _aim("new epoch")

    model = BlockingThenReady()
    with patch("app.agent._build_llm", return_value=model):
        active = asyncio.create_task(process_message("epoch", "active"))
        await entered.wait()
        queued = [
            asyncio.create_task(process_message("epoch", f"queued-{index}"))
            for index in range(3)
        ]
        await asyncio.sleep(0)
        assert await delete_history("epoch") is True
        with pytest.raises(asyncio.CancelledError):
            await active
        for waiter in queued:
            with pytest.raises(SessionDeletedError):
                await waiter
        fresh = await process_message("epoch", "fresh")

    assert fresh.reply == "new epoch"
    assert model.calls == 2


@pytest.mark.asyncio
async def test_new_epoch_fails_fast_while_deleted_active_task_keeps_draining():
    from app.agent import SessionDeletedError, delete_history, process_message

    entered = asyncio.Event()
    cleanup = asyncio.Event()

    class NeverReleasesWithoutTestCleanup:
        def bind_tools(self, _tools):
            return self

        async def ainvoke(self, _messages):
            entered.set()
            try:
                await asyncio.Future()
            except asyncio.CancelledError:
                await cleanup.wait()
                raise

    active = None
    with patch("app.agent._build_llm", return_value=NeverReleasesWithoutTestCleanup()):
        try:
            active = asyncio.create_task(process_message("draining", "old"))
            await entered.wait()
            assert await delete_history("draining") is True
            with pytest.raises(SessionDeletedError, match="draining"):
                await asyncio.wait_for(process_message("draining", "new"), timeout=0.02)
        finally:
            cleanup.set()
            if active is not None:
                with pytest.raises(asyncio.CancelledError):
                    await active


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "fault_type,tool_fails",
    [
        ("step_started", False),
        ("step_completed", False),
        ("action_completed", False),
        ("step_failed", True),
    ],
)
async def test_event_checkpoint_faults_replay_stably_without_repeating_tools(
    fault_type, tool_fails
):
    """Table-driven fault injection at every non-confirmation event boundary."""
    from app.agent import _tools_by_name, process_message

    llm = FakeToolCallingLLM(
        responses=[
            _aim(tool_calls=[_tc("create_todo", {"title": "checkpoint"}, "cp")]),
            _aim("done"),
        ]
    )
    tool = StubTool(
        result={"id": 1},
        side_effect=ValueError("permanent") if tool_fails else None,
    )
    failed_event = None

    async def fault_sink(event):
        nonlocal failed_event
        matches = event["type"] == fault_type
        if fault_type == "step_started":
            matches = matches and event["step_id"] == "understand"
        if matches and failed_event is None:
            failed_event = dict(event)
            raise RuntimeError(f"fault at {fault_type}")

    replayed: list[dict[str, Any]] = []
    with (
        patch("app.agent._build_llm", return_value=llm),
        patch.dict(_tools_by_name, {"create_todo": tool}),
    ):
        with pytest.raises(RuntimeError, match="fault at"):
            await process_message("fault-session", "执行", fault_sink)
        await process_message("fault-session", "执行", replayed.append)

    assert failed_event in replayed
    assert tool.ainvoke.await_count == 1


@pytest.mark.asyncio
async def test_confirmation_event_fault_replays_same_id_then_executes_once():
    from app.agent import _tools_by_name, process_message, resolve_confirmation

    llm = FakeToolCallingLLM(
        responses=[
            _aim(tool_calls=[_tc("delete_todo", {"todo_id": 41}, "delete-cp")]),
            _aim("deleted"),
        ]
    )
    delete = StubTool(result={"deleted": True, "id": 41})
    first_confirmation = None

    async def fail_confirmation(event):
        nonlocal first_confirmation
        if event["type"] == "confirmation_required":
            first_confirmation = dict(event)
            raise RuntimeError("confirmation send failed")

    replayed: list[dict[str, Any]] = []

    async def approve_replay(event):
        replayed.append(event)
        if event["type"] == "confirmation_required":
            assert resolve_confirmation(
                "confirmation-cp", event["confirmation_id"], True
            )

    with (
        patch("app.agent._build_llm", return_value=llm),
        patch.dict(_tools_by_name, {"delete_todo": delete}),
    ):
        with pytest.raises(RuntimeError, match="confirmation send failed"):
            await process_message("confirmation-cp", "删除", fail_confirmation)
        await process_message("confirmation-cp", "删除", approve_replay)

    assert first_confirmation in replayed
    delete.ainvoke.assert_awaited_once()
