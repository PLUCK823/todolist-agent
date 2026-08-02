"""Agent tools — async functions that call the backend Todo CRUD API.

Each tool wraps a backend endpoint. They are used by the LangGraph agent
to interact with the user's todo list. Every tool has a detailed Chinese
docstring so the LLM can correctly infer when and how to use it.
"""

from __future__ import annotations

import os
from contextlib import contextmanager
from contextvars import ContextVar
from typing import Any, Literal, Optional

import httpx

BACKEND_URL = os.getenv("BACKEND_URL", "http://localhost:8080/api")
BACKEND_ACCESS_COOKIE = os.getenv("AUTH_ACCESS_COOKIE", "todolist_access")
_backend_auth: ContextVar[tuple[str, str] | None] = ContextVar("backend_auth", default=None)


@contextmanager
def backend_auth_context(access_token: str, origin: str):
    token = _backend_auth.set((access_token, origin))
    try:
        yield
    finally:
        _backend_auth.reset(token)


# ---------------------------------------------------------------------------
# Internal HTTP helper
# ---------------------------------------------------------------------------

async def _request(
    method: str,
    path: str,
    *,
    json_body: Optional[dict] = None,
    params: Optional[dict] = None,
) -> dict:
    """Make an HTTP request to the backend and return the ``data`` portion.

    Raises
    ------
    ValueError
        If the backend returns a non-zero error code (including 4xx/5xx).
    ConnectionError
        If the backend is unreachable or times out.
    """
    url = f"{BACKEND_URL}{path}"
    delegated = _backend_auth.get()
    headers = {"Origin": delegated[1]} if delegated else None
    cookies = {BACKEND_ACCESS_COOKIE: delegated[0]} if delegated else None
    try:
        async with httpx.AsyncClient(timeout=30.0, cookies=cookies) as client:
            resp = await client.request(
                method, url, json=json_body, params=params, headers=headers
            )

            # DELETE returns 204 with no body — success
            if resp.status_code == 204:
                return {}

            # 4xx / 5xx — extract backend error message if possible
            if resp.status_code >= 400:
                msg = f"后端返回错误: HTTP {resp.status_code}"
                try:
                    body = resp.json()
                    backend_msg = body.get("message")
                    if backend_msg:
                        msg = backend_msg
                except Exception:
                    pass
                raise ValueError(msg)

            # 2xx with body — check the envelope code
            body = resp.json()
            if body.get("code") != 0:
                raise ValueError(body.get("message", "后端返回未知错误"))
            return body.get("data", {})

    except httpx.TimeoutException:
        raise ConnectionError("后端服务响应超时，请稍后重试")
    except httpx.RequestError as exc:
        raise ConnectionError(f"无法连接到后端服务: {exc}")
    except ValueError:
        raise  # re-raise our own ValueError, not httpx's


# ---------------------------------------------------------------------------
# Tool functions
# ---------------------------------------------------------------------------


async def create_todo(
    title: str,
    priority: str = "medium",
    description: str = "",
    due_date: str = "",
) -> dict:
    """创建新的待办事项。

    当用户想添加一个新的待办任务时使用此工具。

    Args:
        title: 待办标题，必填，1-200 字符。例如 "买牛奶"
        priority: 优先级，可选值 high / medium / low，默认 medium
        description: 详细描述，可选
        due_date: 截止日期，RFC 3339 格式字符串，例如 "2026-07-15T00:00:00Z"，可选

    Returns:
        创建成功的待办对象字典，包含 id、title、priority 等字段
    """
    body: dict[str, Any] = {"title": title, "priority": priority}
    if description:
        body["description"] = description
    if due_date:
        body["due_date"] = due_date

    return await _request("POST", "/todos", json_body=body)


async def list_todos(
    priority: Optional[str] = None,
    completed: Optional[bool] = None,
    limit: int = 20,
) -> dict:
    """查询待办事项列表。

    当用户想查看、浏览或搜索待办事项时使用此工具。
    支持按优先级和完成状态筛选。

    Args:
        priority: 按优先级筛选，可选值 high / medium / low，不传则返回所有优先级
        completed: 按完成状态筛选，True 只返回已完成的，False 只返回未完成的，不传则返回所有
        limit: 返回条数上限，默认 20，最大 100

    Returns:
        包含 items 列表和 total 总数的字典
    """
    params: dict[str, Any] = {"page_size": min(limit, 100)}
    if priority:
        params["priority"] = priority
    if completed is not None:
        params["completed"] = str(completed).lower()

    return await _request("GET", "/todos", params=params)


async def get_todo(todo_id: int) -> dict:
    """获取单个待办事项的详细信息。

    当用户想查看某个特定待办的详情时使用此工具。

    Args:
        todo_id: 待办事项的唯一 ID，必填

    Returns:
        待办对象字典，包含 id、title、priority、completed、description、due_date 等
    """
    return await _request("GET", f"/todos/{todo_id}")


async def update_todo(
    todo_id: int,
    title: Optional[str] = None,
    priority: Optional[str] = None,
    description: Optional[str] = None,
    due_date: Optional[str] = None,
) -> dict:
    """更新待办事项的属性。

    当用户想修改已有待办的标题、优先级、描述或截止日期时使用此工具。
    只传需要修改的字段，未传的字段保持不变。

    Args:
        todo_id: 待办事项的唯一 ID，必填
        title: 新的待办标题，可选
        priority: 新的优先级，可选值 high / medium / low，可选
        description: 新的详细描述，可选
        due_date: 新的截止日期，RFC 3339 格式，可选

    Returns:
        更新后的完整待办对象字典
    """
    body: dict[str, Any] = {}
    if title is not None:
        body["title"] = title
    if priority is not None:
        body["priority"] = priority
    if description is not None:
        body["description"] = description
    if due_date is not None:
        body["due_date"] = due_date

    return await _request("PUT", f"/todos/{todo_id}", json_body=body)


async def complete_todo(todo_id: int) -> dict:
    """将待办事项标记为已完成。

    当用户说"完成"、"做完了"、"搞定"等表示完成某个任务时使用此工具。

    Args:
        todo_id: 待办事项的唯一 ID，必填

    Returns:
        标记完成后的待办对象字典，completed 字段为 True
    """
    return await _request("PATCH", f"/todos/{todo_id}/complete")


async def delete_todo(todo_id: int) -> dict:
    """删除待办事项。

    当用户想删除某个待办时使用此工具。
    注意：删除操作不可逆，使用前应确认用户意图。

    Args:
        todo_id: 待办事项的唯一 ID，必填

    Returns:
        包含 deleted 和 id 的字典
    """
    await _request("DELETE", f"/todos/{todo_id}")
    return {"deleted": True, "id": todo_id}


def _validate_batch(items: list[Any], *, ids: Optional[list[int]] = None) -> None:
    if not 1 <= len(items) <= 100:
        raise ValueError("批量操作必须包含 1 到 100 个项目")
    if ids is not None:
        if any(todo_id <= 0 for todo_id in ids) or len(set(ids)) != len(ids):
            raise ValueError("批量操作的 ID 必须为不重复的正整数")


async def batch_create_todos(items: list[dict[str, Any]]) -> dict:
    """一次原子创建 1 到 100 个待办；任一项目无效时全部不创建。"""
    _validate_batch(items)
    return await _request("POST", "/todos/batch", json_body={"items": items})


async def batch_get_todos(ids: list[int]) -> dict:
    """一次按给定 ID 顺序查询 1 到 100 个待办。"""
    _validate_batch(ids, ids=ids)
    return await _request("POST", "/todos/batch/get", json_body={"ids": ids})


async def batch_update_todos(items: list[dict[str, Any]]) -> dict:
    """一次原子更新 1 到 100 个待办，每个项目可提供不同字段。"""
    ids = [int(item.get("id", 0)) for item in items]
    _validate_batch(items, ids=ids)
    return await _request("PUT", "/todos/batch", json_body={"items": items})


async def batch_set_todo_status(ids: list[int], completed: bool) -> dict:
    """一次原子将 1 到 100 个待办设为完成或未完成。"""
    _validate_batch(ids, ids=ids)
    return await _request(
        "PATCH", "/todos/batch/status", json_body={"ids": ids, "completed": completed}
    )


async def batch_delete_todos(ids: list[int]) -> dict:
    """一次原子删除 1 到 100 个待办；此不可逆操作必须先获得用户确认。"""
    _validate_batch(ids, ids=ids)
    return await _request("DELETE", "/todos/batch", json_body={"ids": ids})
