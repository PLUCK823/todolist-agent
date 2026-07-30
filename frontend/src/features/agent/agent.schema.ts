import type { AgentEvent } from './agent.types'

export class AgentContractError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AgentContractError'
  }
}

const dangerousKeys = new Set(['__proto__', 'constructor', 'prototype'])
const MAX_DEPTH = 32
const MAX_NODES = 5_000
const MAX_STRING_LENGTH = 32_768
const MAX_TOTAL_STRING_LENGTH = 131_072
const MAX_KEY_LENGTH = 256

interface SanitizeBudget { nodes: number; stringLength: number }

function sanitizeJson(value: unknown, path: string, budget: SanitizeBudget, depth = 0): unknown {
  budget.nodes++
  if (depth > MAX_DEPTH || budget.nodes > MAX_NODES) throw new AgentContractError('Agent event exceeds structural limits')
  if (typeof value === 'string') {
    budget.stringLength += value.length
    if (value.length > MAX_STRING_LENGTH || budget.stringLength > MAX_TOTAL_STRING_LENGTH) {
      throw new AgentContractError('Agent event string exceeds limits')
    }
    return value
  }
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new AgentContractError('Agent event contains an invalid number')
    return value
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => sanitizeJson(item, `${path}[${index}]`, budget, depth + 1))
  }
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new AgentContractError('Agent event must contain plain JSON objects')
  }

  const clone: Record<string, unknown> = {}
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || dangerousKeys.has(key)) {
      throw new AgentContractError('Agent event contains an unsafe object key')
    }
    budget.stringLength += key.length
    if (key.length > MAX_KEY_LENGTH || budget.stringLength > MAX_TOTAL_STRING_LENGTH) {
      throw new AgentContractError('Agent event object key exceeds limits')
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      throw new AgentContractError('Agent event contains an invalid property')
    }
    clone[key] = sanitizeJson(descriptor.value, `${path}.${key}`, budget, depth + 1)
  }
  return clone
}

function eventRecord(value: unknown): Record<string, unknown> {
  const sanitized = sanitizeJson(value, 'event', { nodes: 0, stringLength: 0 })
  if (!sanitized || typeof sanitized !== 'object' || Array.isArray(sanitized)) {
    throw new AgentContractError('Agent event must be an object')
  }
  return sanitized as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[]): void {
  const allow = new Set(allowed)
  const unexpected = Object.keys(value).find((key) => !allow.has(key))
  if (unexpected) throw new AgentContractError(`Unexpected Agent event field: ${unexpected}`)
}

function stringField(value: Record<string, unknown>, field: string): string {
  if (typeof value[field] !== 'string') throw new AgentContractError(`Invalid ${field}`)
  return value[field]
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function eventIdField(value: Record<string, unknown>): string {
  const eventId = stringField(value, 'event_id')
  if (!uuidPattern.test(eventId)) throw new AgentContractError('Invalid event_id')
  return eventId
}

function durationField(value: Record<string, unknown>): number {
  const duration = value.duration_ms
  if (typeof duration !== 'number' || duration < 0) {
    throw new AgentContractError('Invalid duration_ms')
  }
  return duration
}

function jsonObjectField(value: Record<string, unknown>, field: string): Record<string, unknown> {
  const result = value[field]
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new AgentContractError(`Invalid ${field}`)
  }
  return result as Record<string, unknown>
}

function addStepContext<T extends object>(parsed: T, event: Record<string, unknown>): T {
  const target = parsed as unknown as Record<string, unknown>
  target['event_id'] = eventIdField(event)
  if (event.label !== undefined) target['label'] = stringField(event, 'label')
  if (event.tool !== undefined) target['tool'] = stringField(event, 'tool')
  if (event.args !== undefined) target['args'] = jsonObjectField(event, 'args')
  if (event.started_at !== undefined) target['started_at'] = stringField(event, 'started_at')
  return parsed
}

export function parseAgentEvent(value: unknown): AgentEvent {
  const event = eventRecord(value)
  switch (event.type) {
    case 'step_started': {
      exactKeys(event, ['type', 'event_id', 'step_id', 'label', 'tool', 'args', 'started_at'])
      const parsed: Extract<AgentEvent, { type: 'step_started' }> = {
        type: 'step_started',
        event_id: eventIdField(event),
        step_id: stringField(event, 'step_id'),
        label: stringField(event, 'label'),
      }
      if (event.tool !== undefined) parsed.tool = stringField(event, 'tool')
      if (event.started_at !== undefined) parsed.started_at = stringField(event, 'started_at')
      if (event.args !== undefined) parsed.args = jsonObjectField(event, 'args')
      return addStepContext(parsed, event)
    }
    case 'step_completed': {
      exactKeys(event, ['type', 'event_id', 'step_id', 'label', 'tool', 'args', 'started_at', 'duration_ms'])
      return addStepContext({ type: 'step_completed', event_id: eventIdField(event), step_id: stringField(event, 'step_id'), duration_ms: durationField(event) }, event)
    }
    case 'step_failed':
      exactKeys(event, ['type', 'event_id', 'step_id', 'label', 'tool', 'args', 'started_at', 'error_code', 'message', 'retryable', 'retry_token', 'duration_ms'])
      if (typeof event.retryable !== 'boolean') throw new AgentContractError('Invalid retryable')
      if (event.retry_token !== undefined && (!event.retryable || stringField(event, 'retry_token').length < 32)) {
        throw new AgentContractError('Invalid retry_token')
      }
      return addStepContext({
        type: 'step_failed',
        event_id: eventIdField(event),
        step_id: stringField(event, 'step_id'),
        error_code: stringField(event, 'error_code'),
        message: stringField(event, 'message'),
        retryable: event.retryable,
        ...(event.retry_token !== undefined && { retry_token: stringField(event, 'retry_token') }),
        duration_ms: durationField(event),
      }, event)
    case 'confirmation_required':
      exactKeys(event, ['type', 'event_id', 'step_id', 'label', 'tool', 'args', 'started_at', 'message', 'confirmation_id'])
      return addStepContext({
        type: 'confirmation_required',
        event_id: eventIdField(event),
        step_id: stringField(event, 'step_id'),
        message: stringField(event, 'message'),
        confirmation_id: stringField(event, 'confirmation_id'),
      }, event)
    case 'action_completed':
      exactKeys(event, ['type', 'event_id', 'step_id', 'label', 'tool', 'args', 'started_at', 'confirmation_id', 'confirmation_message', 'confirmation_approved', 'action', 'result', 'duration_ms'])
      if (event.confirmation_approved !== undefined && typeof event.confirmation_approved !== 'boolean') {
        throw new AgentContractError('Invalid confirmation_approved')
      }
      return addStepContext({
        type: 'action_completed',
        event_id: eventIdField(event),
        step_id: stringField(event, 'step_id'),
        action: stringField(event, 'action'),
        result: jsonObjectField(event, 'result'),
        duration_ms: durationField(event),
        ...(event.confirmation_id !== undefined && { confirmation_id: stringField(event, 'confirmation_id') }),
        ...(event.confirmation_message !== undefined && { confirmation_message: stringField(event, 'confirmation_message') }),
        ...(event.confirmation_approved !== undefined && { confirmation_approved: event.confirmation_approved }),
      }, event)
    case 'reply':
      exactKeys(event, ['type', 'content'])
      return { type: 'reply', content: stringField(event, 'content') }
    case 'done':
      exactKeys(event, ['type'])
      return { type: 'done' }
    default:
      throw new AgentContractError('Unknown Agent event type')
  }
}
