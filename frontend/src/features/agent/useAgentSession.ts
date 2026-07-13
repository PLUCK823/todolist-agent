import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { agentHistoryApi, agentStreamClient } from './agent.api'
import { initialAgentState, reduceAgent } from './agent.reducer'
import type {
  AgentClientControl,
  AgentHistoryApi,
  AgentReducerAction,
  AgentSessionState,
  AgentSessionValue,
  AgentStreamClient,
} from './agent.types'

export interface UseAgentSessionOptions {
  client?: AgentStreamClient
  historyApi?: AgentHistoryApi
  sessionIdFactory?: () => string
  messageIdFactory?: () => string
  now?: () => string
}

const activeStatuses = new Set<AgentSessionState['status']>([
  'connecting', 'running', 'waiting_confirmation',
])

export function useAgentSession(options: UseAgentSessionOptions = {}): AgentSessionValue {
  const client = options.client ?? agentStreamClient
  const historyApi = options.historyApi ?? agentHistoryApi
  const sessionIdFactory = useMemo(
    () => options.sessionIdFactory ?? (() => crypto.randomUUID()),
    [options.sessionIdFactory],
  )
  const messageIdFactory = useMemo(
    () => options.messageIdFactory ?? (() => crypto.randomUUID()),
    [options.messageIdFactory],
  )
  const now = useMemo(
    () => options.now ?? (() => new Date().toISOString()),
    [options.now],
  )
  const [state, setState] = useState<AgentSessionState>(initialAgentState)
  const stateRef = useRef(state)
  const cancelRef = useRef<(() => void) | undefined>(undefined)
  const controlRef = useRef<((control: AgentClientControl) => void) | undefined>(undefined)

  const dispatch = useCallback((action: AgentReducerAction) => {
    const next = reduceAgent(stateRef.current, action)
    stateRef.current = next
    setState(next)
  }, [])

  const startRequest = useCallback((message: string, isRetry = false) => {
    const trimmed = message.trim()
    if (!trimmed || (!isRetry && activeStatuses.has(stateRef.current.status))) return
    cancelRef.current?.()
    controlRef.current = undefined
    const sessionId = stateRef.current.sessionId ?? sessionIdFactory()
    dispatch(isRetry
      ? { type: 'retry_started', message: trimmed, sessionId }
      : {
          type: 'request_started',
          message: trimmed,
          sessionId,
          messageId: messageIdFactory(),
          createdAt: now(),
        })
    cancelRef.current = client.send(
      { message: trimmed, session_id: sessionId },
      {
        onOpen: () => dispatch({ type: 'connected' }),
        onEvent: (event) => dispatch(event),
        onFailure: (failure) => dispatch({ type: 'client_failed', failure }),
        onControlReady: (sendControl) => { controlRef.current = sendControl },
      },
    )
  }, [client, dispatch, messageIdFactory, now, sessionIdFactory])

  const send = useCallback((message: string) => startRequest(message), [startRequest])

  const retry = useCallback((stepId: string) => {
    const step = stateRef.current.steps.find((candidate) => candidate.id === stepId)
    if (step?.status !== 'failed' || !step.retryable || !stateRef.current.lastRequest) return
    startRequest(stateRef.current.lastRequest, true)
  }, [startRequest])

  const confirm = useCallback((confirmationId: string) => {
    if (stateRef.current.pendingConfirmation?.confirmationId !== confirmationId) return
    controlRef.current?.({
      type: 'confirmation_response',
      confirmation_id: confirmationId,
      approved: true,
    })
    dispatch({ type: 'confirmation_submitted' })
  }, [dispatch])

  const closeStream = useCallback(() => {
    cancelRef.current?.()
    cancelRef.current = undefined
    controlRef.current = undefined
  }, [])

  const cancel = useCallback(() => {
    closeStream()
    dispatch({ type: 'cancelled' })
  }, [closeStream, dispatch])

  const clear = useCallback(async () => {
    const currentSessionId = stateRef.current.sessionId
    closeStream()
    try {
      if (currentSessionId) await historyApi.clear(currentSessionId)
      dispatch({ type: 'clear' })
    } catch (error) {
      dispatch({
        type: 'client_failed',
        failure: {
          code: 'CONNECTION_CLOSED',
          message: error instanceof Error ? error.message : '清空对话记录失败',
          retryable: true,
        },
      })
      throw error
    }
  }, [closeStream, dispatch, historyApi])

  useEffect(() => () => closeStream(), [closeStream])

  return {
    sessionId: state.sessionId,
    messages: state.messages,
    steps: state.steps,
    status: state.status,
    send,
    retry,
    confirm,
    cancel,
    clear,
  }
}
