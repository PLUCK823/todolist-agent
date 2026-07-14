import type {
  AgentMessage,
  AgentReducerAction,
  AgentSessionState,
  AgentStep,
} from './agent.types'

export const initialAgentState: AgentSessionState = {
  messages: [],
  steps: [],
  status: 'idle',
  serverDone: true,
}

function updateStep(
  state: AgentSessionState,
  stepId: string,
  update: (step: AgentStep) => AgentStep,
): AgentSessionState {
  const index = state.steps.findIndex((step) => step.id === stepId)
  if (index < 0) return state
  const steps = [...state.steps]
  steps[index] = update(steps[index])
  return { ...state, steps }
}

function appendReply(state: AgentSessionState, content: string): AgentSessionState {
  if (state.activeAssistantMessageId) {
    return {
      ...state,
      messages: state.messages.map((message) => message.id === state.activeAssistantMessageId
        ? { ...message, content: message.content + content }
        : message),
    }
  }
  const message: AgentMessage = {
    id: `assistant-${state.messages.length + 1}`,
    role: 'assistant',
    content,
    createdAt: state.messages.at(-1)?.createdAt ?? '',
  }
  return {
    ...state,
    messages: [...state.messages, message],
    activeAssistantMessageId: message.id,
  }
}

export function reduceAgent(
  state: AgentSessionState,
  action: AgentReducerAction,
): AgentSessionState {
  switch (action.type) {
    case 'request_started':
      return {
        ...state,
        sessionId: action.sessionId,
        messages: [...state.messages, {
          id: action.messageId,
          role: 'user',
          content: action.message,
          createdAt: action.createdAt,
        }],
        steps: [],
        status: 'connecting',
        serverDone: false,
        pendingConfirmation: undefined,
        activeAssistantMessageId: undefined,
        lastRequest: action.message,
      }
    case 'connected':
      return { ...state, status: 'running' }
    case 'retry_started':
      return {
        ...state,
        status: 'connecting',
        serverDone: false,
        steps: state.steps.map((step) => step.id === action.stepId
          ? { ...step, status: 'waiting', errorCode: undefined, errorMessage: undefined }
          : step),
      }
    case 'step_started': {
      const step: AgentStep = {
        id: action.step_id,
        label: action.label,
        status: 'running',
        tool: action.tool,
        args: action.args,
        startedAt: action.started_at,
      }
      const index = state.steps.findIndex((candidate) => candidate.id === action.step_id)
      if (index < 0) return { ...state, steps: [...state.steps, step], status: 'running' }
      const steps = [...state.steps]
      steps[index] = step
      return { ...state, steps, status: 'running' }
    }
    case 'step_completed':
      return updateStep(state, action.step_id, (step) => ({
        ...step, status: 'completed', durationMs: action.duration_ms,
      }))
    case 'step_failed': {
      const failed = updateStep(state, action.step_id, (step) => ({
        ...step,
        status: 'failed',
        errorCode: action.error_code,
        errorMessage: action.message,
        retryable: action.retryable,
        retryToken: action.retry_token,
        durationMs: action.duration_ms,
      }))
      return failed === state ? state : { ...failed, status: 'failed' }
    }
    case 'confirmation_required': {
      const waiting = updateStep(state, action.step_id, (step) => ({
        ...step,
        status: 'waiting_confirmation',
        confirmationId: action.confirmation_id,
        confirmationMessage: action.message,
      }))
      if (waiting === state) return state
      return {
        ...waiting,
        status: 'waiting_confirmation',
        pendingConfirmation: {
          stepId: action.step_id,
          confirmationId: action.confirmation_id,
          message: action.message,
        },
      }
    }
    case 'confirmation_submitted':
      return state.pendingConfirmation
        ? { ...state, status: 'running', pendingConfirmation: undefined }
        : state
    case 'action_completed': {
      const completed = updateStep(state, action.step_id, (step) => ({
        ...step,
        status: 'completed',
        action: action.action,
        result: action.result,
        durationMs: action.duration_ms,
      }))
      return completed === state ? state : {
        ...completed,
        status: 'running',
        pendingConfirmation: completed.pendingConfirmation?.stepId === action.step_id
          ? undefined
          : completed.pendingConfirmation,
      }
    }
    case 'reply':
      return appendReply(state, action.content)
    case 'done':
      return {
        ...state,
        status: state.steps.some((step) => step.status === 'failed') ? 'failed' : 'done',
        serverDone: true,
        pendingConfirmation: undefined,
        activeAssistantMessageId: undefined,
      }
    case 'client_failed': {
      const connectionStep: AgentStep = {
        id: 'client-connection',
        label: '连接智能助手',
        status: 'failed',
        errorCode: action.failure.code,
        errorMessage: action.failure.message,
        retryable: action.failure.retryable,
      }
      const withoutOldConnection = state.steps.filter((step) => step.id !== connectionStep.id)
      return {
        ...state,
        status: 'failed',
        serverDone: false,
        steps: [...withoutOldConnection, connectionStep],
        pendingConfirmation: undefined,
        activeAssistantMessageId: undefined,
      }
    }
    case 'cancelled':
      return {
        ...state,
        status: 'idle',
        serverDone: false,
        pendingConfirmation: undefined,
        activeAssistantMessageId: undefined,
      }
    case 'clear':
      return initialAgentState
  }
}
