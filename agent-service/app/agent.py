"""LangGraph agent engine — processes natural language and calls Todo tools.

The agent uses a ReAct-style loop:
1. LLM decides which tool(s) to call (or replies directly)
2. Tools are executed against the backend API
3. Results are fed back to the LLM for a final reply
"""

from __future__ import annotations

import logging
import os
import uuid
from typing import Annotated, Any, Optional, TypedDict

from langchain_core.messages import (
    AIMessage,
    BaseMessage,
    HumanMessage,
    SystemMessage,
    ToolMessage,
)
from langchain_core.tools import BaseTool, tool as langchain_tool
from langgraph.graph import END, StateGraph
from langgraph.graph.message import add_messages

from .prompts import SYSTEM_PROMPT
from .tools import (
    complete_todo,
    create_todo,
    delete_todo,
    get_todo,
    list_todos,
    update_todo,
)

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Tool definitions (wrapped for LangChain)
# ---------------------------------------------------------------------------

_tool_defs: list[BaseTool] = [
    langchain_tool(create_todo),
    langchain_tool(list_todos),
    langchain_tool(get_todo),
    langchain_tool(update_todo),
    langchain_tool(complete_todo),
    langchain_tool(delete_todo),
]

_tools_by_name: dict[str, BaseTool] = {t.name: t for t in _tool_defs}


# ---------------------------------------------------------------------------
# State
# ---------------------------------------------------------------------------


class AgentState(TypedDict):
    messages: Annotated[list[BaseMessage], add_messages]
    actions: list[dict[str, Any]]


# ---------------------------------------------------------------------------
# LLM factory (mockable for tests)
# ---------------------------------------------------------------------------


def _build_llm():
    """Create the LLM instance.

    Uses OpenAI by default.  Override via env: ``OPENAI_API_KEY``,
    ``OPENAI_MODEL``, ``OPENAI_BASE_URL``.

    Patched in tests with ``unittest.mock.patch``.
    """
    from langchain_openai import ChatOpenAI

    return ChatOpenAI(
        model=os.getenv("OPENAI_MODEL", "gpt-4o"),
        temperature=0.2,
        base_url=os.getenv("OPENAI_BASE_URL", None),
    )


# ---------------------------------------------------------------------------
# Graph building
# ---------------------------------------------------------------------------

_compiled_graph = None


def _reset_graph():
    """Clear cached graph so the next call rebuilds with a fresh LLM."""
    global _compiled_graph
    _compiled_graph = None


def _get_graph():
    """Return the compiled LangGraph agent (lazy singleton).

    Call ``_reset_graph()`` between tests if the LLM backend changes.
    """
    global _compiled_graph
    if _compiled_graph is not None:
        return _compiled_graph

    llm = _build_llm()
    llm_with_tools = llm.bind_tools(_tool_defs)

    # ---- nodes ----------------------------------------------------------

    async def call_model(state: AgentState) -> dict:
        messages = state["messages"]
        response = await llm_with_tools.ainvoke(messages)
        return {"messages": [response]}

    async def execute_tools(state: AgentState) -> dict:
        messages = state["messages"]
        last_message = messages[-1]
        actions: list[dict[str, Any]] = []
        tool_messages: list[ToolMessage] = []

        for tc in last_message.tool_calls:
            name: str = tc["name"]
            args: dict = tc["args"]
            tcid: str = tc["id"]
            tool = _tools_by_name.get(name)

            if tool is None:
                err = f"未知工具: {name}"
                actions.append({"type": name, "error": err})
                tool_messages.append(ToolMessage(content=err, tool_call_id=tcid))
                continue

            try:
                result = await tool.ainvoke(args)
                actions.append({"type": name, "result": result})
                tool_messages.append(
                    ToolMessage(content=str(result), tool_call_id=tcid)
                )
            except Exception as exc:
                err_msg = str(exc)
                logger.warning("Tool %s failed: %s", name, err_msg)
                actions.append({"type": name, "error": err_msg})
                tool_messages.append(
                    ToolMessage(content=f"Error: {err_msg}", tool_call_id=tcid)
                )

        return {"messages": tool_messages, "actions": actions}

    def should_continue(state: AgentState) -> str:
        last_message = state["messages"][-1]
        if hasattr(last_message, "tool_calls") and last_message.tool_calls:
            return "execute_tools"
        return END  # type: ignore[return-value]

    # ---- graph ----------------------------------------------------------

    graph = StateGraph(AgentState)
    graph.add_node("agent", call_model)
    graph.add_node("execute_tools", execute_tools)
    graph.set_entry_point("agent")
    graph.add_conditional_edges(
        "agent",
        should_continue,
        {"execute_tools": "execute_tools", END: END},
    )
    graph.add_edge("execute_tools", "agent")

    _compiled_graph = graph.compile()
    return _compiled_graph


# ---------------------------------------------------------------------------
# Conversation history (in-memory)
# ---------------------------------------------------------------------------

_conversations: dict[str, dict[str, Any]] = {}


def get_history(session_id: str) -> Optional[dict]:
    """Return conversation data for *session_id* or ``None``."""
    return _conversations.get(session_id)


def delete_history(session_id: str) -> bool:
    """Delete conversation history. Returns ``True`` if it existed."""
    if session_id in _conversations:
        del _conversations[session_id]
        return True
    return False


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


async def process_message(
    session_id: Optional[str],
    message: str,
) -> tuple[str, list[dict[str, Any]], str]:
    """Process a user message through the agent.

    Parameters
    ----------
    session_id:
        Existing session to continue, or ``None`` to create a new one.
    message:
        Natural-language message from the user.

    Returns
    -------
    (reply, actions, session_id)
        *reply* — the agent's Chinese text response.
        *actions* — list of tool invocations with ``type`` and ``result``/``error``.
        *session_id* — the (possibly new) session identifier.
    """
    if session_id is None:
        session_id = str(uuid.uuid4())

    if session_id not in _conversations:
        _conversations[session_id] = {
            "messages": [SystemMessage(content=SYSTEM_PROMPT)],
        }

    conv = _conversations[session_id]
    conv["messages"].append(HumanMessage(content=message))

    graph = _get_graph()
    result = await graph.ainvoke(
        {"messages": conv["messages"], "actions": []},
        config={"configurable": {"thread_id": session_id}},
    )

    # Persist the full message history
    conv["messages"] = result["messages"]

    # Extract the final AI reply
    reply = "操作已完成"
    for m in reversed(result["messages"]):
        if isinstance(m, AIMessage) and m.content:
            reply = m.content
            break

    actions: list[dict[str, Any]] = result.get("actions", [])

    return reply, actions, session_id
