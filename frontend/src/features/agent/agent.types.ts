export type AgentEvent =
  | { type: 'step_started'; step_id: string; label: string; tool?: string; args?: Record<string, unknown>; started_at?: string }
  | { type: 'step_completed'; step_id: string; duration_ms: number }
  | { type: 'step_failed'; step_id: string; error_code: string; message: string; retryable: boolean; retry_token?: string; duration_ms: number }
  | { type: 'confirmation_required'; step_id: string; message: string; confirmation_id: string }
  | { type: 'action_completed'; step_id: string; action: string; result: Record<string, unknown>; duration_ms: number }
  | { type: 'reply'; content: string }
  | { type: 'done' }

export type AgentServerEvent = AgentEvent

export interface AgentMessageRequest {
  message: string
  session_id?: string
}

export interface AgentRetryRequest {
  type: 'retry_step'
  session_id: string
  step_id: string
  retry_token: string
}

export type AgentClientRequest = AgentMessageRequest | AgentRetryRequest

export type AgentClientControl = {
  type: 'confirmation_response'
  confirmation_id: string
  approved: boolean
}

export type AgentClientMessage = AgentClientRequest | AgentClientControl

export type AgentControlSender = (control: AgentClientControl) => boolean

export interface AgentFailure {
  code: 'CONNECTION_TIMEOUT' | 'CONNECTION_CLOSED' | 'SOCKET_ERROR' | 'INVALID_EVENT'
  message: string
  retryable: boolean
  closeCode?: number
  reason?: string
}

export interface AgentHandlers {
  onOpen?: () => void
  onEvent: (event: AgentEvent) => void
  onFailure?: (failure: AgentFailure) => void
  onControlReady?: (send: AgentControlSender) => void
}

export interface AgentStreamClient {
  send(input: AgentClientRequest, handlers: AgentHandlers): () => void
}

export type AgentSessionStatus =
  | 'idle'
  | 'connecting'
  | 'running'
  | 'waiting_confirmation'
  | 'failed'
  | 'done'

export interface AgentMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: string
}

export interface AgentStep {
  id: string
  label: string
  status: 'waiting' | 'running' | 'waiting_confirmation' | 'completed' | 'failed'
  tool?: string
  args?: Record<string, unknown>
  startedAt?: string
  durationMs?: number
  errorCode?: string
  errorMessage?: string
  retryable?: boolean
  retryToken?: string
  confirmationId?: string
  confirmationMessage?: string
  action?: string
  result?: Record<string, unknown>
}

export interface PendingConfirmation {
  stepId: string
  confirmationId: string
  message: string
}

export interface AgentSessionState {
  sessionId?: string
  messages: AgentMessage[]
  steps: AgentStep[]
  status: AgentSessionStatus
  pendingConfirmation?: PendingConfirmation
  lastRequest?: string
  activeAssistantMessageId?: string
}

export type AgentReducerAction = AgentEvent | {
  type: 'request_started'
  message: string
  sessionId: string
  messageId: string
  createdAt: string
} | {
  type: 'connected'
} | {
  type: 'retry_started'
  stepId: string
} | {
  type: 'confirmation_submitted'
} | {
  type: 'client_failed'
  failure: AgentFailure
} | {
  type: 'cancelled'
} | {
  type: 'clear'
}

export interface AgentHistoryApi {
  clear(sessionId: string): Promise<void>
}

export interface AgentCapabilities {
  supportsStepRetry: boolean
}

export interface AgentSessionValue {
  sessionId?: string
  messages: AgentMessage[]
  steps: AgentStep[]
  status: AgentSessionStatus
  capabilities: AgentCapabilities
  canSend: boolean
  isClearing: boolean
  send(message: string): boolean
  canRetry(stepId: string): boolean
  retry(stepId: string): void
  confirm(confirmationId: string): void
  reject(confirmationId: string): void
  resolveConfirmation(confirmationId: string, approved: boolean): void
  cancel(): void
  clear(): Promise<void>
}
