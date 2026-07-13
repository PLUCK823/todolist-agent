"""Tests for the LangGraph agent engine."""

from __future__ import annotations

import asyncio
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
async def test_backend_timeout_emits_retryable_step_failed():
    """Backend timeouts expose a retryable, structured tool failure."""
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
    assert failure["retryable"] is True


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
