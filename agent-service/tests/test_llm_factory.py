"""Provider registry and client construction tests."""

from __future__ import annotations

from typing import Any

import pytest
from pydantic import SecretStr

from app.llm import create_model
from app.llm import providers
from app.llm.base import ModelConfigurationError
from app.llm.config import ModelConfig
from app.llm.factory import resolve_adapter


class StubModel:
    def __init__(self) -> None:
        self.bound_tools: list[Any] | None = None

    def bind_tools(self, tools: list[Any]) -> "StubModel":
        self.bound_tools = tools
        return self


def config(
    provider: str,
    *,
    model: str,
    base_url: str | None,
) -> ModelConfig:
    return ModelConfig(
        provider=provider,
        model=model,
        api_key=SecretStr("secret-value"),
        base_url=base_url,
        temperature=0.1,
    )


def test_deepseek_uses_openai_compatible_client(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: dict[str, Any] = {}
    stub = StubModel()
    monkeypatch.setattr(
        providers,
        "ChatOpenAI",
        lambda **kwargs: captured.update(kwargs) or stub,
    )

    model = create_model(
        config(
            "deepseek",
            model="deepseek-v4-flash",
            base_url="https://api.deepseek.com",
        )
    )

    assert model is stub
    assert captured["model"] == "deepseek-v4-flash"
    assert captured["base_url"] == "https://api.deepseek.com"
    assert captured["api_key"].get_secret_value() == "secret-value"
    assert captured["temperature"] == 0.1


def test_compatible_passes_custom_endpoint(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, Any] = {}
    monkeypatch.setattr(
        providers,
        "ChatOpenAI",
        lambda **kwargs: captured.update(kwargs) or StubModel(),
    )

    create_model(
        config(
            "openai-compatible",
            model="qwen3",
            base_url="http://ollama:11434/v1",
        )
    )

    assert captured["model"] == "qwen3"
    assert captured["base_url"] == "http://ollama:11434/v1"


def test_deepseek_and_generic_compatible_have_distinct_registrations() -> None:
    deepseek = resolve_adapter("deepseek")
    generic = resolve_adapter("openai-compatible")

    assert deepseek is not generic
    assert deepseek.name == "deepseek"
    assert generic.name == "openai-compatible"


@pytest.mark.parametrize("provider", ["openai", "anthropic", "google", "gemini"])
def test_native_providers_are_registered(provider: str) -> None:
    assert resolve_adapter(provider).name in {"openai", "anthropic", "google"}


def test_openai_uses_native_client(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, Any] = {}
    monkeypatch.setattr(
        providers,
        "ChatOpenAI",
        lambda **kwargs: captured.update(kwargs) or StubModel(),
    )

    create_model(config("openai", model="gpt-4o", base_url=None))

    assert captured["model"] == "gpt-4o"
    assert captured["api_key"].get_secret_value() == "secret-value"
    assert captured["temperature"] == 0.1
    assert "base_url" not in captured


def test_anthropic_uses_native_client(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, Any] = {}
    monkeypatch.setattr(
        providers,
        "ChatAnthropic",
        lambda **kwargs: captured.update(kwargs) or StubModel(),
    )

    create_model(config("anthropic", model="claude-sonnet-4-5", base_url=None))

    assert captured["model_name"] == "claude-sonnet-4-5"
    assert captured["api_key"].get_secret_value() == "secret-value"
    assert captured["temperature"] == 0.1
    assert "base_url" not in captured


@pytest.mark.parametrize("provider", ["google", "gemini"])
def test_google_uses_native_client(
    provider: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: dict[str, Any] = {}
    monkeypatch.setattr(
        providers,
        "ChatGoogleGenerativeAI",
        lambda **kwargs: captured.update(kwargs) or StubModel(),
    )

    create_model(config(provider, model="gemini-2.5-flash", base_url=None))

    assert captured["model"] == "gemini-2.5-flash"
    assert captured["api_key"].get_secret_value() == "secret-value"
    assert captured["temperature"] == 0.1


def test_created_model_can_bind_existing_tools(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    stub = StubModel()
    monkeypatch.setattr(providers, "ChatOpenAI", lambda **_kwargs: stub)
    model = create_model(
        config(
            "deepseek",
            model="deepseek-v4-flash",
            base_url="https://api.deepseek.com",
        )
    )
    tools = [object(), object()]

    assert model.bind_tools(tools) is stub
    assert stub.bound_tools == tools


def test_unknown_registry_provider_is_safe() -> None:
    with pytest.raises(ModelConfigurationError, match="unknown") as raised:
        resolve_adapter("unknown")

    assert "secret-value" not in str(raised.value)
    assert "deepseek" in str(raised.value)
