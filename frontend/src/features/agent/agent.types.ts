export type AgentEvent =
  | { type: 'step_started'; event_id?: string; step_id: string; label: string; tool?: string; args?: Record<string, unknown>; started_at?: string }
  | { type: 'step_completed'; event_id?: string; step_id: string; label?: string; tool?: string; args?: Record<string, unknown>; started_at?: string; duration_ms: number }
  | { type: 'step_failed'; event_id?: string; step_id: string; label?: string; tool?: string; args?: Record<string, unknown>; started_at?: string; error_code: string; message: string; retryable: boolean; retry_token?: string; duration_ms: number }
  | { type: 'confirmation_required'; event_id?: string; step_id: string; label?: string; tool?: string; args?: Record<string, unknown>; started_at?: string; message: string; confirmation_id: string }
  | { type: 'action_completed'; event_id?: string; step_id: string; label?: string; tool?: string; args?: Record<string, unknown>; started_at?: string; confirmation_approved?: boolean; action: string; result: Record<string, unknown>; duration_ms: number }
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
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  createdAt: string
}

export type AgentTurnStatus = 'running' | 'waiting_confirmation' | 'completed' | 'failed' | 'interrupted'

export interface AgentSessionSummary {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  lastMessageAt: string
}

export interface AgentStep {
  id: string
  eventId?: string
  label: string
  status: 'waiting' | 'running' | 'waiting_confirmation' | 'completed' | 'failed' | 'interrupted'
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
  result?: unknown
  resultPreview?: string
  resultTruncated?: boolean
  confirmationApproved?: boolean
  completedAt?: string
}

export interface AgentTurn {
  id: string
  ordinal: number
  status: AgentTurnStatus
  startedAt: string
  completedAt?: string
  failureCode?: string
  failureMessage?: string
  resultUncertain: boolean
  messages: AgentMessage[]
  steps: AgentStep[]
}

export interface AgentSessionDetail extends AgentSessionSummary {
  turns: AgentTurn[]
}

export interface AgentSessionsApi {
  list(signal?: AbortSignal): Promise<AgentSessionSummary[]>
  create(input?: { title?: string; firstMessage?: string }, signal?: AbortSignal): Promise<AgentSessionSummary>
  detail(sessionId: string, signal?: AbortSignal): Promise<AgentSessionDetail>
  rename(sessionId: string, title: string, signal?: AbortSignal): Promise<AgentSessionSummary>
  delete(sessionId: string, signal?: AbortSignal): Promise<void>
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
  serverDone: boolean
  pendingConfirmation?: PendingConfirmation
  lastRequest?: string
  activeAssistantMessageId?: string
  resultUncertain?: boolean
}

export type AgentReducerAction = AgentEvent | {
  type: 'request_started'
  message: string
  sessionId: string
  messageId: string
  createdAt: string
  turnId?: string
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
  sessions: AgentSessionSummary[]
  selectedSessionId?: string
  displayedSessionId?: string
  turns: AgentTurn[]
  isHistoryLoading: boolean
  historyError?: string
  createSession(title?: string): Promise<void>
  selectSession(sessionId: string): void
  renameSession(sessionId: string, title: string): Promise<void>
  deleteSession(sessionId: string): Promise<void>
  reloadHistory(): Promise<void>
}
