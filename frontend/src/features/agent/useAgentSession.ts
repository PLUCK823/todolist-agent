import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { agentHistoryApi, agentStreamClient } from './agent.api'
import { createUuid } from './agent.id'
import { initialAgentState, reduceAgent } from './agent.reducer'
import type {
  AgentControlSender,
  AgentHistoryApi,
  AgentReducerAction,
  AgentSessionState,
  AgentSessionValue,
  AgentStreamClient,
} from './agent.types'

export interface UseAgentSessionOptions {
  client?: AgentStreamClient
  historyApi?: AgentHistoryApi
  idFactory?: () => string
  sessionIdFactory?: () => string
  messageIdFactory?: () => string
  now?: () => string
}

const activeStatuses = new Set<AgentSessionState['status']>([
  'connecting', 'running', 'waiting_confirmation',
])

export const agentCapabilities = { supportsStepRetry: false } as const
const readOnlyRetryTools = new Set(['list_todos', 'get_todo'])

export function canRetryReadOnlyTurn(state: AgentSessionState, stepId: string): boolean {
  const failedStep = state.steps.find((step) => step.id === stepId)
  const toolSteps = state.steps.filter((step) => typeof step.tool === 'string')
  return state.status === 'failed'
    && Boolean(state.lastRequest)
    && failedStep?.status === 'failed'
    && failedStep.retryable === true
    && typeof failedStep.tool === 'string'
    && readOnlyRetryTools.has(failedStep.tool)
    && toolSteps.length > 0
    && toolSteps.every((step) => readOnlyRetryTools.has(step.tool!))
    && !state.steps.some((step) => step.status === 'completed' && Boolean(step.action))
}

export function useAgentSession(options: UseAgentSessionOptions = {}): AgentSessionValue {
  const client = options.client ?? agentStreamClient
  const historyApi = options.historyApi ?? agentHistoryApi
  const idFactory = useMemo(
    () => options.idFactory ?? createUuid,
    [options.idFactory],
  )
  const sessionIdFactory = useMemo(
    () => options.sessionIdFactory ?? idFactory,
    [idFactory, options.sessionIdFactory],
  )
  const messageIdFactory = useMemo(
    () => options.messageIdFactory ?? idFactory,
    [idFactory, options.messageIdFactory],
  )
  const now = useMemo(
    () => options.now ?? (() => new Date().toISOString()),
    [options.now],
  )
  const [state, setState] = useState<AgentSessionState>(initialAgentState)
  const [isClearing, setIsClearing] = useState(false)
  const stateRef = useRef(state)
  const cancelRef = useRef<(() => void) | undefined>(undefined)
  const controlRef = useRef<AgentControlSender | undefined>(undefined)
  const generationRef = useRef(0)
  const clearingRef = useRef(false)
  const clearPromiseRef = useRef<Promise<void> | undefined>(undefined)
  const mountedRef = useRef(true)

  const dispatch = useCallback((action: AgentReducerAction) => {
    const next = reduceAgent(stateRef.current, action)
    stateRef.current = next
    setState(next)
  }, [])

  const closeStream = useCallback(() => {
    cancelRef.current?.()
    cancelRef.current = undefined
    controlRef.current = undefined
  }, [])

  const invalidateRequest = useCallback((generation: number) => {
    if (generationRef.current !== generation) return
    generationRef.current++
    closeStream()
  }, [closeStream])

  const dispatchSynchronousFailure = useCallback((error: unknown) => {
    dispatch({
      type: 'client_failed',
      failure: {
        code: 'SOCKET_ERROR',
        message: error instanceof Error ? error.message : '智能助手初始化失败',
        retryable: false,
      },
    })
  }, [dispatch])

  const startRequest = useCallback((message: string): boolean => {
    const trimmed = message.trim()
    if (!trimmed || clearingRef.current || activeStatuses.has(stateRef.current.status)) return false
    let sessionId: string
    let messageId: string
    let createdAt: string
    try {
      sessionId = stateRef.current.sessionId ?? sessionIdFactory()
      messageId = messageIdFactory()
      createdAt = now()
    } catch (error) {
      dispatchSynchronousFailure(error)
      return false
    }

    const generation = ++generationRef.current
    closeStream()
    dispatch({
      type: 'request_started',
      message: trimmed,
      sessionId,
      messageId,
      createdAt,
    })
    const isCurrent = () => mountedRef.current && generationRef.current === generation
    try {
      const cancelRequest = client.send(
        { message: trimmed, session_id: sessionId },
        {
          onOpen: () => { if (isCurrent()) dispatch({ type: 'connected' }) },
          onEvent: (event) => {
            if (!isCurrent()) return
            dispatch(event)
            if (event.type === 'done') invalidateRequest(generation)
          },
          onFailure: (failure) => {
            if (!isCurrent()) return
            dispatch({ type: 'client_failed', failure })
            invalidateRequest(generation)
          },
          onControlReady: (sendControl) => {
            if (isCurrent()) controlRef.current = sendControl
          },
        },
      )
      if (isCurrent()) cancelRef.current = cancelRequest
      else cancelRequest()
    } catch (error) {
      if (isCurrent()) {
        dispatchSynchronousFailure(error)
        invalidateRequest(generation)
      }
    }
    return true
  }, [client, closeStream, dispatch, dispatchSynchronousFailure, invalidateRequest, messageIdFactory, now, sessionIdFactory])

  const send = useCallback((message: string) => startRequest(message), [startRequest])

  const canRetry = useCallback((stepId: string) => (
    canRetryReadOnlyTurn(stateRef.current, stepId)
  ), [])

  const retry = useCallback((stepId: string) => {
    const current = stateRef.current
    if (!canRetryReadOnlyTurn(current, stepId) || !current.lastRequest) return
    startRequest(current.lastRequest)
  }, [startRequest])

  const resolveConfirmation = useCallback((confirmationId: string, approved: boolean) => {
    if (clearingRef.current) return
    if (stateRef.current.pendingConfirmation?.confirmationId !== confirmationId) return
    const sent = controlRef.current?.({
      type: 'confirmation_response',
      confirmation_id: confirmationId,
      approved,
    })
    if (sent) dispatch({ type: 'confirmation_submitted' })
  }, [dispatch])

  const confirm = useCallback(
    (confirmationId: string) => resolveConfirmation(confirmationId, true),
    [resolveConfirmation],
  )

  const reject = useCallback(
    (confirmationId: string) => resolveConfirmation(confirmationId, false),
    [resolveConfirmation],
  )

  const cancel = useCallback(() => {
    if (clearingRef.current) return
    generationRef.current++
    closeStream()
    dispatch({ type: 'cancelled' })
  }, [closeStream, dispatch])

  const clear = useCallback((): Promise<void> => {
    if (clearPromiseRef.current) return clearPromiseRef.current
    const currentSessionId = stateRef.current.sessionId
    if (!currentSessionId) {
      generationRef.current++
      closeStream()
      dispatch({ type: 'clear' })
      return Promise.resolve()
    }
    const generation = ++generationRef.current
    clearingRef.current = true
    setIsClearing(true)
    closeStream()

    const operation = (async () => {
      try {
        if (currentSessionId) await historyApi.clear(currentSessionId)
        if (mountedRef.current && generationRef.current === generation) {
          dispatch({ type: 'clear' })
        }
      } catch (error) {
        if (mountedRef.current && generationRef.current === generation) {
          dispatch({
            type: 'client_failed',
            failure: {
              code: 'CONNECTION_CLOSED',
              message: error instanceof Error ? error.message : '清空对话记录失败',
              retryable: true,
            },
          })
        }
        throw error
      } finally {
        clearingRef.current = false
        if (mountedRef.current) setIsClearing(false)
        clearPromiseRef.current = undefined
      }
    })()
    clearPromiseRef.current = operation
    return operation
  }, [closeStream, dispatch, historyApi])

  const deactivateLifecycle = useCallback(() => {
    mountedRef.current = false
    generationRef.current++
    closeStream()
  }, [closeStream])

  useEffect(() => {
    mountedRef.current = true
    return deactivateLifecycle
  }, [deactivateLifecycle])

  return {
    sessionId: state.sessionId,
    messages: state.messages,
    steps: state.steps,
    status: state.status,
    capabilities: agentCapabilities,
    canSend: !isClearing && !activeStatuses.has(state.status),
    isClearing,
    send,
    canRetry,
    retry,
    confirm,
    reject,
    resolveConfirmation,
    cancel,
    clear,
  }
}
