import type { AgentEvent } from '../features/agent/agent.types'

export const agentMockDelays = {
  understand: 800,
  callTodoApi: 800,
  waitForTodoApi: 1400,
  syncPage: 800,
} as const

export interface TimedAgentEvent {
  atMs: number
  event: AgentEvent
}

export interface AgentEventScenario {
  events: TimedAgentEvent[]
}

const understandStarted: TimedAgentEvent = {
  atMs: 0,
  event: {
    type: 'step_started',
    step_id: 'understand-1',
    label: '理解请求',
    started_at: '2026-07-14T00:00:00Z',
  },
}

const understandCompleted: TimedAgentEvent = {
  atMs: agentMockDelays.understand,
  event: {
    type: 'step_completed',
    step_id: 'understand-1',
    duration_ms: agentMockDelays.understand,
  },
}

const createStarted: TimedAgentEvent = {
  atMs: agentMockDelays.understand + agentMockDelays.callTodoApi,
  event: {
    type: 'step_started',
    step_id: 'create-1',
    label: '调用 Todo API',
    tool: 'create_todo',
    args: { title: '完成前端原型', priority: 'high' },
  },
}

const createFinishedAt = createStarted.atMs + agentMockDelays.waitForTodoApi
const replyAt = createFinishedAt + agentMockDelays.syncPage

export const agentEventScenarios = {
  success: {
    events: [
      understandStarted,
      understandCompleted,
      createStarted,
      {
        atMs: createFinishedAt,
        event: {
          type: 'action_completed',
          step_id: 'create-1',
          action: 'create_todo',
          result: { id: 5, title: '完成前端原型', priority: 'high' },
          duration_ms: agentMockDelays.waitForTodoApi,
        },
      },
      { atMs: replyAt, event: { type: 'reply', content: '好的，已创建高优先级任务。' } },
      { atMs: replyAt, event: { type: 'done' } },
    ],
  },
  timeout: {
    events: [
      understandStarted,
      understandCompleted,
      createStarted,
      {
        atMs: createStarted.atMs + 5000,
        event: {
          type: 'step_failed',
          step_id: 'create-1',
          error_code: 'TOOL_TIMEOUT',
          message: 'Todo API 响应超时',
          retryable: true,
          duration_ms: 5000,
        },
      },
      { atMs: createStarted.atMs + 5000, event: { type: 'done' } },
    ],
  },
  readOnlyTimeout: {
    events: [
      understandStarted,
      understandCompleted,
      {
        atMs: createStarted.atMs,
        event: {
          type: 'step_started',
          step_id: 'list-1',
          label: '查询 Todo 列表',
          tool: 'list_todos',
          args: { completed: false },
        },
      },
      {
        atMs: createStarted.atMs + 5000,
        event: {
          type: 'step_failed',
          step_id: 'list-1',
          error_code: 'TOOL_TIMEOUT',
          message: 'Todo API 查询超时',
          retryable: true,
          duration_ms: 5000,
        },
      },
      { atMs: createStarted.atMs + 5000, event: { type: 'done' } },
    ],
  },
  readOnlySuccess: {
    events: [
      understandStarted,
      understandCompleted,
      {
        atMs: createStarted.atMs,
        event: {
          type: 'step_started',
          step_id: 'list-1',
          label: '查询 Todo 列表',
          tool: 'list_todos',
          args: { completed: false },
        },
      },
      {
        atMs: createFinishedAt,
        event: { type: 'step_completed', step_id: 'list-1', duration_ms: agentMockDelays.waitForTodoApi },
      },
      { atMs: replyAt, event: { type: 'reply', content: '已查询到 4 项任务。' } },
      { atMs: replyAt, event: { type: 'done' } },
    ],
  },
  deleteTimeout: {
    events: [
      understandStarted,
      understandCompleted,
      {
        atMs: createStarted.atMs,
        event: { type: 'step_started', step_id: 'delete-1', label: '删除待办', tool: 'delete_todo', args: { id: 1 } },
      },
      {
        atMs: createStarted.atMs + 5000,
        event: {
          type: 'step_failed', step_id: 'delete-1', error_code: 'TOOL_TIMEOUT', message: '删除 Todo 超时', retryable: true, duration_ms: 5000,
        },
      },
      { atMs: createStarted.atMs + 5000, event: { type: 'done' } },
    ],
  },
  validationError: {
    events: [
      understandStarted,
      understandCompleted,
      createStarted,
      {
        atMs: createStarted.atMs + agentMockDelays.callTodoApi,
        event: {
          type: 'step_failed',
          step_id: 'create-1',
          error_code: 'VALIDATION_ERROR',
          message: '待办标题不能为空',
          retryable: false,
          duration_ms: agentMockDelays.callTodoApi,
        },
      },
      { atMs: createStarted.atMs + agentMockDelays.callTodoApi, event: { type: 'done' } },
    ],
  },
  confirmationRequired: {
    events: [
      understandStarted,
      understandCompleted,
      {
        atMs: createStarted.atMs,
        event: {
          type: 'step_started',
          step_id: 'delete-1',
          label: '删除待办',
          tool: 'delete_todo',
          args: { id: 1 },
        },
      },
      {
        atMs: createStarted.atMs,
        event: {
          type: 'confirmation_required',
          step_id: 'delete-1',
          message: '确认删除待办「完成项目文档」？',
          confirmation_id: 'confirm-delete-1',
        },
      },
      {
        atMs: createFinishedAt,
        event: {
          type: 'action_completed',
          step_id: 'delete-1',
          action: 'delete_todo',
          result: { id: 1, deleted: true },
          duration_ms: agentMockDelays.waitForTodoApi,
        },
      },
      { atMs: replyAt, event: { type: 'reply', content: '已删除待办「完成项目文档」。' } },
      { atMs: replyAt, event: { type: 'done' } },
    ],
  },
} satisfies Record<string, AgentEventScenario>
