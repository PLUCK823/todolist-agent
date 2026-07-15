# 多模型 Provider 适配器设计

日期：2026-07-15  
状态：已选定方案 A，等待书面规格确认

## 1. 背景与目标

当前 Agent 服务虽然暴露了 `LLM_PROVIDER`、`LLM_API_KEY` 和 `LLM_MODEL` 等 Compose 配置，但实际模型构造只创建 `ChatOpenAI`，并读取另一组 `OPENAI_*` 环境变量。结果是配置契约与运行行为不一致，Anthropic 尚未真正接入，DeepSeek、Gemini 和其他 OpenAI 兼容服务也没有清晰的扩展边界。

本次改造采用 Provider Registry 与适配器模式，在不改变 Agent 工具执行、会话、确认、重试及流式事件协议的前提下，实现以下 Provider：

- OpenAI
- Anthropic
- Google Gemini
- DeepSeek
- 通用 OpenAI-Compatible 服务
- 仅限隔离 E2E 环境的确定性 Fake Provider

首个实际运行配置使用 DeepSeek V4 Flash。模型切换通过环境变量完成，修改配置后重启 Agent 容器生效；本阶段不增加前端模型选择器，也不把密钥发送到浏览器。

## 2. 方案选择

### 采用：内置 Provider Registry + 适配器

每个 Provider 适配器负责配置校验、默认值和 LangChain Chat Model 构造。Agent 只依赖统一工厂返回的 `BaseChatModel`，不感知供应商细节。

选择理由：

- 保留 OpenAI、Anthropic 和 Gemini 的原生客户端行为。
- DeepSeek 与其他兼容服务可复用 OpenAI 协议实现。
- 不引入额外代理服务或独立故障点。
- Provider 规则可独立测试，后续增加模型供应商不需要修改 Agent 主循环。

未采用的方案：

- 全部强制走 OpenAI-Compatible：实现较少，但会削弱 Anthropic 和 Gemini 的原生错误语义与能力适配。
- 引入 LiteLLM 网关：覆盖面广，但当前项目会增加一个运行服务、配置层和运维边界。

## 3. 模块边界

新增 `agent-service/app/llm/` 包：

```text
app/llm/
├── __init__.py
├── config.py       # 读取、规范化并校验环境配置
├── base.py         # ProviderAdapter 协议与通用异常
├── factory.py      # Provider Registry、别名解析与模型创建
└── providers.py    # 首批 Provider 适配器
```

职责划分：

- `ModelConfig`：不可变配置对象，不记录、不序列化 API Key。
- `ProviderAdapter`：声明 Provider 名称、别名、默认模型、默认 Base URL，并创建 LangChain Chat Model。
- `ModelFactory`：解析 Provider，调用对应适配器，并向 Agent 返回支持 `bind_tools()` 与 `ainvoke()` 的模型。
- `agent.py`：仅调用模型工厂；现有 Fake Provider 的安全隔离规则保持不变。

Provider 内部可以共享 OpenAI-Compatible 构造帮助函数，但 DeepSeek 仍注册为独立 Provider，以便提供官方默认 URL、模型名和未来专属参数。

## 4. 配置契约

统一环境变量：

| 变量 | 必填条件 | 说明 |
| --- | --- | --- |
| `LLM_PROVIDER` | 是 | `openai`、`anthropic`、`google`、`deepseek`、`openai-compatible`；`gemini` 作为 `google` 别名 |
| `LLM_MODEL` | 否 | 缺省时使用 Provider 默认模型 |
| `LLM_API_KEY` | 除隔离 Fake 外是 | 当前 Provider 的密钥 |
| `LLM_BASE_URL` | 通用兼容 Provider 是 | 覆盖默认 API 地址；原生 Provider 通常省略 |
| `LLM_TEMPERATURE` | 否 | 浮点数，默认 `0.1` |

Provider 默认行为：

| Provider | 默认模型 | 默认 Base URL | LangChain 客户端 |
| --- | --- | --- | --- |
| `openai` | `gpt-4o` | 官方默认 | `ChatOpenAI` |
| `anthropic` | `claude-sonnet-4-5` | 官方默认 | `ChatAnthropic` |
| `google` / `gemini` | `gemini-2.5-flash` | 官方默认 | `ChatGoogleGenerativeAI` |
| `deepseek` | `deepseek-v4-flash` | `https://api.deepseek.com` | `ChatOpenAI` 兼容模式 |
| `openai-compatible` | 无 | 无，必须显式配置 | `ChatOpenAI` 兼容模式 |

密钥优先级采用单一明确规则：运行时只读取 `LLM_API_KEY`。不再隐式读取 SDK 自带的供应商环境变量，避免容器里存在多个密钥时选错 Provider。`LLM_BASE_URL` 只在需要时传入，不用空字符串覆盖 SDK 默认值。

配置错误包括：未知 Provider、缺少密钥、通用兼容 Provider 缺少 Base URL、温度格式错误或超出 `0.0` 至 `2.0`。错误应在 Agent 服务启动阶段暴露，消息可包含变量名、Provider 和模型名，但不得包含密钥值。

## 5. Provider 行为

所有生产 Provider 必须满足相同的 Agent 能力契约：

- 支持异步 `ainvoke()`。
- 支持 `bind_tools()`。
- 能将工具调用转换为 LangChain `AIMessage.tool_calls`。
- 工具执行结果能够作为 `ToolMessage` 送回模型。

DeepSeek 使用官方 OpenAI Chat Completions 兼容端点。首版不显式开启 Strict Tool Calls Beta，也不注入 DeepSeek 专属 thinking 参数，以保持与其他 Provider 的统一行为和 LangChain 工具循环兼容。后续如需推理强度控制，应作为 Provider 能力配置单独设计，而不是向通用配置塞入供应商参数。

Fake/E2E Provider 继续要求同时满足：

- `APP_ENV=e2e`
- `ENABLE_E2E_PROVIDER=true`
- `LLM_PROVIDER=fake` 或 `e2e`

任何一个条件不满足都必须拒绝启动，防止确定性模型进入真实部署。

## 6. 数据流

```text
Compose/.env
    ↓
ModelConfig.from_env()
    ↓ 校验并规范化
Provider Registry
    ↓
ProviderAdapter.create(config)
    ↓
LangChain BaseChatModel.bind_tools(todo_tools)
    ↓
现有 Agent 会话、工具、确认、重试与流式事件循环
```

模型切换只影响模型构造边界。Todo API、数据库、Redis、WebSocket 事件结构和前端不需要感知 Provider。

## 7. 安全设计

- 真实密钥只进入根目录被 Git 忽略的 `.env`。
- `.env.example` 只保留占位符和配置说明。
- Dockerfile 不使用密钥 `ARG` 或 `ENV`，Compose 仅在运行时注入。
- 日志、异常、健康检查和测试快照不得输出配置对象的密钥字段。
- 工厂异常使用安全的自定义 `ModelConfigurationError`。
- 用户提供的现有密钥完成验收后建议轮换，因为它曾经出现在对话文本中。

## 8. 错误处理与可观测性

- 配置错误：启动失败，并给出可执行的修复提示。
- SDK 初始化错误：包装为不含密钥的 Provider 初始化错误。
- 模型请求错误：继续沿用现有 `AGENT_MODEL_ERROR` 流式失败事件与可重试语义。
- 启动日志只输出 Provider、模型和是否使用自定义 Base URL，不输出完整 URL 查询参数或任何密钥。
- `/api/agent/health` 保持轻量，不为每次健康检查调用付费模型；服务启动成功代表配置结构已通过校验，真实模型连通性由部署验收完成。

## 9. 测试策略

采用测试驱动实现，先写失败测试再添加代码。

单元测试覆盖：

- 每个 Provider 的默认模型、Base URL 和客户端类型。
- `gemini` 等别名解析。
- 显式模型、Base URL 和温度覆盖。
- 未知 Provider、缺少密钥、无效温度与通用兼容 Provider 缺 URL。
- API Key 不出现在异常、`repr` 或日志中。
- 模型对象可以绑定现有 Todo 工具。
- Fake/E2E Provider 的环境隔离不回归。
- 旧 `OPENAI_*` 配置不再悄悄覆盖统一配置。

回归验证：

- Agent 全量 pytest。
- 后端 Go 测试与前端关键烟测，确认协议没有变化。
- 隔离 Fake Provider 的真实栈 E2E 保持通过。

真实 DeepSeek 验收：

- 使用本机 `.env` 启动完整 Compose 栈。
- 校验五个服务健康。
- 通过系统 Agent 发起一次只读任务查询，确认 DeepSeek 返回工具调用并生成最终回复。
- 不在验收中创建或删除用户数据；如必须产生临时数据，则使用唯一前缀并在同一流程清理。

## 10. 文档与部署

同步更新：

- 根目录 `.env.example`
- `README.md`
- `docs/DEPLOY.md`
- `docs/WORKFLOW.md` 中当前有效的模型配置章节
- Agent 服务相关说明

部署流程：

1. 在未跟踪 `.env` 中配置 DeepSeek Provider、模型与密钥。
2. 运行 Agent 全量测试及相关回归门禁。
3. 无缓存重建 `agent`；为保证交付一致性，最终重新构建三个项目镜像。
4. 确保 PostgreSQL 和 Redis 官方镜像存在。
5. `docker compose up -d --wait` 启动五服务栈。
6. 完成健康检查和真实 DeepSeek 只读 Agent 验收。

## 11. 完成标准

- 五类生产 Provider 与隔离 Fake Provider 均可由统一配置选择。
- DeepSeek V4 Flash 使用官方模型 ID和 Base URL 成功完成一次真实工具调用。
- 所有新增及既有测试通过。
- 密钥不在 Git、镜像历史、构建日志或应用日志中出现。
- 三个项目镜像成功重建，PostgreSQL 与 Redis 镜像齐备。
- 五个容器启动并全部健康，最终保持运行。
