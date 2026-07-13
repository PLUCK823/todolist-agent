"""Pydantic schemas for Agent TodoList agent service."""

from datetime import datetime
from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator


# === Todo schemas (mirror backend responses) ===


class TodoBase(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    description: str = ""
    priority: str = Field("medium", pattern=r"^(high|medium|low)$")
    due_date: Optional[datetime] = None


class TodoCreate(TodoBase):
    pass


class TodoUpdate(BaseModel):
    title: Optional[str] = Field(None, min_length=1, max_length=200)
    description: Optional[str] = None
    priority: Optional[str] = Field(None, pattern=r"^(high|medium|low)$")
    due_date: Optional[datetime] = None


class Todo(TodoBase):
    id: int
    completed: bool = False
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# === API response schemas ===


class ApiResponse(BaseModel):
    code: int
    message: str
    data: Optional[object] = None


class PaginatedData(BaseModel):
    items: list
    total: int
    page: int
    page_size: int


# === Agent chat schemas ===


class ChatRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    message: str = Field(..., min_length=1, max_length=10_000)
    session_id: Optional[str] = Field(None, min_length=1, max_length=128)

    @field_validator("message")
    @classmethod
    def message_must_not_be_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("message must not be blank")
        return value


class ToolAction(BaseModel):
    type: str
    result: Optional[dict] = None


class ChatResponse(BaseModel):
    reply: str
    session_id: str
    actions: list[ToolAction] = Field(default_factory=list)


class ConfirmationResponse(BaseModel):
    """Validated destructive-action response received from a client."""

    model_config = ConfigDict(extra="forbid", strict=True)

    type: Literal["confirmation_response"]
    confirmation_id: str = Field(min_length=1, max_length=128)
    approved: bool


class PendingConfirmation(BaseModel):
    """Immutable identity binding for one pending destructive tool call."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    confirmation_id: str
    session_id: str
    tool: str
    args: dict[str, Any]
    message: str


# === Conversation schemas ===


class ConversationMessage(BaseModel):
    id: int
    session_id: str
    role: str
    content: str
    metadata: dict = Field(default_factory=dict)
    created_at: datetime
