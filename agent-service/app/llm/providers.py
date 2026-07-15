"""Concrete model provider adapters."""

from __future__ import annotations

from dataclasses import dataclass

from langchain_anthropic import ChatAnthropic
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_openai import ChatOpenAI

from .config import ModelConfig


@dataclass(frozen=True)
class OpenAICompatibleAdapter:
    """Construct a chat model exposed through an OpenAI-compatible endpoint."""

    name: str
    aliases: tuple[str, ...] = ()

    def create(self, config: ModelConfig) -> BaseChatModel:
        kwargs = dict(
            model=config.model,
            api_key=config.api_key,
            temperature=config.temperature,
        )
        if config.base_url is not None:
            kwargs["base_url"] = config.base_url
        return ChatOpenAI(**kwargs)


@dataclass(frozen=True)
class AnthropicAdapter:
    """Construct Anthropic's native LangChain chat client."""

    name: str = "anthropic"
    aliases: tuple[str, ...] = ()

    def create(self, config: ModelConfig) -> BaseChatModel:
        kwargs = dict(
            model_name=config.model,
            api_key=config.api_key,
            temperature=config.temperature,
        )
        if config.base_url is not None:
            kwargs["base_url"] = config.base_url
        return ChatAnthropic(**kwargs)


@dataclass(frozen=True)
class GoogleAdapter:
    """Construct Google's native Gemini LangChain chat client."""

    name: str = "google"
    aliases: tuple[str, ...] = ("gemini",)

    def create(self, config: ModelConfig) -> BaseChatModel:
        return ChatGoogleGenerativeAI(
            model=config.model,
            api_key=config.api_key,
            temperature=config.temperature,
        )


DEEPSEEK_ADAPTER = OpenAICompatibleAdapter(name="deepseek")
OPENAI_COMPATIBLE_ADAPTER = OpenAICompatibleAdapter(name="openai-compatible")
OPENAI_ADAPTER = OpenAICompatibleAdapter(name="openai")
ANTHROPIC_ADAPTER = AnthropicAdapter()
GOOGLE_ADAPTER = GoogleAdapter()
