import { authenticatedFetch } from '../../shared/api/authenticated-fetch'
import type {
  AgentMessage,
  AgentSessionDetail,
  AgentSessionSummary,
  AgentSessionsApi,
  AgentStep,
  AgentTurn,
} from './agent.types'

export class AgentSessionContractError extends Error {
  constructor(message: string) {
    super(`Agent session contract: ${message}`)
    this.name = 'AgentSessionContractError'
  }
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new AgentSessionContractError(`${path} must be an object`)
  }
  return value as Record<string, unknown>
}

function exact(value: Record<string, unknown>, allowed: readonly string[], path: string): void {
  const allowedSet = new Set(allowed)
  const unexpected = Object.keys(value).find((key) => !allowedSet.has(key))
  if (unexpected) throw new AgentSessionContractError(`${path}.${unexpected} is unexpected`)
  const missing = allowed.find((key) => !(key in value))
  if (missing) throw new AgentSessionContractError(`${path}.${missing} is missing`)
}

function text(value: Record<string, unknown>, key: string, path: string): string {
  if (typeof value[key] !== 'string') throw new AgentSessionContractError(`${path}.${key} must be a string`)
  return value[key]
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const isoTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/

function id(value: Record<string, unknown>, key: string, path: string): string {
  const parsed = text(value, key, path)
  if (!uuidPattern.test(parsed)) throw new AgentSessionContractError(`${path}.${key} must be a UUID`)
  return parsed
}

function timestamp(value: Record<string, unknown>, key: string, path: string): string {
  const parsed = text(value, key, path)
  if (!isoTimestampPattern.test(parsed) || Number.isNaN(Date.parse(parsed))) {
    throw new AgentSessionContractError(`${path}.${key} must be an ISO timestamp`)
  }
  return parsed
}

function integer(value: Record<string, unknown>, key: string, path: string): number {
  if (!Number.isInteger(value[key]) || (value[key] as number) < 0) {
    throw new AgentSessionContractError(`${path}.${key} must be a non-negative integer`)
  }
  return value[key] as number
}

function nullableText(value: Record<string, unknown>, key: string, path: string): string | undefined {
  if (value[key] === null) return undefined
  return text(value, key, path)
}

function nullableNumber(value: Record<string, unknown>, key: string, path: string): number | undefined {
  if (value[key] === null) return undefined
  return integer(value, key, path)
}

function boolean(value: Record<string, unknown>, key: string, path: string): boolean {
  if (typeof value[key] !== 'boolean') throw new AgentSessionContractError(`${path}.${key} must be a boolean`)
  return value[key]
}

const summaryKeys = ['id', 'title', 'created_at', 'updated_at', 'last_message_at'] as const

export function parseAgentSessionSummary(value: unknown, path = 'session'): AgentSessionSummary {
  const item = record(value, path)
  exact(item, summaryKeys, path)
  return {
    id: id(item, 'id', path),
    title: text(item, 'title', path),
    createdAt: timestamp(item, 'created_at', path),
    updatedAt: timestamp(item, 'updated_at', path),
    lastMessageAt: timestamp(item, 'last_message_at', path),
  }
}

function parseMessage(value: unknown, path: string): AgentMessage {
  const item = record(value, path)
  exact(item, ['id', 'role', 'content', 'ordinal', 'created_at'], path)
  const role = text(item, 'role', path)
  if (!['user', 'assistant', 'system', 'tool'].includes(role)) {
    throw new AgentSessionContractError(`${path}.role is invalid`)
  }
  integer(item, 'ordinal', path)
  return { id: id(item, 'id', path), role: role as AgentMessage['role'], content: text(item, 'content', path), createdAt: timestamp(item, 'created_at', path) }
}

function parseStep(value: unknown, path: string): AgentStep {
  const item = record(value, path)
  exact(item, [
    'id', 'event_id', 'ordinal', 'label', 'tool', 'status', 'args', 'result', 'result_preview',
    'result_truncated', 'duration_ms', 'error_code', 'error_message', 'retryable', 'confirmation_id',
    'confirmation_message', 'confirmation_approved', 'started_at', 'completed_at',
  ], path)
  const status = text(item, 'status', path)
  if (!['waiting', 'running', 'waiting_confirmation', 'completed', 'failed', 'interrupted'].includes(status)) {
    throw new AgentSessionContractError(`${path}.status is invalid`)
  }
  integer(item, 'ordinal', path)
  const args = record(item.args, `${path}.args`)
  const result = item.result === null ? undefined : item.result
  const confirmationApproved = item.confirmation_approved === null
    ? undefined
    : boolean(item, 'confirmation_approved', path)
  return {
    id: id(item, 'id', path), eventId: id(item, 'event_id', path), label: text(item, 'label', path),
    status: status as AgentStep['status'], tool: nullableText(item, 'tool', path), args,
    result,
    resultPreview: nullableText(item, 'result_preview', path), resultTruncated: boolean(item, 'result_truncated', path),
    durationMs: nullableNumber(item, 'duration_ms', path), errorCode: nullableText(item, 'error_code', path),
    errorMessage: nullableText(item, 'error_message', path), retryable: boolean(item, 'retryable', path),
    confirmationId: nullableText(item, 'confirmation_id', path),
    confirmationMessage: nullableText(item, 'confirmation_message', path), confirmationApproved,
    startedAt: timestamp(item, 'started_at', path), completedAt: item.completed_at === null ? undefined : timestamp(item, 'completed_at', path),
  }
}

function parseTurn(value: unknown, path: string): AgentTurn {
  const item = record(value, path)
  exact(item, [
    'id', 'ordinal', 'status', 'started_at', 'completed_at', 'failure_code', 'failure_message',
    'result_uncertain', 'messages', 'steps',
  ], path)
  const status = text(item, 'status', path)
  if (!['running', 'waiting_confirmation', 'completed', 'failed', 'interrupted'].includes(status)) {
    throw new AgentSessionContractError(`${path}.status is invalid`)
  }
  if (!Array.isArray(item.messages) || !Array.isArray(item.steps)) {
    throw new AgentSessionContractError(`${path} messages and steps must be arrays`)
  }
  return {
    id: id(item, 'id', path), ordinal: integer(item, 'ordinal', path), status: status as AgentTurn['status'],
    startedAt: timestamp(item, 'started_at', path), completedAt: item.completed_at === null ? undefined : timestamp(item, 'completed_at', path),
    failureCode: nullableText(item, 'failure_code', path), failureMessage: nullableText(item, 'failure_message', path),
    resultUncertain: boolean(item, 'result_uncertain', path),
    messages: item.messages.map((message, index) => parseMessage(message, `${path}.messages[${index}]`)),
    steps: item.steps.map((step, index) => parseStep(step, `${path}.steps[${index}]`)),
  }
}

export function parseAgentSessionDetail(value: unknown): AgentSessionDetail {
  const detail = record(value, 'detail')
  exact(detail, ['session', 'turns'], 'detail')
  if (!Array.isArray(detail.turns)) throw new AgentSessionContractError('detail.turns must be an array')
  return { ...parseAgentSessionSummary(detail.session), turns: detail.turns.map((turn, index) => parseTurn(turn, `detail.turns[${index}]`)) }
}

function json(method: string, body: unknown, signal?: AbortSignal): RequestInit {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal }
}

export const agentSessionsApi: AgentSessionsApi = {
  async list(signal) {
    const payload = record(await authenticatedFetch<unknown>('/api/agent/sessions', { signal }), 'list')
    exact(payload, ['items'], 'list')
    if (!Array.isArray(payload.items)) throw new AgentSessionContractError('list.items must be an array')
    return payload.items.map((item, index) => parseAgentSessionSummary(item, `list.items[${index}]`))
  },
  async create(input = {}, signal) {
    const body: Record<string, string> = {}
    if (input.title !== undefined) body.title = input.title
    if (input.firstMessage !== undefined) body.first_message = input.firstMessage
    return parseAgentSessionSummary(await authenticatedFetch<unknown>('/api/agent/sessions', json('POST', body, signal)))
  },
  async detail(sessionId, signal) {
    return parseAgentSessionDetail(await authenticatedFetch<unknown>(`/api/agent/sessions/${encodeURIComponent(sessionId)}`, { signal }))
  },
  async rename(sessionId, title, signal) {
    return parseAgentSessionSummary(await authenticatedFetch<unknown>(
      `/api/agent/sessions/${encodeURIComponent(sessionId)}`, json('PATCH', { title }, signal),
    ))
  },
  async delete(sessionId, signal) {
    const payload = record(await authenticatedFetch<unknown>(
      `/api/agent/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE', signal },
    ), 'delete')
    exact(payload, ['deleted', 'session_id'], 'delete')
    if (payload.deleted !== true || text(payload, 'session_id', 'delete') !== sessionId) {
      throw new AgentSessionContractError('delete acknowledgement is invalid')
    }
  },
}
