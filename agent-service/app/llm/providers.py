"""Concrete model provider adapters."""

from __future__ import annotations

from dataclasses import dataclass

from langchain_core.language_models.chat_models import BaseChatModel
from langchain_openai import ChatOpenAI

from .config import ModelConfig


@dataclass(frozen=True)
class OpenAICompatibleAdapter:
    """Construct a chat model exposed through an OpenAI-compatible endpoint."""

    name: str
    aliases: tuple[str, ...] = ()

    def create(self, config: ModelConfig) -> BaseChatModel:
        return ChatOpenAI(
            model=config.model,
            api_key=config.api_key,
            base_url=config.base_url,
            temperature=config.temperature,
        )


DEEPSEEK_ADAPTER = OpenAICompatibleAdapter(name="deepseek")
OPENAI_COMPATIBLE_ADAPTER = OpenAICompatibleAdapter(name="openai-compatible")
