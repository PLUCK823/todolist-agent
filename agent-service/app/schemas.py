"""Pydantic schemas for Agent TodoList agent service."""

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


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
    message: str = Field(..., min_length=1)
    session_id: Optional[str] = None


class ToolAction(BaseModel):
    type: str
    result: Optional[dict] = None


class ChatResponse(BaseModel):
    reply: str
    session_id: str
    actions: list[ToolAction] = []


# === Conversation schemas ===

class ConversationMessage(BaseModel):
    id: int
    session_id: str
    role: str
    content: str
    metadata: dict = {}
    created_at: datetime
