# Multi-Model Provider Adapters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add configuration-driven OpenAI, Anthropic, Google Gemini, DeepSeek, and generic OpenAI-compatible model adapters, then run the complete stack with DeepSeek V4 Flash without exposing its API key.

**Architecture:** A small `app.llm` package owns environment parsing, safe validation, provider registration, and LangChain client construction. The existing Agent loop receives one common chat-model interface and keeps all session, tool, confirmation, retry, and streaming behavior unchanged. Docker injects secrets only at runtime through an ignored `.env` file.

**Tech Stack:** Python 3.12, FastAPI, Pydantic v2, LangChain, `langchain-openai`, `langchain-anthropic`, `langchain-google-genai`, pytest, uv, Docker Compose.

---

## File map

- Create `agent-service/app/llm/__init__.py`: public model factory exports.
- Create `agent-service/app/llm/base.py`: safe configuration exception and adapter protocol.
- Create `agent-service/app/llm/config.py`: immutable environment configuration and validation.
- Create `agent-service/app/llm/providers.py`: concrete OpenAI, Anthropic, Google, DeepSeek, and compatible adapters.
- Create `agent-service/app/llm/factory.py`: registry, aliases, deterministic E2E delegation, and model creation.
- Create `agent-service/tests/test_llm_config.py`: configuration boundary tests.
- Create `agent-service/tests/test_llm_factory.py`: provider construction and secret-safety tests.
- Modify `agent-service/app/agent.py`: replace the hard-coded `ChatOpenAI` constructor with the factory.
- Modify `agent-service/app/main.py`: validate model configuration during service startup without making a paid request.
- Modify `agent-service/pyproject.toml` and `agent-service/uv.lock`: add Google Gemini integration.
- Modify `docker-compose.yml`, `.env.example`, `README.md`, `docs/DEPLOY.md`, and `docs/WORKFLOW.md`: publish the unified configuration contract.
- Modify local ignored `.env`: select DeepSeek V4 Flash and store the user-provided key; never stage this file.

### Task 1: Configuration model and safe validation

**Files:**
- Create: `agent-service/app/llm/base.py`
- Create: `agent-service/app/llm/config.py`
- Test: `agent-service/tests/test_llm_config.py`

- [ ] **Step 1: Write failing configuration tests**

Add tests that express the public contract:

```python
def test_deepseek_defaults(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", "deepseek")
    monkeypatch.setenv("LLM_API_KEY", "secret-value")
    config = ModelConfig.from_env()
    assert config.provider == "deepseek"
    assert config.model == "deepseek-v4-flash"
    assert config.base_url == "https://api.deepseek.com"
    assert config.temperature == 0.1


def test_compatible_requires_base_url(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", "openai-compatible")
    monkeypatch.setenv("LLM_API_KEY", "secret-value")
    monkeypatch.delenv("LLM_BASE_URL", raising=False)
    with pytest.raises(ModelConfigurationError, match="LLM_BASE_URL"):
        ModelConfig.from_env()


@pytest.mark.parametrize("value", ["not-a-number", "-0.1", "2.1"])
def test_temperature_is_bounded(monkeypatch, value):
    monkeypatch.setenv("LLM_PROVIDER", "openai")
    monkeypatch.setenv("LLM_API_KEY", "secret-value")
    monkeypatch.setenv("LLM_TEMPERATURE", value)
    with pytest.raises(ModelConfigurationError) as raised:
        ModelConfig.from_env()
    assert "secret-value" not in str(raised.value)
```

Also cover missing key, unknown provider, explicit model/base URL, `gemini` alias, and `repr(config)` secret redaction.

- [ ] **Step 2: Run the tests and verify RED**

Run:

```bash
cd agent-service
uv run --frozen --extra dev pytest -q tests/test_llm_config.py
```

Expected: collection fails because `app.llm` does not exist.

- [ ] **Step 3: Implement the minimal configuration boundary**

Define:

```python
class ModelConfigurationError(RuntimeError):
    """A safe, operator-actionable model configuration failure."""


@dataclass(frozen=True, repr=False)
class ModelConfig:
    provider: str
    model: str
    api_key: SecretStr
    base_url: str | None
    temperature: float

    @classmethod
    def from_env(cls) -> "ModelConfig":
        raw_provider = os.getenv("LLM_PROVIDER", "openai").strip().lower()
        provider = {"gemini": "google"}.get(raw_provider, raw_provider)
        defaults = {
            "openai": ("gpt-4o", None),
            "anthropic": ("claude-sonnet-4-5", None),
            "google": ("gemini-2.5-flash", None),
            "deepseek": ("deepseek-v4-flash", "https://api.deepseek.com"),
            "openai-compatible": (None, None),
        }
        if provider not in defaults:
            raise ModelConfigurationError(f"Unsupported LLM_PROVIDER: {provider}")
        default_model, default_url = defaults[provider]
        model = os.getenv("LLM_MODEL", "").strip() or default_model
        api_key = os.getenv("LLM_API_KEY", "").strip()
        base_url = os.getenv("LLM_BASE_URL", "").strip() or default_url
        if not api_key:
            raise ModelConfigurationError(f"LLM_API_KEY is required for {provider}")
        if not model:
            raise ModelConfigurationError(f"LLM_MODEL is required for {provider}")
        if provider == "openai-compatible" and not base_url:
            raise ModelConfigurationError("LLM_BASE_URL is required for openai-compatible")
        try:
            temperature = float(os.getenv("LLM_TEMPERATURE", "0.1"))
        except ValueError as exc:
            raise ModelConfigurationError("LLM_TEMPERATURE must be a number") from exc
        if not 0.0 <= temperature <= 2.0:
            raise ModelConfigurationError("LLM_TEMPERATURE must be between 0.0 and 2.0")
        return cls(provider, model, SecretStr(api_key), base_url, temperature)

    def __repr__(self) -> str:
        return (
            f"ModelConfig(provider={self.provider!r}, model={self.model!r}, "
            f"base_url={self.base_url!r}, temperature={self.temperature!r}, "
            "api_key=SecretStr('**********'))"
        )
```

Normalize `gemini` to `google`, apply the provider defaults from the approved spec, require `LLM_API_KEY` for production providers, and validate temperature in the inclusive range `0.0..2.0`. Fake/E2E configuration is delegated in Task 4 and must not require a key here.

- [ ] **Step 4: Run the tests and verify GREEN**

Run the Task 1 command. Expected: all tests in `test_llm_config.py` pass.

- [ ] **Step 5: Commit Task 1**

```bash
git add agent-service/app/llm/base.py agent-service/app/llm/config.py agent-service/tests/test_llm_config.py
git commit -m "feat(agent): validate unified model configuration"
```

### Task 2: DeepSeek and generic OpenAI-compatible adapters

**Files:**
- Create: `agent-service/app/llm/providers.py`
- Create: `agent-service/app/llm/factory.py`
- Create: `agent-service/app/llm/__init__.py`
- Test: `agent-service/tests/test_llm_factory.py`

- [ ] **Step 1: Write failing adapter tests**

Patch constructors at the module boundary and assert exact, secret-safe arguments:

```python
def test_deepseek_uses_openai_compatible_client(monkeypatch):
    captured = {}
    monkeypatch.setattr(providers, "ChatOpenAI", lambda **kwargs: captured.update(kwargs) or StubModel())
    model = create_model(ModelConfig(
        provider="deepseek",
        model="deepseek-v4-flash",
        api_key=SecretStr("secret-value"),
        base_url="https://api.deepseek.com",
        temperature=0.1,
    ))
    assert isinstance(model, StubModel)
    assert captured["model"] == "deepseek-v4-flash"
    assert captured["base_url"] == "https://api.deepseek.com"
    assert captured["api_key"].get_secret_value() == "secret-value"


def test_compatible_passes_custom_endpoint(monkeypatch):
    captured = {}
    monkeypatch.setattr(
        providers,
        "ChatOpenAI",
        lambda **kwargs: captured.update(kwargs) or StubModel(),
    )
    create_model(ModelConfig(
        provider="openai-compatible",
        model="qwen3",
        api_key=SecretStr("secret-value"),
        base_url="http://ollama:11434/v1",
        temperature=0.1,
    ))
    assert captured["base_url"] == "http://ollama:11434/v1"
```

Add a registry test showing that `deepseek` and `openai-compatible` resolve to separate adapter registrations even though both use `ChatOpenAI` internally. Add a tool-binding smoke assertion using a stub with `bind_tools()`.

- [ ] **Step 2: Run the tests and verify RED**

```bash
cd agent-service
uv run --frozen --extra dev pytest -q tests/test_llm_factory.py
```

Expected: imports fail because the factory and adapters do not exist.

- [ ] **Step 3: Implement the compatible adapter and registry**

Use this interface:

```python
class ProviderAdapter(Protocol):
    name: str
    aliases: tuple[str, ...]

    def create(self, config: ModelConfig) -> BaseChatModel:
        raise NotImplementedError


class OpenAICompatibleAdapter:
    def __init__(self, name: str, aliases: tuple[str, ...] = ()):
        self.name = name
        self.aliases = aliases

    def create(self, config: ModelConfig) -> BaseChatModel:
        return ChatOpenAI(
            model=config.model,
            api_key=config.api_key,
            base_url=config.base_url,
            temperature=config.temperature,
        )
```

Register named DeepSeek and generic compatible instances. The factory must reject an unregistered provider with `ModelConfigurationError` and list supported provider names without exposing configuration values.

- [ ] **Step 4: Run the tests and verify GREEN**

Run Task 2 tests, then Task 1 and Task 2 together. Expected: all pass.

- [ ] **Step 5: Commit Task 2**

```bash
git add agent-service/app/llm agent-service/tests/test_llm_factory.py
git commit -m "feat(agent): add DeepSeek compatible model adapter"
```

### Task 3: Native OpenAI, Anthropic, and Gemini adapters

**Files:**
- Modify: `agent-service/app/llm/providers.py`
- Modify: `agent-service/app/llm/factory.py`
- Modify: `agent-service/tests/test_llm_factory.py`
- Modify: `agent-service/pyproject.toml`
- Modify: `agent-service/uv.lock`

- [ ] **Step 1: Add the Gemini dependency through uv**

```bash
cd agent-service
uv add 'langchain-google-genai>=2.0.0'
```

Expected: `pyproject.toml` and `uv.lock` include `langchain-google-genai` and its resolved transitive dependencies. This is dependency metadata, not production behavior.

- [ ] **Step 2: Write failing native-provider tests**

For each provider, patch its native constructor and assert:

```python
def test_native_provider_uses_its_client(monkeypatch):
    calls = {"openai": [], "anthropic": [], "google": []}
    monkeypatch.setattr(
        providers,
        "ChatOpenAI",
        lambda **kwargs: calls["openai"].append(kwargs) or StubModel(),
    )
    monkeypatch.setattr(
        providers,
        "ChatAnthropic",
        lambda **kwargs: calls["anthropic"].append(kwargs) or StubModel(),
    )
    monkeypatch.setattr(
        providers,
        "ChatGoogleGenerativeAI",
        lambda **kwargs: calls["google"].append(kwargs) or StubModel(),
    )
    for provider, model in (
        ("openai", "gpt-4o"),
        ("anthropic", "claude-sonnet-4-5"),
        ("google", "gemini-2.5-flash"),
    ):
        create_model(ModelConfig(
            provider=provider,
            model=model,
            api_key=SecretStr("secret-value"),
            base_url=None,
            temperature=0.1,
        ))
    assert calls["openai"][0]["model"] == "gpt-4o"
    assert calls["anthropic"][0]["model_name"] == "claude-sonnet-4-5"
    assert calls["google"][0]["model"] == "gemini-2.5-flash"
```

Assert OpenAI receives `api_key`, Anthropic receives `api_key`, and Google receives `google_api_key`; omit `base_url` when no override exists. Verify `gemini` resolves to the registered Google adapter.

- [ ] **Step 3: Run the new tests and verify RED**

```bash
cd agent-service
uv run --frozen --extra dev pytest -q tests/test_llm_factory.py
```

Expected: native provider cases fail because only compatible adapters exist.

- [ ] **Step 4: Implement native adapters**

Add focused classes:

```python
class OpenAIAdapter:
    def create(self, config):
        kwargs = _common_kwargs(config)
        if config.base_url is not None:
            kwargs["base_url"] = config.base_url
        return ChatOpenAI(api_key=config.api_key, **kwargs)


class AnthropicAdapter:
    def create(self, config):
        kwargs = _common_kwargs(config, model_key="model_name")
        if config.base_url is not None:
            kwargs["base_url"] = config.base_url
        return ChatAnthropic(api_key=config.api_key, **kwargs)


class GoogleAdapter:
    aliases = ("gemini",)

    def create(self, config):
        return ChatGoogleGenerativeAI(
            model=config.model,
            google_api_key=config.api_key,
            temperature=config.temperature,
        )
```

Do not add provider-specific reasoning or multimodal options.

- [ ] **Step 5: Run tests and commit Task 3**

```bash
cd agent-service
uv run --frozen --extra dev pytest -q tests/test_llm_config.py tests/test_llm_factory.py
git add pyproject.toml uv.lock app/llm tests/test_llm_factory.py
git commit -m "feat(agent): add native mainstream model adapters"
```

Expected: adapter tests pass and the dependency lock is reproducible.

### Task 4: Integrate the factory into Agent startup and preserve E2E safety

**Files:**
- Modify: `agent-service/app/agent.py`
- Modify: `agent-service/app/main.py`
- Modify: `agent-service/app/llm/factory.py`
- Modify: `agent-service/tests/test_agent.py`
- Modify: `agent-service/tests/test_api.py`

- [ ] **Step 1: Write failing integration tests**

Add tests proving `_build_llm()` calls `ModelConfig.from_env()` and `create_model()`, old `OPENAI_MODEL` / `OPENAI_BASE_URL` values do not override `LLM_*`, and Fake Provider still requires both E2E guards.

Add an app startup test:

```python
def test_startup_rejects_invalid_model_configuration(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", "openai-compatible")
    monkeypatch.setenv("LLM_API_KEY", "secret-value")
    monkeypatch.delenv("LLM_BASE_URL", raising=False)
    with pytest.raises(ModelConfigurationError, match="LLM_BASE_URL"):
        validate_model_configuration()
```

- [ ] **Step 2: Run focused tests and verify RED**

```bash
cd agent-service
uv run --frozen --extra dev pytest -q \
  tests/test_agent.py -k 'build_llm or provider_environment' \
  tests/test_api.py -k 'startup or health'
```

Expected: new factory/startup assertions fail.

- [ ] **Step 3: Replace the hard-coded model constructor**

Make `_build_llm()` contain only:

```python
def _build_llm():
    provider = os.getenv("LLM_PROVIDER", "openai").strip().lower()
    if _validate_provider_environment(provider):
        return _DeterministicE2ELLM()
    return create_model(ModelConfig.from_env())
```

Expose `validate_model_configuration()` for startup. It must validate Fake/E2E guards and production configuration without performing a model request. Wire it into FastAPI lifespan or startup initialization before the service reports ready.

- [ ] **Step 4: Run Agent tests and verify GREEN**

```bash
cd agent-service
uv run --frozen --extra dev pytest -q
```

Expected: the complete Agent suite passes with no secret text in captured output.

- [ ] **Step 5: Commit Task 4**

```bash
git add agent-service/app/agent.py agent-service/app/main.py agent-service/app/llm/factory.py \
  agent-service/tests/test_agent.py agent-service/tests/test_api.py
git commit -m "refactor(agent): select models through provider registry"
```

### Task 5: Publish the configuration contract and set local DeepSeek runtime

**Files:**
- Modify: `docker-compose.yml`
- Modify: `.env.example`
- Modify: `README.md`
- Modify: `docs/DEPLOY.md`
- Modify: `docs/WORKFLOW.md`
- Modify locally only: `.env`

- [ ] **Step 1: Write a failing Compose configuration assertion**

Run before editing:

```bash
docker compose config | rg 'LLM_BASE_URL|deepseek-v4-flash'
```

Expected: no `LLM_BASE_URL` entry and the DeepSeek model is absent.

- [ ] **Step 2: Update Compose and examples**

Agent environment must become:

```yaml
LLM_PROVIDER: ${LLM_PROVIDER:-openai}
LLM_API_KEY: ${LLM_API_KEY:-}
LLM_MODEL: ${LLM_MODEL:-gpt-4o}
LLM_BASE_URL: ${LLM_BASE_URL:-}
LLM_TEMPERATURE: ${LLM_TEMPERATURE:-0.1}
```

Document all provider names, aliases, model defaults, the generic compatible requirement, and runtime-only secret injection. Remove statements claiming Anthropic works solely because its dependency exists.

- [ ] **Step 3: Configure the ignored local `.env`**

Preserve unrelated existing values. Read the already supplied key through a
non-echoing stdin prompt, then update `.env` without printing the value:

```bash
IFS= read -r -s LLM_API_KEY
export LLM_API_KEY
python - <<'PY'
import os
from pathlib import Path

path = Path(".env")
values = {}
for line in path.read_text().splitlines() if path.exists() else []:
    if line and not line.lstrip().startswith("#") and "=" in line:
        key, value = line.split("=", 1)
        values[key] = value
values.update({
    "LLM_PROVIDER": "deepseek",
    "LLM_MODEL": "deepseek-v4-flash",
    "LLM_BASE_URL": "https://api.deepseek.com",
    "LLM_API_KEY": os.environ["LLM_API_KEY"],
    "LLM_TEMPERATURE": "0.1",
})
path.write_text("".join(f"{key}={value}\n" for key, value in values.items()))
PY
```

Verify without printing the value:

```bash
git check-ignore -q .env
test -n "$(sed -n 's/^LLM_API_KEY=//p' .env)"
! git grep -F -- "$LLM_API_KEY"
unset LLM_API_KEY
```

- [ ] **Step 4: Validate docs and Compose**

```bash
docker compose config --quiet
rg -n 'openai-compatible|deepseek-v4-flash|LLM_BASE_URL' \
  .env.example README.md docs/DEPLOY.md docs/WORKFLOW.md docker-compose.yml
git diff --check
```

Expected: configuration parses, every required document describes the unified contract, and no whitespace errors exist.

- [ ] **Step 5: Commit Task 5 without `.env`**

```bash
git add docker-compose.yml .env.example README.md docs/DEPLOY.md docs/WORKFLOW.md
git commit -m "docs: configure supported model providers"
git status --short
```

Expected: `.env` does not appear in staged or untracked output.

### Task 6: Full verification, image rebuild, startup, and live DeepSeek acceptance

**Files:**
- No production file changes expected.

- [ ] **Step 1: Run the complete test matrix**

```bash
cd agent-service && uv run --frozen --extra dev pytest -q
cd ../backend && go test -count=1 ./...
cd ../frontend && pnpm lint && pnpm build && \
  pnpm exec playwright test e2e/mock/smoke.spec.ts --project=chromium
```

Expected: all commands exit zero.

- [ ] **Step 2: Rebuild all project images without cache**

```bash
cd ..
docker compose down --remove-orphans
docker compose build --no-cache frontend backend agent
docker compose pull postgres redis
```

Expected: three project images build and both infrastructure images are present. Build output must not contain the API key.

- [ ] **Step 3: Start and verify the five-service stack**

```bash
docker compose up -d --wait
docker compose ps
curl --fail --silent http://127.0.0.1:3000/ >/dev/null
curl --fail --silent http://127.0.0.1:8080/api/health
curl --fail --silent http://127.0.0.1:8000/api/agent/health
```

Expected: PostgreSQL, Redis, backend, Agent, and frontend are all healthy.

- [ ] **Step 4: Run a live read-only DeepSeek Agent acceptance**

Use the existing WebSocket/API protocol to ask “查看未完成任务”. Capture only event types, selected Provider/model metadata, tool name, and final reply; never capture headers or environment values. Assert:

```text
step_started(understand)
tool_started(list_todos)
tool_completed(list_todos)
reply
done
```

Expected: the request reaches DeepSeek V4 Flash, invokes `list_todos`, and returns a Chinese final answer without mutating Todo data.

- [ ] **Step 5: Inspect secret and runtime boundaries**

```bash
git status --short
git grep -n 'LLM_API_KEY=' -- ':!*.example' ':!docs/**'
docker history --no-trunc todolist-agent-agent:latest
docker compose logs --no-color agent | rg -v 'API_KEY|Bearer|sk-'
```

Expected: worktree clean, no committed secret assignment, no key in image history, and logs contain no credential.

- [ ] **Step 6: Commit any test-only corrections, then leave the stack running**

If verification reveals no changes, do not create an empty commit. If a test-driven correction was required, rerun the affected gate and commit only that correction. Final state must keep all five containers healthy as requested.

## Plan self-review

- Spec coverage: all supported providers, aliases, security boundaries, Fake/E2E isolation, documentation, full tests, Docker rebuild, five-service startup, and live DeepSeek tool acceptance map to Tasks 1–6.
- Placeholder scan: no implementation step contains an unresolved code or secret placeholder; ellipses occur only in valid Python variadic type syntax or the Go package wildcard.
- Type consistency: `ModelConfig`, `ModelConfigurationError`, `ProviderAdapter`, `create_model`, and `validate_model_configuration` retain the same names and responsibilities throughout.
