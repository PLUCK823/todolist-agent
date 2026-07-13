"""Tests for Pydantic schemas — validation and serialization."""

from datetime import datetime

import pytest
from pydantic import ValidationError

from app.schemas import (
    ApiResponse,
    ChatRequest,
    ChatResponse,
    ConfirmationResponse,
    ConversationMessage,
    PaginatedData,
    Todo,
    TodoBase,
    TodoCreate,
    TodoUpdate,
    ToolAction,
)


class TestTodoBase:
    def test_valid_todo_base(self):
        t = TodoBase(title="买牛奶", priority="high")
        assert t.title == "买牛奶"
        assert t.priority == "high"
        assert t.description == ""
        assert t.due_date is None

    def test_default_priority(self):
        t = TodoBase(title="测试")
        assert t.priority == "medium"

    def test_empty_title_raises(self):
        with pytest.raises(ValidationError):
            TodoBase(title="")

    def test_invalid_priority(self):
        with pytest.raises(ValidationError):
            TodoBase(title="x", priority="urgent")

    def test_with_due_date(self):
        dt = datetime(2026, 7, 15, 0, 0, 0)
        t = TodoBase(title="x", due_date=dt)
        assert t.due_date == dt


class TestTodoCreate:
    def test_create(self):
        t = TodoCreate(title="新待办", priority="low", description="详细说明")
        assert t.title == "新待办"
        assert t.description == "详细说明"


class TestTodoUpdate:
    def test_partial_update(self):
        t = TodoUpdate(priority="high")
        assert t.priority == "high"
        assert t.title is None

    def test_empty_update(self):
        t = TodoUpdate()
        assert t.title is None

    def test_invalid_title(self):
        with pytest.raises(ValidationError):
            TodoUpdate(title="")


class TestTodo:
    def test_full_todo(self):
        now = datetime.now()
        t = Todo(
            id=1,
            title="买牛奶",
            priority="high",
            completed=False,
            created_at=now,
            updated_at=now,
        )
        assert t.id == 1
        assert t.completed is False


class TestApiResponse:
    def test_success(self):
        r = ApiResponse(code=0, message="ok", data={"id": 1})
        assert r.code == 0
        assert r.data == {"id": 1}

    def test_error(self):
        r = ApiResponse(code=40401, message="待办不存在")
        assert r.data is None


class TestPaginatedData:
    def test_pagination(self):
        p = PaginatedData(items=[{"id": 1}], total=1, page=1, page_size=20)
        assert p.total == 1
        assert len(p.items) == 1


class TestChatRequest:
    def test_valid(self):
        r = ChatRequest(message="你好")
        assert r.message == "你好"
        assert r.session_id is None

    def test_with_session(self):
        r = ChatRequest(message="你好", session_id="abc-123")
        assert r.session_id == "abc-123"

    def test_empty_message_raises(self):
        with pytest.raises(ValidationError):
            ChatRequest(message="")

    def test_blank_message_and_unknown_fields_raise(self):
        with pytest.raises(ValidationError):
            ChatRequest(message="   ")
        with pytest.raises(ValidationError):
            ChatRequest(message="你好", injected=True)


class TestConfirmationResponse:
    def test_valid_boolean_response(self):
        response = ConfirmationResponse(
            type="confirmation_response",
            confirmation_id="confirm-1",
            approved=False,
        )
        assert response.approved is False

    @pytest.mark.parametrize("approved", ["true", 1, None])
    def test_approval_is_strict_boolean(self, approved):
        with pytest.raises(ValidationError):
            ConfirmationResponse(
                type="confirmation_response",
                confirmation_id="confirm-1",
                approved=approved,
            )

    def test_unknown_fields_are_rejected(self):
        with pytest.raises(ValidationError):
            ConfirmationResponse(
                type="confirmation_response",
                confirmation_id="confirm-1",
                approved=True,
                session_id="not-client-controlled",
            )


class TestChatResponse:
    def test_response(self):
        r = ChatResponse(reply="已创建", session_id="sid-1", actions=[])
        data = r.model_dump()
        assert data["reply"] == "已创建"
        assert data["session_id"] == "sid-1"


class TestToolAction:
    def test_action(self):
        a = ToolAction(type="create_todo", result={"id": 1})
        d = a.model_dump()
        assert d["type"] == "create_todo"


class TestConversationMessage:
    def test_message(self):
        now = datetime.now()
        m = ConversationMessage(
            id=1,
            session_id="sid-1",
            role="human",
            content="你好",
            created_at=now,
        )
        assert m.role == "human"
