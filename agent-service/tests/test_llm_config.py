"""Unified model configuration contract."""

from __future__ import annotations

import pytest

from app.llm.base import ModelConfigurationError
from app.llm.config import ModelConfig


@pytest.fixture(autouse=True)
def clear_model_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in (
        "LLM_PROVIDER",
        "LLM_MODEL",
        "LLM_API_KEY",
        "LLM_BASE_URL",
        "LLM_TEMPERATURE",
        "OPENAI_MODEL",
        "OPENAI_BASE_URL",
        "OPENAI_API_KEY",
        "ANTHROPIC_API_KEY",
        "GOOGLE_API_KEY",
    ):
        monkeypatch.delenv(name, raising=False)


def test_deepseek_defaults(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("LLM_PROVIDER", "deepseek")
    monkeypatch.setenv("LLM_API_KEY", "secret-value")

    config = ModelConfig.from_env()

    assert config.provider == "deepseek"
    assert config.model == "deepseek-v4-flash"
    assert config.base_url == "https://api.deepseek.com"
    assert config.temperature == 0.1
    assert config.api_key.get_secret_value() == "secret-value"


@pytest.mark.parametrize(
    ("provider", "normalized", "model"),
    [
        ("openai", "openai", "gpt-4o"),
        ("anthropic", "anthropic", "claude-sonnet-4-5"),
        ("google", "google", "gemini-2.5-flash"),
        ("gemini", "google", "gemini-2.5-flash"),
    ],
)
def test_native_provider_defaults(
    monkeypatch: pytest.MonkeyPatch,
    provider: str,
    normalized: str,
    model: str,
) -> None:
    monkeypatch.setenv("LLM_PROVIDER", provider)
    monkeypatch.setenv("LLM_API_KEY", "secret-value")

    config = ModelConfig.from_env()

    assert config.provider == normalized
    assert config.model == model
    assert config.base_url is None


def test_explicit_values_override_defaults(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("LLM_PROVIDER", "deepseek")
    monkeypatch.setenv("LLM_API_KEY", "secret-value")
    monkeypatch.setenv("LLM_MODEL", "deepseek-v4-pro")
    monkeypatch.setenv("LLM_BASE_URL", "https://gateway.example/v1")
    monkeypatch.setenv("LLM_TEMPERATURE", "0.35")

    config = ModelConfig.from_env()

    assert config.model == "deepseek-v4-pro"
    assert config.base_url == "https://gateway.example/v1"
    assert config.temperature == 0.35


def test_compatible_requires_model(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("LLM_PROVIDER", "openai-compatible")
    monkeypatch.setenv("LLM_API_KEY", "secret-value")
    monkeypatch.setenv("LLM_BASE_URL", "http://ollama:11434/v1")

    with pytest.raises(ModelConfigurationError, match="LLM_MODEL"):
        ModelConfig.from_env()


def test_compatible_requires_base_url(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("LLM_PROVIDER", "openai-compatible")
    monkeypatch.setenv("LLM_API_KEY", "secret-value")
    monkeypatch.setenv("LLM_MODEL", "qwen3")

    with pytest.raises(ModelConfigurationError, match="LLM_BASE_URL"):
        ModelConfig.from_env()


def test_production_provider_requires_unified_key(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("LLM_PROVIDER", "openai")
    monkeypatch.setenv("OPENAI_API_KEY", "legacy-secret")

    with pytest.raises(ModelConfigurationError, match="LLM_API_KEY") as raised:
        ModelConfig.from_env()

    assert "legacy-secret" not in str(raised.value)


def test_unknown_provider_lists_safe_name(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("LLM_PROVIDER", "mystery")
    monkeypatch.setenv("LLM_API_KEY", "secret-value")

    with pytest.raises(ModelConfigurationError, match="mystery") as raised:
        ModelConfig.from_env()

    assert "secret-value" not in str(raised.value)


@pytest.mark.parametrize("value", ["not-a-number", "-0.1", "2.1", "nan"])
def test_temperature_is_finite_and_bounded(
    monkeypatch: pytest.MonkeyPatch, value: str
) -> None:
    monkeypatch.setenv("LLM_PROVIDER", "openai")
    monkeypatch.setenv("LLM_API_KEY", "secret-value")
    monkeypatch.setenv("LLM_TEMPERATURE", value)

    with pytest.raises(ModelConfigurationError, match="LLM_TEMPERATURE") as raised:
        ModelConfig.from_env()

    assert "secret-value" not in str(raised.value)


def test_repr_redacts_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("LLM_PROVIDER", "openai")
    monkeypatch.setenv("LLM_API_KEY", "secret-value")

    rendered = repr(ModelConfig.from_env())

    assert "secret-value" not in rendered
    assert "**********" in rendered


def test_legacy_openai_variables_do_not_override_unified_contract(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("LLM_PROVIDER", "openai")
    monkeypatch.setenv("LLM_API_KEY", "unified-secret")
    monkeypatch.setenv("OPENAI_MODEL", "legacy-model")
    monkeypatch.setenv("OPENAI_BASE_URL", "https://legacy.example/v1")

    config = ModelConfig.from_env()

    assert config.model == "gpt-4o"
    assert config.base_url is None
    assert config.api_key.get_secret_value() == "unified-secret"
