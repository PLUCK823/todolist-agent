# Agent TodoList 代码编写工作流程

## 文档信息

| 项目 | 内容 |
| ------ | ------ |
| 对应架构版本 | 简化版 v1.0 |
| 适用阶段 | 开发 → 测试 → 部署 |
| 创建日期 | 2026-07-13 |

---

## 目录

- [1. 环境搭建](#1-环境搭建)
- [2. 项目结构](#2-项目结构)
- [3. 日常开发流程](#3-日常开发流程)
- [4. 后端开发工作流](#4-后端开发工作流)
- [5. 前端开发工作流](#5-前端开发工作流)
- [6. Agent 开发工作流](#6-agent-开发工作流)
- [7. 联调与测试工作流](#7-联调与测试工作流)
- [8. 代码审查规范](#8-代码审查规范)
- [9. 部署工作流](#9-部署工作流)
- [10. 常见问题排查](#10-常见问题排查)

---

## 1. 环境搭建

### 1.1 必备工具

| 工具 | 版本要求 | 用途 |
| ------ | ------ | ------ |
| Go | ≥ 1.21 | 后端开发 |
| Python | ≥ 3.10 | Agent 服务开发 |
| uv | ≥ 0.6.x | Python 包管理 |
| Node.js | ≥ 18.x | 前端开发 |
| pnpm | ≥ 8.x | 前端包管理 |
| Docker | ≥ 24.x | 容器化运行 |
| Docker Compose | ≥ 2.x | 本地服务编排 |
| Git | ≥ 2.x | 版本管理 |
| VS Code | 最新版 | 推荐 IDE |

### 1.2 一键启动开发环境

```bash
# 1. 克隆仓库
git clone <repo-url> agent-todolist
cd agent-todolist

# 2. 启动所有依赖服务（PostgreSQL, Redis）
docker-compose up -d postgres redis

# 3. 分别在三个终端启动服务（详见各模块章节）
```

### 1.3 环境变量配置

```bash
# .env 文件（项目根目录，不要提交到 Git）
# === 数据库 ===
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_USER=todolist
POSTGRES_PASSWORD=todolist123
POSTGRES_DB=todolist

# === Redis ===
REDIS_HOST=localhost
REDIS_PORT=6379

# === Agent 服务 ===
AGENT_SERVICE_URL=http://localhost:8000
LLM_API_KEY=sk-xxxxxxxx         # OpenAI / Anthropic API Key
LLM_MODEL=gpt-4o                # 或 claude-sonnet-5

# === 后端服务 ===
BACKEND_PORT=8080
```

---

## 2. 项目结构

```text
agent-todolist/
├── frontend/                    # React + TypeScript 前端
│   ├── src/
│   │   ├── components/          # 可复用 UI 组件
│   │   │   ├── todo/            # 待办相关组件
│   │   │   ├── chat/            # Agent 聊天组件
│   │   │   └── common/          # 通用组件（按钮、输入框等）
│   │   ├── pages/               # 页面级组件
│   │   │   ├── TodoPage.tsx     # 传统待办页面
│   │   │   └── ChatPage.tsx     # Agent 聊天页面
│   │   ├── hooks/               # 自定义 Hooks
│   │   │   ├── useTodos.ts      # 待办数据 Hook
│   │   │   └── useChat.ts       # WebSocket 聊天 Hook
│   │   ├── services/            # API 调用层
│   │   │   ├── todoApi.ts       # 待办 CRUD API
│   │   │   └── agentApi.ts      # Agent 通信 API
│   │   ├── types/               # TypeScript 类型定义
│   │   │   └── todo.ts
│   │   ├── App.tsx
│   │   └── main.tsx
│   ├── package.json
│   ├── tsconfig.json
│   └── vite.config.ts
│
├── backend/                     # Golang 后端
│   ├── cmd/
│   │   └── server/
│   │       └── main.go          # 服务入口
│   ├── internal/
│   │   ├── handler/             # HTTP 处理器（Controller 层）
│   │   │   └── todo_handler.go
│   │   ├── service/             # 业务逻辑层
│   │   │   └── todo_service.go
│   │   ├── repository/          # 数据访问层
│   │   │   └── todo_repo.go
│   │   ├── model/               # 数据模型
│   │   │   └── todo.go
│   │   └── middleware/           # 中间件（日志、CORS 等）
│   │       └── logger.go
│   ├── migrations/              # 数据库迁移文件
│   │   └── 001_create_todos.sql
│   ├── go.mod
│   └── go.sum
│
├── agent-service/               # Python Agent 服务
│   ├── app/
│   │   ├── main.py              # FastAPI 服务入口
│   │   ├── agent.py             # Agent 核心逻辑
│   │   ├── tools.py             # Agent 工具定义
│   │   ├── prompts.py           # 系统提示词
│   │   └── schemas.py           # Pydantic 数据模型
│   ├── tests/
│   │   └── test_agent.py
│   ├── pyproject.toml
│   └── Dockerfile
│
├── data/                        # 数据库初始化脚本
│   └── init.sql
├── docs/                        # 项目文档
│   ├── ARCHITECTURE.md
│   ├── PRD.md
│   └── WORKFLOW.md
├── docker-compose.yml           # 本地开发环境编排
├── .env.example                 # 环境变量模板
├── .gitignore
└── README.md
```

---

## 3. 日常开发流程

### 3.1 分支策略

采用 **Trunk-Based Development** 简化版：

```text
main          ← 始终保持可部署状态
  ├── feat/xxx   ← 功能分支（从 main 拉出）
  ├── fix/xxx    ← 修复分支
  └── chore/xxx  ← 工程化分支（依赖更新、配置变更）
```

### 3.2 从需求到代码的完整流程

```text
1. 领取任务（PRD 中的用户故事或功能点）
   ↓
2. 从 main 创建功能分支
   git checkout main && git pull
   git checkout -b feat/add-todo-priority
   ↓
3. 编写接口契约（跨模块时先定义 API 契约）
   ↓
4. 编码实现（遵循各模块的工作流）
   ↓
5. 本地自测（单元测试 + 手动验证）
   ↓
6. 提交代码
   git add . && git commit -m "feat: add todo priority field"
   ↓
7. 推送并创建 PR
   git push origin feat/add-todo-priority
   ↓
8. 代码审查（详见第 8 节）
   ↓
9. 合并到 main
   ↓
10. 部署验证
```

### 3.3 Commit 规范

遵循 [Conventional Commits](https://www.conventionalcommits.org/)：

```text
<type>(<scope>): <description>

# 示例
feat(frontend): add todo priority filter
feat(backend): add priority field to todo API
feat(agent): support priority in natural language parsing
fix(backend): handle empty todo title validation
chore(deps): bump go version to 1.22
docs: update API documentation
test(agent): add intent parsing unit tests
```

| type | 说明 |
| ------ | ------ |
| feat | 新功能 |
| fix | Bug 修复 |
| chore | 工程化变更 |
| docs | 文档更新 |
| test | 测试相关 |
| refactor | 重构（不改变功能） |

---

## 4. 后端开发工作流

### 4.1 技术栈

| 组件 | 选型 |
| ------ | ------ |
| Web 框架 | `gin-gonic/gin` |
| ORM | `gorm.io/gorm` |
| 数据库驱动 | `gorm.io/driver/postgres` |
| 配置管理 | `spf13/viper` |
| 日志 | `uber-go/zap` |

### 4.2 分层架构

```text
HTTP Request
  → handler/     # 参数绑定、校验、响应格式化
    → service/   # 业务逻辑、事务管理
      → repository/  # 数据库操作（GORM）
        → model/     # 数据结构定义
```

### 4.3 开发步骤（以新增「优先级」字段为例）

#### Step 1：定义数据模型

```go
// backend/internal/model/todo.go

type Todo struct {
    ID          uint      `json:"id" gorm:"primaryKey"`
    Title       string    `json:"title" gorm:"not null"`
    Description string    `json:"description"`
    Priority    string    `json:"priority" gorm:"default:'medium'"` // 新增
    Completed   bool      `json:"completed" gorm:"default:false"`
    DueDate     *time.Time `json:"due_date"`
    CreatedAt   time.Time `json:"created_at"`
    UpdatedAt   time.Time `json:"updated_at"`
}
```

#### Step 2：编写数据库迁移

```sql
-- backend/migrations/002_add_priority.sql
ALTER TABLE todos ADD COLUMN priority VARCHAR(10) DEFAULT 'medium';
```

#### Step 3：实现 Repository 层

```go
// backend/internal/repository/todo_repo.go

func (r *TodoRepo) FindByPriority(priority string) ([]model.Todo, error) {
    var todos []model.Todo
    result := r.db.Where("priority = ?", priority).Find(&todos)
    return todos, result.Error
}
```

#### Step 4：实现 Service 层

```go
// backend/internal/service/todo_service.go

func (s *TodoService) CreateTodo(req CreateTodoRequest) (*model.Todo, error) {
    // 1. 参数校验
    if req.Title == "" {
        return nil, ErrEmptyTitle
    }
    if req.Priority == "" {
        req.Priority = "medium" // 默认值
    }
    // 2. 调用 Repository
    return s.repo.Create(&model.Todo{
        Title:    req.Title,
        Priority: req.Priority,
    })
}
```

#### Step 5：实现 Handler 层

```go
// backend/internal/handler/todo_handler.go

func (h *TodoHandler) CreateTodo(c *gin.Context) {
    var req CreateTodoRequest
    if err := c.ShouldBindJSON(&req); err != nil {
        c.JSON(400, gin.H{"error": err.Error()})
        return
    }
    todo, err := h.service.CreateTodo(req)
    if err != nil {
        c.JSON(500, gin.H{"error": err.Error()})
        return
    }
    c.JSON(201, todo)
}
```

#### Step 6：注册路由

```go
// backend/cmd/server/main.go

r := gin.Default()
todoGroup := r.Group("/api/todos")
{
    todoGroup.GET("", todoHandler.ListTodos)
    todoGroup.GET("/:id", todoHandler.GetTodo)
    todoGroup.POST("", todoHandler.CreateTodo)
    todoGroup.PUT("/:id", todoHandler.UpdateTodo)
    todoGroup.DELETE("/:id", todoHandler.DeleteTodo)
    todoGroup.PATCH("/:id/complete", todoHandler.CompleteTodo)
}
```

#### Step 7：本地测试

```bash
# 启动后端服务
cd backend
go run cmd/server/main.go

# 测试 API
curl -X POST http://localhost:8080/api/todos \
  -H "Content-Type: application/json" \
  -d '{"title":"买牛奶","priority":"high"}'

curl http://localhost:8080/api/todos
```

### 4.4 后端测试规范

```go
// backend/internal/service/todo_service_test.go

func TestCreateTodo_EmptyTitle(t *testing.T) {
    svc := NewTodoService(mockRepo)
    _, err := svc.CreateTodo(CreateTodoRequest{Title: ""})
    assert.Equal(t, ErrEmptyTitle, err)
}

func TestCreateTodo_DefaultPriority(t *testing.T) {
    svc := NewTodoService(mockRepo)
    todo, err := svc.CreateTodo(CreateTodoRequest{Title: "test"})
    assert.NoError(t, err)
    assert.Equal(t, "medium", todo.Priority)
}
```

```bash
# 运行测试
go test ./internal/... -v
go test ./internal/... -cover
```

---

## 5. 前端开发工作流

> **实现输入：** 开始前端开发前，必须阅读 [UI 原型设计](./superpowers/specs/2026-07-13-agent-todolist-prototype-design.md)，并打开 [V6 可交互原型](../.superpowers/brainstorm/40507-1783945975/content/workspace-full-flow-v6.html) 校准布局、状态与动效。不得仅根据本章示例推断最终页面。

> **依赖一致性：** 下表记录最初目标栈；当前 `frontend/package.json` 已是 React 19 / TypeScript 6 / Vite 8，且未安装 TailwindCSS、Axios 和测试框架。实施计划必须先明确沿用现有脚手架还是回调到目标版本，并在决定后同步更新本章、架构文档、README 和 CLAUDE.md。

### 5.1 技术栈

| 组件 | 选型 |
| ------ | ------ |
| 框架 | React 18 + TypeScript |
| 构建工具 | Vite 5 |
| 样式 | TailwindCSS 3 |
| HTTP 客户端 | Axios |
| 状态管理 | React Context + useReducer |

### 5.2 组件开发规范

- **单文件组件**：一个 `.tsx` 文件 + 一个可选的 `.test.tsx`
- **Props 类型**：始终用 interface 定义 Props
- **命名**：组件用 PascalCase，文件同名
- **导出**：组件文件默认导出组件，类型命名导出

### 5.3 开发步骤（以新增「优先级筛选」为例）

#### Step 1：定义类型

```typescript
// frontend/src/types/todo.ts

export interface Todo {
  id: number;
  title: string;
  description: string;
  priority: 'high' | 'medium' | 'low';  // 新增
  completed: boolean;
  due_date: string | null;
  created_at: string;
  updated_at: string;
}
```

#### Step 2：封装 API 调用

```typescript
// frontend/src/services/todoApi.ts

import axios from 'axios';
import type { Todo } from '../types/todo';

const api = axios.create({ baseURL: '/api' });

export const todoApi = {
  list: (params?: { priority?: string }) =>
    api.get<Todo[]>('/todos', { params }),

  create: (data: Partial<Todo>) =>
    api.post<Todo>('/todos', data),

  update: (id: number, data: Partial<Todo>) =>
    api.put<Todo>(`/todos/${id}`, data),

  remove: (id: number) =>
    api.delete(`/todos/${id}`),

  complete: (id: number) =>
    api.patch(`/todos/${id}/complete`),
};
```

#### Step 3：编写自定义 Hook

```typescript
// frontend/src/hooks/useTodos.ts

import { useState, useEffect, useCallback } from 'react';
import { todoApi } from '../services/todoApi';
import type { Todo } from '../types/todo';

export function useTodos() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchTodos = useCallback(async (priority?: string) => {
    setLoading(true);
    const { data } = await todoApi.list(priority ? { priority } : undefined);
    setTodos(data);
    setLoading(false);
  }, []);

  const createTodo = useCallback(async (todo: Partial<Todo>) => {
    const { data } = await todoApi.create(todo);
    setTodos(prev => [...prev, data]);
    return data;
  }, []);

  // deleteTodo, updateTodo, completeTodo ...

  return { todos, loading, fetchTodos, createTodo };
}
```

#### Step 4：编写 UI 组件

```typescript
// frontend/src/components/todo/PriorityFilter.tsx

interface Props {
  value: string;
  onChange: (priority: string) => void;
}

export default function PriorityFilter({ value, onChange }: Props) {
  const priorities = [
    { key: '', label: '全部' },
    { key: 'high', label: '高优先级' },
    { key: 'medium', label: '中优先级' },
    { key: 'low', label: '低优先级' },
  ];

  return (
    <div className="flex gap-2">
      {priorities.map(p => (
        <button
          key={p.key}
          onClick={() => onChange(p.key)}
          className={`px-3 py-1 rounded ${
            value === p.key
              ? 'bg-blue-500 text-white'
              : 'bg-gray-100 hover:bg-gray-200'
          }`}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}
```

#### Step 5：组装页面

```typescript
// frontend/src/pages/TodoPage.tsx

export default function TodoPage() {
  const { todos, loading, fetchTodos, createTodo } = useTodos();
  const [priorityFilter, setPriorityFilter] = useState('');

  useEffect(() => {
    fetchTodos(priorityFilter || undefined);
  }, [priorityFilter, fetchTodos]);

  return (
    <div className="max-w-2xl mx-auto p-4">
      <h1 className="text-2xl font-bold mb-4">我的待办</h1>
      <PriorityFilter value={priorityFilter} onChange={setPriorityFilter} />
      {/* TodoForm, TodoList 等组件 */}
    </div>
  );
}
```

### 5.4 前端测试规范

```typescript
// frontend/src/components/todo/PriorityFilter.test.tsx

import { render, screen, fireEvent } from '@testing-library/react';
import PriorityFilter from './PriorityFilter';

test('renders all priority options', () => {
  render(<PriorityFilter value="" onChange={() => {}} />);
  expect(screen.getByText('全部')).toBeInTheDocument();
  expect(screen.getByText('高优先级')).toBeInTheDocument();
  expect(screen.getByText('中优先级')).toBeInTheDocument();
  expect(screen.getByText('低优先级')).toBeInTheDocument();
});

test('calls onChange with correct priority', () => {
  const onChange = vi.fn();
  render(<PriorityFilter value="" onChange={onChange} />);
  fireEvent.click(screen.getByText('高优先级'));
  expect(onChange).toHaveBeenCalledWith('high');
});
```

```bash
# 运行前端测试
cd frontend
pnpm test
pnpm test -- --coverage
```

---

## 6. Agent 开发工作流

### 6.1 技术栈

| 组件 | 选型 |
| ------ | ------ |
| 包管理 | uv |
| Web 框架 | FastAPI |
| LLM 框架 | LangChain |
| LLM 网关 | LangGraph |
| 通信协议 | WebSocket |
| 数据校验 | Pydantic v2 |

### 6.2 Agent 架构

```text
用户输入（自然语言）
  → FastAPI WebSocket 接入
    → Agent 核心引擎
      → Prompt 模板渲染
        → LLM 调用（意图理解 + 工具选择）
          → 工具执行（调用 Golang 后端 API）
            → 结果格式化
              → WebSocket 推送回复给前端
```

### 6.3 开发步骤（以新增「优先级理解」为例）

#### Step 1：定义工具

```python
# agent-service/app/tools.py

from langchain.tools import tool
import httpx

BACKEND_URL = "http://localhost:8080/api"

@tool
def create_todo(title: str, priority: str = "medium",
                description: str = "", due_date: str = None) -> dict:
    """创建一个新的待办事项。

    Args:
        title: 待办标题
        priority: 优先级，可选 high / medium / low，默认 medium
        description: 详细描述
        due_date: 截止日期，格式 YYYY-MM-DD
    """
    payload = {
        "title": title,
        "priority": priority,
        "description": description,
        "due_date": due_date,
    }
    resp = httpx.post(f"{BACKEND_URL}/todos", json=payload)
    resp.raise_for_status()
    return resp.json()

@tool
def list_todos(priority: str = None, completed: bool = None) -> list:
    """查询待办列表。

    Args:
        priority: 按优先级筛选，可选 high / medium / low
        completed: True=已完成, False=未完成, None=全部
    """
    params = {}
    if priority:
        params["priority"] = priority
    if completed is not None:
        params["completed"] = str(completed).lower()
    resp = httpx.get(f"{BACKEND_URL}/todos", params=params)
    resp.raise_for_status()
    return resp.json()

# 所有可用的工具列表
TOOLS = [create_todo, list_todos, update_todo, delete_todo, complete_todo]
```

#### Step 2：编写系统提示词

```python
# agent-service/app/prompts.py

SYSTEM_PROMPT = """你是一个待办事项管理助手。你可以帮助用户创建、查询、更新和删除待办事项。

## 你的能力
- 创建待办：理解用户提到的任务和属性（优先级、截止日期等）
- 查询待办：列出用户的待办，支持按状态和优先级筛选
- 更新待办：修改待办的标题、优先级、截止日期等
- 标记完成：将待办标记为已完成
- 删除待办：删除指定的待办

## 规则
1. 始终用中文与用户交流
2. 在执行操作前，向用户确认关键信息
3. 如果用户没有指定优先级，默认使用 medium
4. 操作完成后，用简洁的语言告知结果
5. 如果用户的请求不明确，主动询问缺失的信息
"""
```

#### Step 3：实现 Agent 核心

```python
# agent-service/app/agent.py

from langchain_openai import ChatOpenAI
from langgraph.prebuilt import create_react_agent
from .tools import TOOLS
from .prompts import SYSTEM_PROMPT

class TodoAgent:
    def __init__(self, model_name: str = "gpt-4o"):
        self.llm = ChatOpenAI(model=model_name, temperature=0.1)
        self.agent = create_react_agent(
            model=self.llm,
            tools=TOOLS,
            state_modifier=SYSTEM_PROMPT,
        )

    async def chat(self, user_message: str, history: list = None):
        """处理用户消息，返回 Agent 的回复。"""
        messages = history or []
        messages.append({"role": "user", "content": user_message})

        result = await self.agent.ainvoke({"messages": messages})
        return result["messages"][-1].content
```

#### Step 4：编写 FastAPI 接口

```python
# agent-service/app/main.py

from fastapi import FastAPI, WebSocket
from .agent import TodoAgent

app = FastAPI()
agent = TodoAgent()

@app.websocket("/api/agent/chat")
async def agent_chat(ws: WebSocket):
    await ws.accept()
    history = []

    while True:
        user_message = await ws.receive_text()
        # 流式推送处理状态
        await ws.send_json({"type": "status", "content": "正在理解你的需求..."})

        reply = await agent.chat(user_message, history)

        await ws.send_json({"type": "reply", "content": reply})
        history.append({"role": "user", "content": user_message})
        history.append({"role": "assistant", "content": reply})
```

#### Step 5：本地测试

```bash
# 启动 Agent 服务
cd agent-service
uv sync
uv run uvicorn app.main:app --reload --port 8000

# 使用 websocat 测试（或写一个简单的 Python 脚本）
websocat ws://localhost:8000/api/agent/chat
# 输入：创建一个高优先级的待办叫买牛奶
```

### 6.4 Agent 测试规范

```python
# agent-service/tests/test_agent.py

import pytest
from app.agent import TodoAgent

@pytest.mark.asyncio
async def test_create_todo_intent():
    agent = TodoAgent()
    reply = await agent.chat("帮我创建一个待办：买牛奶")
    assert "创建" in reply or "成功" in reply

@pytest.mark.asyncio
async def test_priority_extraction():
    agent = TodoAgent()
    reply = await agent.chat("创建一个高优先级的待办：完成报告")
    assert "高" in reply or "high" in reply.lower()

@pytest.mark.asyncio
async def test_list_todos():
    agent = TodoAgent()
    reply = await agent.chat("我还有哪些未完成的待办？")
    # 验证返回了列表或说明没有待办
    assert len(reply) > 0
```

---

## 7. 联调与测试工作流

### 7.1 端到端测试场景

| 场景 | 操作 | 预期结果 |
| ------ | ------ | ------ |
| TC1: 传统模式创建 | 在表单中填写标题，点击创建 | 待办出现在列表中 |
| TC2: Agent 创建 | 在聊天框输入"创建待办买牛奶" | Agent 回复确认，待办出现在列表中 |
| TC3: 双模式同步 | Agent 创建后切换到传统视图 | 新待办可见 |
| TC4: 标记完成 | 点击待办的完成按钮 | 待办状态变为已完成 |
| TC5: 优先级筛选 | 选择"高优先级"筛选 | 只显示高优先级待办 |

### 7.2 联调启动顺序

```bash
# 1. 启动基础设施
docker-compose up -d postgres redis

# 2. 启动后端（终端 1）
cd backend && go run cmd/server/main.go

# 3. 启动 Agent 服务（终端 2）
cd agent-service && uv run uvicorn app.main:app --reload --port 8000

# 4. 启动前端（终端 3）
cd frontend && pnpm dev
```

### 7.3 一键启动（Docker Compose）

```yaml
# docker-compose.yml（开发模式）
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_USER: todolist
      POSTGRES_PASSWORD: todolist123
      POSTGRES_DB: todolist
    ports: ["5432:5432"]
    volumes: ["./data/init.sql:/docker-entrypoint-initdb.d/init.sql"]

  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]

  backend:
    build: ./backend
    ports: ["8080:8080"]
    depends_on: [postgres, redis]
    environment:
      POSTGRES_HOST: postgres
      REDIS_HOST: redis

  agent:
    build: ./agent-service
    ports: ["8000:8000"]
    depends_on: [backend]
    environment:
      BACKEND_URL: http://backend:8080/api
      LLM_API_KEY: ${LLM_API_KEY}

  frontend:
    build: ./frontend
    ports: ["3000:3000"]
    depends_on: [backend, agent]
```

```bash
# 一键启动全部服务
docker-compose up -d
```

---

## 8. 代码审查规范

### 8.1 审查清单

**通用检查项：**

- [ ] 代码遵循项目既有的代码风格
- [ ] 无硬编码的配置值（使用环境变量或配置文件）
- [ ] 错误处理完整（不忽略 error/exception）
- [ ] 关键逻辑有注释说明
- [ ] 无未使用的 import 或变量
- [ ] 提交信息符合 Conventional Commits 规范

**后端检查项：**

- [ ] Handler 层做了参数校验
- [ ] Service 层有事务边界处理
- [ ] Repository 查询使用了参数化（防 SQL 注入）
- [ ] API 响应格式一致（统一错误码结构）
- [ ] 数据库迁移文件已添加

**前端检查项：**

- [ ] 组件有 Props 类型定义
- [ ] API 调用的 loading / error 状态有处理
- [ ] 无 any 类型（使用正确的 TypeScript 类型）
- [ ] UI 在移动端和桌面端都可正常显示

**Agent 检查项：**

- [ ] 新工具函数有完整的 docstring
- [ ] 系统提示词已更新以覆盖新功能
- [ ] 工具调用的参数校验完整
- [ ] 错误情况有优雅降级（LLM 不可用时的 fallback）

### 8.2 PR 描述模板

```markdown
## 变更说明
简要描述做了什么。

## 关联需求
- PRD US1: 快速记录任务

## 变更类型
- [ ] 新功能 (feat)
- [ ] Bug 修复 (fix)
- [ ] 重构 (refactor)
- [ ] 工程化 (chore)

## 测试
- [ ] 单元测试已通过
- [ ] 手动验证已完成

## 截图（前端变更时）
| 变更前 | 变更后 |
|--------|--------|
| <截图> | <截图> |
```

---

## 9. 部署工作流

### 9.1 简化版部署（Docker Compose 单机）

```bash
# 1. 构建镜像
docker-compose -f docker-compose.prod.yml build

# 2. 启动服务
docker-compose -f docker-compose.prod.yml up -d

# 3. 运行数据库迁移
docker-compose exec backend ./migrate up

# 4. 验证部署
curl http://localhost:8080/api/todos
```

### 9.2 部署架构

```text
Nginx (端口 80/443)
  ├── /          → 前端静态文件
  ├── /api/      → 后端服务 (localhost:8080)
  └── /ws/       → Agent WebSocket (localhost:8000)
```

### 9.3 Nginx 配置示例

```nginx
server {
    listen 80;
    server_name todolist.example.com;

    # 前端静态文件
    root /var/www/todolist/frontend/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    # 后端 API 代理
    location /api/ {
        proxy_pass http://localhost:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # Agent WebSocket 代理
    location /ws/ {
        proxy_pass http://localhost:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

---

## 10. 常见问题排查

### 10.1 后端启动失败

```bash
# 问题：找不到 PostgreSQL
# 解决：检查 Docker 是否启动，PostgreSQL 容器是否运行
docker ps | grep postgres

# 问题：数据库表不存在
# 解决：手动运行迁移
cd backend && go run cmd/migrate/main.go up
```

### 10.2 前端请求报 404

```bash
# 问题：Vite 代理未配置
# 解决：检查 vite.config.ts 中的 proxy 配置
```

```typescript
// vite.config.ts
export default defineConfig({
  server: {
    proxy: {
      '/api': 'http://localhost:8080',
      '/ws': {
        target: 'ws://localhost:8000',
        ws: true,
      },
    },
  },
});
```

### 10.3 Agent 无法连接后端

```bash
# 问题：容器内 localhost 指向容器自身
# 解决：使用服务名（Docker Compose）或 host.docker.internal
# agent-service/app/tools.py
BACKEND_URL = os.getenv("BACKEND_URL", "http://localhost:8080/api")
```

### 10.4 WebSocket 连接断开

```bash
# 问题：Nginx 代理超时
# 解决：增加 proxy_read_timeout
proxy_read_timeout 300s;
proxy_send_timeout 300s;
```

---

## 附录

### A. 有用的命令速查

```bash
# === 后端 ===
go run cmd/server/main.go              # 启动后端
go test ./... -v                       # 运行所有测试
go test ./internal/service/... -cover  # 带覆盖率的测试
curl -X POST localhost:8080/api/todos -d '{"title":"test"}' -H 'Content-Type: application/json'

# === 前端 ===
pnpm dev                               # 启动开发服务器
pnpm build                             # 生产构建
pnpm test                              # 运行测试
pnpm lint                              # 代码检查

# === Agent ===
uv sync                                      # 安装依赖
uv run uvicorn app.main:app --reload --port 8000  # 启动 Agent
uv run --frozen --extra dev pytest tests/ -v # 按锁文件运行测试依赖

# === Docker ===
docker-compose up -d                   # 启动所有服务
docker-compose down                    # 停止所有服务
docker-compose logs -f backend         # 查看后端日志
docker-compose exec backend sh         # 进入后端容器
```

### B. 参考文档

- [架构文档](./ARCHITECTURE.md)
- [产品需求文档](./PRD.md)
