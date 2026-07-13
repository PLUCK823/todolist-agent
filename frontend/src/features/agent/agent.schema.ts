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

interface SanitizeBudget { nodes: number; stringLength: number }

function sanitizeJson(value: unknown, path: string, budget: SanitizeBudget, depth = 0): unknown {
  budget.nodes++
  if (depth > MAX_DEPTH || budget.nodes > MAX_NODES) throw new AgentContractError(`Agent event exceeds limits at ${path}`)
  if (typeof value === 'string') {
    budget.stringLength += value.length
    if (value.length > MAX_STRING_LENGTH || budget.stringLength > MAX_TOTAL_STRING_LENGTH) {
      throw new AgentContractError(`Agent event string exceeds limits at ${path}`)
    }
    return value
  }
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new AgentContractError(`Invalid number at ${path}`)
    return value
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => sanitizeJson(item, `${path}[${index}]`, budget, depth + 1))
  }
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new AgentContractError(`Expected plain JSON object at ${path}`)
  }

  const clone: Record<string, unknown> = {}
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || dangerousKeys.has(key)) {
      throw new AgentContractError(`Unsafe key at ${path}`)
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      throw new AgentContractError(`Invalid property at ${path}.${key}`)
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

export function parseAgentEvent(value: unknown): AgentEvent {
  const event = eventRecord(value)
  switch (event.type) {
    case 'step_started': {
      exactKeys(event, ['type', 'step_id', 'label', 'tool', 'args', 'started_at'])
      const parsed: Extract<AgentEvent, { type: 'step_started' }> = {
        type: 'step_started',
        step_id: stringField(event, 'step_id'),
        label: stringField(event, 'label'),
      }
      if (event.tool !== undefined) parsed.tool = stringField(event, 'tool')
      if (event.started_at !== undefined) parsed.started_at = stringField(event, 'started_at')
      if (event.args !== undefined) parsed.args = jsonObjectField(event, 'args')
      return parsed
    }
    case 'step_completed':
      exactKeys(event, ['type', 'step_id', 'duration_ms'])
      return { type: 'step_completed', step_id: stringField(event, 'step_id'), duration_ms: durationField(event) }
    case 'step_failed':
      exactKeys(event, ['type', 'step_id', 'error_code', 'message', 'retryable', 'duration_ms'])
      if (typeof event.retryable !== 'boolean') throw new AgentContractError('Invalid retryable')
      return {
        type: 'step_failed',
        step_id: stringField(event, 'step_id'),
        error_code: stringField(event, 'error_code'),
        message: stringField(event, 'message'),
        retryable: event.retryable,
        duration_ms: durationField(event),
      }
    case 'confirmation_required':
      exactKeys(event, ['type', 'step_id', 'message', 'confirmation_id'])
      return {
        type: 'confirmation_required',
        step_id: stringField(event, 'step_id'),
        message: stringField(event, 'message'),
        confirmation_id: stringField(event, 'confirmation_id'),
      }
    case 'action_completed':
      exactKeys(event, ['type', 'step_id', 'action', 'result', 'duration_ms'])
      return {
        type: 'action_completed',
        step_id: stringField(event, 'step_id'),
        action: stringField(event, 'action'),
        result: jsonObjectField(event, 'result'),
        duration_ms: durationField(event),
      }
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
