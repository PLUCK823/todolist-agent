import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ApiError } from '../../shared/api/authenticated-fetch'
import { agentHistoryApi, agentStreamClient } from './agent.api'
import { agentSessionsApi as defaultAgentSessionsApi } from './agent-history.api'
import { createUuid } from './agent.id'
import { initialAgentState, reduceAgent } from './agent.reducer'
import type {
  AgentControlSender,
  AgentHistoryApi,
  AgentReducerAction,
  AgentSessionState,
  AgentSessionValue,
  AgentSessionsApi,
  AgentSessionSummary,
  AgentTurn,
  AgentStreamClient,
} from './agent.types'

export interface UseAgentSessionOptions {
  client?: AgentStreamClient
  historyApi?: AgentHistoryApi
  idFactory?: () => string
  sessionIdFactory?: () => string
  messageIdFactory?: () => string
  now?: () => string
  sessionsApi?: AgentSessionsApi
}

const activeStatuses = new Set<AgentSessionState['status']>([
  'connecting', 'running', 'waiting_confirmation',
])

const readOnlyRetryTools = new Set(['list_todos', 'get_todo'])

export function canRetryServerStep(state: AgentSessionState, stepId: string): boolean {
  const failedStep = state.steps.find((step) => step.id === stepId)
  const toolSteps = state.steps.filter((step) => typeof step.tool === 'string')
  return state.status === 'failed'
    && state.resultUncertain !== true
    && state.serverDone
    && Boolean(state.sessionId)
    && failedStep?.status === 'failed'
    && failedStep.retryable === true
    && typeof failedStep.retryToken === 'string'
    && typeof failedStep.tool === 'string'
    && readOnlyRetryTools.has(failedStep.tool)
    && toolSteps.length > 0
    && toolSteps.every((step) => readOnlyRetryTools.has(step.tool!))
    && !state.steps.some((step) => step.status === 'completed' && Boolean(step.action))
}

export function useAgentSession(options: UseAgentSessionOptions = {}): AgentSessionValue {
  const client = options.client ?? agentStreamClient
  const historyApi = options.historyApi ?? agentHistoryApi
  const durableHistory = options.sessionsApi !== undefined || options.client === undefined
  const sessionsApi = options.sessionsApi ?? defaultAgentSessionsApi
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
  const [sessions, setSessions] = useState<AgentSessionSummary[]>([])
  const [selectedSessionId, setSelectedSessionId] = useState<string>()
  const [displayedSessionId, setDisplayedSessionId] = useState<string>()
  const [turns, setTurns] = useState<AgentTurn[]>([])
  const [isHistoryLoading, setIsHistoryLoading] = useState(durableHistory)
  const [historyError, setHistoryError] = useState<string>()
  const stateRef = useRef(state)
  const cancelRef = useRef<(() => void) | undefined>(undefined)
  const controlRef = useRef<AgentControlSender | undefined>(undefined)
  const generationRef = useRef(0)
  const clearingRef = useRef(false)
  const clearPromiseRef = useRef<Promise<void> | undefined>(undefined)
  const mountedRef = useRef(true)
  const turnsRef = useRef<AgentTurn[]>([])
  const selectedRef = useRef<string | undefined>(undefined)
  const historyGenerationRef = useRef(0)
  const historyAbortRef = useRef<AbortController | undefined>(undefined)
  const createPromiseRef = useRef<Promise<void> | undefined>(undefined)
  const deletedIdsRef = useRef(new Set<string>())
  const seenEventsRef = useRef(new Set<string>())
  const renameGenerationsRef = useRef(new Map<string, number>())

  const commitTurns = useCallback((next: AgentTurn[]) => {
    turnsRef.current = next
    setTurns(next)
  }, [])

  const stateFromTurns = useCallback((sessionId: string, nextTurns: AgentTurn[]): AgentSessionState => {
    const latest = nextTurns.at(-1)
    const status = !latest ? 'idle'
      : latest.status === 'completed' ? 'done'
        : latest.status === 'waiting_confirmation' ? 'waiting_confirmation'
          : latest.status === 'running' ? 'running' : 'failed'
    return {
      sessionId,
      messages: nextTurns.flatMap((turn) => turn.messages),
      steps: latest?.steps ?? [],
      status,
      serverDone: !latest || !['running', 'waiting_confirmation'].includes(latest.status),
      pendingConfirmation: latest?.steps.find((step) => step.status === 'waiting_confirmation' && step.confirmationId)
        ? (() => {
            const step = latest.steps.find((candidate) => candidate.status === 'waiting_confirmation' && candidate.confirmationId)!
            return { stepId: step.id, confirmationId: step.confirmationId!, message: step.confirmationMessage ?? '' }
          })()
        : undefined,
      resultUncertain: latest?.resultUncertain ?? false,
    }
  }, [])

  const dispatch = useCallback((action: AgentReducerAction) => {
    const next = reduceAgent(stateRef.current, action)
    stateRef.current = next
    setState(next)
    if (!durableHistory) return
    if (action.type === 'request_started') {
      const active: AgentTurn = {
        id: action.turnId ?? `pending-${action.messageId}`,
        ordinal: turnsRef.current.length + 1,
        status: 'running', startedAt: action.createdAt, resultUncertain: false,
        messages: [next.messages.at(-1)!], steps: [],
      }
      commitTurns([...turnsRef.current, active])
      return
    }
    const current = turnsRef.current.at(-1)
    if (!current) return
    if ('event_id' in action && action.event_id) {
      const eventKey = `${action.event_id}:${action.type}:${JSON.stringify(action)}`
      if (seenEventsRef.current.has(eventKey)) return
      seenEventsRef.current.add(eventKey)
    }
    const assistant = next.activeAssistantMessageId
      ? next.messages.find((message) => message.id === next.activeAssistantMessageId)
      : undefined
    const currentMessages = assistant
      ? [...current.messages.filter((message) => message.role !== 'assistant'), assistant]
      : current.messages
    const turnStatus = next.status === 'done' ? 'completed'
      : next.status === 'waiting_confirmation' ? 'waiting_confirmation'
        : next.status === 'failed' ? 'failed' : 'running'
    commitTurns([
      ...turnsRef.current.slice(0, -1),
      { ...current, messages: currentMessages, steps: next.steps, status: turnStatus },
    ])
  }, [commitTurns, durableHistory])

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

  const commitDetail = useCallback((sessionId: string, nextTurns: AgentTurn[]) => {
    const nextState = stateFromTurns(sessionId, nextTurns)
    stateRef.current = nextState
    setState(nextState)
    commitTurns(nextTurns)
    setDisplayedSessionId(sessionId)
    seenEventsRef.current.clear()
  }, [commitTurns, stateFromTurns])

  const loadDetail = useCallback(async (sessionId: string): Promise<void> => {
    const generation = ++historyGenerationRef.current
    historyAbortRef.current?.abort()
    const controller = new AbortController()
    historyAbortRef.current = controller
    setIsHistoryLoading(true)
    setHistoryError(undefined)
    try {
      const detail = await sessionsApi.detail(sessionId, controller.signal)
      if (!mountedRef.current || generation !== historyGenerationRef.current || selectedRef.current !== sessionId) return
      commitDetail(sessionId, detail.turns)
      setSessions((current) => current.map((item) => item.id === sessionId ? {
        id: detail.id, title: detail.title, createdAt: detail.createdAt,
        updatedAt: detail.updatedAt, lastMessageAt: detail.lastMessageAt,
      } : item))
    } catch (error) {
      if (!mountedRef.current || generation !== historyGenerationRef.current || controller.signal.aborted) return
      setHistoryError(error instanceof Error ? error.message : '加载会话失败')
    } finally {
      if (mountedRef.current && generation === historyGenerationRef.current) setIsHistoryLoading(false)
    }
  }, [commitDetail, sessionsApi])

  const selectSession = useCallback((sessionId: string) => {
    if (!sessions.some((item) => item.id === sessionId) || deletedIdsRef.current.has(sessionId)) return
    generationRef.current++
    closeStream()
    selectedRef.current = sessionId
    setSelectedSessionId(sessionId)
    if (displayedSessionId === sessionId && !historyError) {
      historyGenerationRef.current++
      historyAbortRef.current?.abort()
      setIsHistoryLoading(false)
      return
    }
    void loadDetail(sessionId)
  }, [closeStream, displayedSessionId, historyError, loadDetail, sessions])

  const reloadHistory = useCallback(async () => {
    if (selectedRef.current) await loadDetail(selectedRef.current)
  }, [loadDetail])

  const createSession = useCallback((title?: string): Promise<void> => {
    if (createPromiseRef.current) return createPromiseRef.current
    const selectionAtStart = selectedRef.current
    const historyGeneration = historyGenerationRef.current
    const operation = (async () => {
      const created = await sessionsApi.create(title ? { title } : {})
      if (!mountedRef.current || deletedIdsRef.current.has(created.id)) return
      setSessions((current) => [created, ...current.filter((item) => item.id !== created.id)])
      if (selectedRef.current !== selectionAtStart || historyGenerationRef.current !== historyGeneration) return
      selectedRef.current = created.id
      setSelectedSessionId(created.id)
      await loadDetail(created.id)
    })().finally(() => {
      if (createPromiseRef.current === operation) createPromiseRef.current = undefined
    })
    createPromiseRef.current = operation
    return operation
  }, [loadDetail, sessionsApi])

  const renameSession = useCallback(async (sessionId: string, title: string): Promise<void> => {
    if (deletedIdsRef.current.has(sessionId)) return
    const generation = (renameGenerationsRef.current.get(sessionId) ?? 0) + 1
    renameGenerationsRef.current.set(sessionId, generation)
    const previous = sessions.find((item) => item.id === sessionId)
    setSessions((current) => current.map((item) => item.id === sessionId ? { ...item, title } : item))
    try {
      const renamed = await sessionsApi.rename(sessionId, title)
      if (deletedIdsRef.current.has(sessionId) || renameGenerationsRef.current.get(sessionId) !== generation) return
      setSessions((current) => current.map((item) => item.id === sessionId ? renamed : item))
    } catch (error) {
      if (previous && !deletedIdsRef.current.has(sessionId) && renameGenerationsRef.current.get(sessionId) === generation) {
        setSessions((current) => current.map((item) => item.id === sessionId ? previous : item))
      }
      throw error
    }
  }, [sessions, sessionsApi])

  const deleteSession = useCallback(async (sessionId: string): Promise<void> => {
    if (deletedIdsRef.current.has(sessionId)) return
    deletedIdsRef.current.add(sessionId)
    renameGenerationsRef.current.set(sessionId, (renameGenerationsRef.current.get(sessionId) ?? 0) + 1)
    const wasCurrent = selectedRef.current === sessionId
    const remaining = sessions.filter((item) => item.id !== sessionId)
    setSessions(remaining)
    if (wasCurrent) {
      generationRef.current++
      closeStream()
      historyGenerationRef.current++
      historyAbortRef.current?.abort()
    }
    try {
      await sessionsApi.delete(sessionId)
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 404)) {
        deletedIdsRef.current.delete(sessionId)
        setSessions(sessions)
        throw error
      }
    }
    if (!wasCurrent || !mountedRef.current) return
    const next = remaining[0]
    selectedRef.current = next?.id
    setSelectedSessionId(next?.id)
    if (next) await loadDetail(next.id)
    else {
      setDisplayedSessionId(undefined)
      commitTurns([])
      stateRef.current = initialAgentState
      setState(initialAgentState)
      setIsHistoryLoading(false)
    }
  }, [closeStream, commitTurns, loadDetail, sessions, sessionsApi])

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
    if (!trimmed
      || clearingRef.current
      || (durableHistory && (isHistoryLoading || selectedRef.current !== displayedSessionId))
      || !stateRef.current.serverDone
      || activeStatuses.has(stateRef.current.status)) return false
    let sessionId: string
    let messageId: string
    let createdAt: string
    try {
      sessionId = durableHistory ? selectedRef.current! : (stateRef.current.sessionId ?? sessionIdFactory())
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
      turnId: durableHistory ? idFactory() : undefined,
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
            if (event.type === 'done') {
              invalidateRequest(generation)
              if (durableHistory && selectedRef.current === sessionId) void loadDetail(sessionId)
            }
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
  }, [client, closeStream, dispatch, dispatchSynchronousFailure, displayedSessionId, durableHistory, idFactory, invalidateRequest, isHistoryLoading, loadDetail, messageIdFactory, now, sessionIdFactory])

  const send = useCallback((message: string) => startRequest(message), [startRequest])

  const canRetry = useCallback((stepId: string) => (
    canRetryServerStep(stateRef.current, stepId)
  ), [])

  const retry = useCallback((stepId: string) => {
    const current = stateRef.current
    const step = current.steps.find((candidate) => candidate.id === stepId)
    if (!canRetryServerStep(current, stepId) || !current.sessionId || !step?.retryToken) return
    const generation = ++generationRef.current
    closeStream()
    dispatch({ type: 'retry_started', stepId })
    const isCurrent = () => mountedRef.current && generationRef.current === generation
    try {
      const cancelRequest = client.send(
        {
          type: 'retry_step',
          session_id: current.sessionId,
          step_id: stepId,
          retry_token: step.retryToken,
        },
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
  }, [client, closeStream, dispatch, dispatchSynchronousFailure, invalidateRequest])

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
    if (durableHistory && selectedRef.current) return deleteSession(selectedRef.current)
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
  }, [closeStream, deleteSession, dispatch, durableHistory, historyApi])

  const deactivateLifecycle = useCallback(() => {
    mountedRef.current = false
    generationRef.current++
    historyGenerationRef.current++
    historyAbortRef.current?.abort()
    closeStream()
  }, [closeStream])

  useEffect(() => {
    if (!durableHistory) return
    const controller = new AbortController()
    let active = true
    void sessionsApi.list(controller.signal).then((listed) => {
      if (!active || !mountedRef.current) return
      const visible = listed.filter((item) => !deletedIdsRef.current.has(item.id))
      setSessions(visible)
      const target = visible.some((item) => item.id === selectedRef.current)
        ? selectedRef.current
        : visible[0]?.id
      selectedRef.current = target
      setSelectedSessionId(target)
      if (target) return loadDetail(target)
      setIsHistoryLoading(false)
      return undefined
    }).catch((error: unknown) => {
      if (!active || controller.signal.aborted) return
      setHistoryError(error instanceof Error ? error.message : '加载会话失败')
      setIsHistoryLoading(false)
    })
    return () => { active = false; controller.abort() }
  }, [durableHistory, loadDetail, sessionsApi])

  useEffect(() => {
    mountedRef.current = true
    return deactivateLifecycle
  }, [deactivateLifecycle])

  return {
    sessionId: state.sessionId,
    messages: state.messages,
    steps: state.steps,
    status: state.status,
    capabilities: {
      supportsStepRetry: state.serverDone
        && state.steps.some((step) => typeof step.retryToken === 'string'),
    },
    canSend: !isClearing && state.serverDone && !activeStatuses.has(state.status)
      && (!durableHistory || (Boolean(selectedSessionId) && !isHistoryLoading && selectedSessionId === displayedSessionId)),
    isClearing,
    send,
    canRetry,
    retry,
    confirm,
    reject,
    resolveConfirmation,
    cancel,
    clear,
    sessions,
    selectedSessionId,
    displayedSessionId,
    turns,
    isHistoryLoading,
    historyError,
    createSession,
    selectSession,
    renameSession,
    deleteSession,
    reloadHistory,
  }
}
