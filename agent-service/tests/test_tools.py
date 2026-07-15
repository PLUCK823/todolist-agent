"""Tests for agent tools (backend API callers)."""

import pytest
from httpx import RequestError

from app.tools import (
    create_todo,
    list_todos,
    get_todo,
    update_todo,
    complete_todo,
    delete_todo,
    BACKEND_URL,
)


# ---------------------------------------------------------------------------
# Fake data
# ---------------------------------------------------------------------------

FAKE_TODO = {
    "id": 1,
    "title": "买牛奶",
    "description": "全脂牛奶 1L",
    "priority": "high",
    "completed": False,
    "due_date": "2026-07-15T00:00:00Z",
    "created_at": "2026-07-13T10:30:00Z",
    "updated_at": "2026-07-13T10:30:00Z",
}


def _ok(data):
    return {"code": 0, "message": "ok", "data": data}


def _err(code, msg):
    return {"code": code, "message": msg, "data": None}


# ===================================================================
# create_todo
# ===================================================================


@pytest.mark.asyncio
async def test_create_todo_success(httpx_mock):
    httpx_mock.add_response(
        url=f"{BACKEND_URL}/todos",
        method="POST",
        json=_ok(FAKE_TODO),
        status_code=201,
    )

    result = await create_todo(title="买牛奶", priority="high", description="全脂牛奶 1L")

    assert result["id"] == 1
    assert result["title"] == "买牛奶"
    assert result["priority"] == "high"

    # Verify the request body was sent correctly
    req = httpx_mock.get_request()
    body = req.content.decode()
    assert "买牛奶" in body
    assert "high" in body


@pytest.mark.asyncio
async def test_create_todo_default_priority(httpx_mock):
    httpx_mock.add_response(
        url=f"{BACKEND_URL}/todos",
        method="POST",
        json=_ok({**FAKE_TODO, "priority": "medium"}),
        status_code=201,
    )

    result = await create_todo(title="随便")

    assert result["priority"] == "medium"


@pytest.mark.asyncio
async def test_create_todo_backend_error(httpx_mock):
    httpx_mock.add_response(
        url=f"{BACKEND_URL}/todos",
        method="POST",
        json=_err(40001, "待办标题不能为空"),
        status_code=400,
    )

    with pytest.raises(ValueError, match="待办标题不能为空"):
        await create_todo(title="")


@pytest.mark.asyncio
async def test_create_todo_backend_unreachable(httpx_mock):
    httpx_mock.add_exception(
        RequestError("Connection refused"),
        url=f"{BACKEND_URL}/todos",
        method="POST",
    )

    with pytest.raises(ConnectionError, match="无法连接到后端"):
        await create_todo(title="测试")


# ===================================================================
# list_todos
# ===================================================================


@pytest.mark.asyncio
async def test_list_todos_success(httpx_mock):
    data = {"items": [FAKE_TODO], "total": 1, "page": 1, "page_size": 20}
    # list_todos() sends page_size=20 by default
    httpx_mock.add_response(
        url=f"{BACKEND_URL}/todos?page_size=20",
        method="GET",
        json=_ok(data),
    )

    result = await list_todos()

    assert len(result["items"]) == 1
    assert result["total"] == 1


@pytest.mark.asyncio
async def test_list_todos_with_filters(httpx_mock):
    httpx_mock.add_response(
        url=f"{BACKEND_URL}/todos?page_size=10&priority=high&completed=false",
        method="GET",
        json=_ok({"items": [], "total": 0, "page": 1, "page_size": 10}),
    )

    result = await list_todos(priority="high", completed=False, limit=10)
    assert result["total"] == 0


@pytest.mark.asyncio
async def test_list_todos_empty(httpx_mock):
    httpx_mock.add_response(
        url=f"{BACKEND_URL}/todos?page_size=20",
        method="GET",
        json=_ok({"items": [], "total": 0, "page": 1, "page_size": 20}),
    )

    result = await list_todos()
    assert result["items"] == []


@pytest.mark.asyncio
async def test_list_todos_backend_error(httpx_mock):
    httpx_mock.add_response(
        url=f"{BACKEND_URL}/todos?page_size=20",
        method="GET",
        json=_err(50001, "服务器内部错误"),
        status_code=500,
    )

    with pytest.raises(ValueError, match="服务器内部错误"):
        await list_todos()


# ===================================================================
# get_todo
# ===================================================================


@pytest.mark.asyncio
async def test_get_todo_success(httpx_mock):
    httpx_mock.add_response(
        url=f"{BACKEND_URL}/todos/1",
        method="GET",
        json=_ok(FAKE_TODO),
    )

    result = await get_todo(todo_id=1)
    assert result["id"] == 1
    assert result["title"] == "买牛奶"


@pytest.mark.asyncio
async def test_get_todo_not_found(httpx_mock):
    httpx_mock.add_response(
        url=f"{BACKEND_URL}/todos/999",
        method="GET",
        json=_err(40401, "待办不存在"),
        status_code=404,
    )

    with pytest.raises(ValueError, match="待办不存在"):
        await get_todo(todo_id=999)


# ===================================================================
# update_todo
# ===================================================================


@pytest.mark.asyncio
async def test_update_todo_success(httpx_mock):
    updated = {**FAKE_TODO, "title": "买酸奶", "priority": "low"}
    httpx_mock.add_response(
        url=f"{BACKEND_URL}/todos/1",
        method="PUT",
        json=_ok(updated),
    )

    result = await update_todo(todo_id=1, title="买酸奶", priority="low")
    assert result["title"] == "买酸奶"
    assert result["priority"] == "low"


@pytest.mark.asyncio
async def test_update_todo_partial(httpx_mock):
    """Only send the fields that are provided (exclude None)."""
    updated = {**FAKE_TODO, "priority": "high"}
    httpx_mock.add_response(
        url=f"{BACKEND_URL}/todos/1",
        method="PUT",
        json=_ok(updated),
    )

    result = await update_todo(todo_id=1, priority="high")

    # Verify only priority was in the request body
    req = httpx_mock.get_request()
    body = req.content.decode()
    assert "high" in body
    assert "title" not in body


# ===================================================================
# complete_todo
# ===================================================================


@pytest.mark.asyncio
async def test_complete_todo_success(httpx_mock):
    completed = {**FAKE_TODO, "completed": True}
    httpx_mock.add_response(
        url=f"{BACKEND_URL}/todos/1/complete",
        method="PATCH",
        json=_ok(completed),
    )

    result = await complete_todo(todo_id=1)
    assert result["completed"] is True


@pytest.mark.asyncio
async def test_complete_todo_not_found(httpx_mock):
    httpx_mock.add_response(
        url=f"{BACKEND_URL}/todos/999/complete",
        method="PATCH",
        json=_err(40401, "待办不存在"),
        status_code=404,
    )

    with pytest.raises(ValueError, match="待办不存在"):
        await complete_todo(todo_id=999)


# ===================================================================
# delete_todo
# ===================================================================


@pytest.mark.asyncio
async def test_delete_todo_success(httpx_mock):
    httpx_mock.add_response(
        url=f"{BACKEND_URL}/todos/1",
        method="DELETE",
        status_code=204,
    )

    result = await delete_todo(todo_id=1)
    assert result["deleted"] is True
    assert result["id"] == 1


@pytest.mark.asyncio
async def test_delete_todo_not_found(httpx_mock):
    httpx_mock.add_response(
        url=f"{BACKEND_URL}/todos/999",
        method="DELETE",
        json=_err(40401, "待办不存在"),
        status_code=404,
    )

    with pytest.raises(ValueError, match="待办不存在"):
        await delete_todo(todo_id=999)


# ===================================================================
# Timeout handling
# ===================================================================


@pytest.mark.asyncio
async def test_tool_timeout(httpx_mock):
    import httpx

    httpx_mock.add_exception(
        httpx.TimeoutException("timeout"),
        url=f"{BACKEND_URL}/todos?page_size=20",
        method="GET",
    )

    with pytest.raises(ConnectionError, match="后端服务响应超时"):
        await list_todos()
