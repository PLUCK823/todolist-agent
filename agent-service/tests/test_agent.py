"""Tests for the LangGraph agent engine."""

from __future__ import annotations

from typing import Any, Sequence
from unittest.mock import patch

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
        return ChatResult(
            generations=[ChatGeneration(message=self.responses[idx])]
        )

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


@pytest.fixture(autouse=True)
def _reset_agent():
    """Reset the agent graph and conversation state before every test."""
    import app.agent

    app.agent._reset_graph()
    app.agent._conversations.clear()


# Also don't assert that all httpx mocks were consumed, because
# some test branches might not trigger every mocked backend call.
pytestmark = pytest.mark.httpx_mock(assert_all_responses_were_requested=False)


# ===================================================================
# Tests
# ===================================================================


@pytest.mark.asyncio
async def test_agent_creates_session_when_none_provided():
    """process_message with session_id=None creates a new session."""
    from app.agent import process_message, _conversations

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
            _aim(tool_calls=[_tc("create_todo", {"title": "买牛奶", "priority": "high"})]),
            _aim("已为你创建高优先级待办「买牛奶」"),
        ]
    )

    with patch("app.agent._build_llm", return_value=llm):
        reply, actions, sid = await process_message(None, "帮我创建一个高优先级的待办：买牛奶")

    assert reply == "已为你创建高优先级待办「买牛奶」"
    assert len(actions) == 1
    assert actions[0]["type"] == "create_todo"
    assert actions[0]["result"]["id"] == 42
    assert sid in _conversations


@pytest.mark.asyncio
async def test_agent_handles_multiple_tools(httpx_mock):
    """Agent can call multiple tools in a single turn."""
    from app.agent import process_message, _conversations

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
