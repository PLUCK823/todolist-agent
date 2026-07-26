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

interface EphemeralRetryCapability {
  eventId: string
  wireStepId: string
  retryToken: string
  sessionId: string
  streamGeneration: number
  ready: boolean
}

interface EphemeralConfirmationCapability {
  send: AgentControlSender
  sessionId: string
  streamGeneration: number
}

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
  const [hasReadyRetryCapability, setHasReadyRetryCapability] = useState(false)
  const sessionsRef = useRef<AgentSessionSummary[]>([])
  const stateRef = useRef(state)
  const cancelRef = useRef<(() => void) | undefined>(undefined)
  const controlRef = useRef<EphemeralConfirmationCapability | undefined>(undefined)
  const generationRef = useRef(0)
  const clearingRef = useRef(false)
  const clearPromiseRef = useRef<Promise<void> | undefined>(undefined)
  const mountedRef = useRef(true)
  const turnsRef = useRef<AgentTurn[]>([])
  const selectedRef = useRef<string | undefined>(undefined)
  const historyGenerationRef = useRef(0)
  const historyAbortRef = useRef<AbortController | undefined>(undefined)
  const listGenerationRef = useRef(0)
  const listAbortRef = useRef<AbortController | undefined>(undefined)
  const selectionGenerationRef = useRef(0)
  const syncGenerationRef = useRef(0)
  const syncAbortRef = useRef<AbortController | undefined>(undefined)
  const createPromiseRef = useRef<Promise<void> | undefined>(undefined)
  const deletedIdsRef = useRef(new Set<string>())
  const seenEventsRef = useRef(new Set<string>())
  const renameGenerationsRef = useRef(new Map<string, number>())
  const renameQueuesRef = useRef(new Map<string, Promise<void>>())
  const confirmedSessionsRef = useRef(new Map<string, AgentSessionSummary>())
  const deleteGenerationsRef = useRef(new Map<string, number>())
  const retryCapabilitiesRef = useRef(new Map<string, EphemeralRetryCapability>())

  const clearRetryCapabilities = useCallback(() => {
    retryCapabilitiesRef.current.clear()
    setHasReadyRetryCapability(false)
  }, [])

  const captureRetryCapability = useCallback((event: AgentReducerAction, sessionId: string, streamGeneration: number) => {
    if (event.type !== 'step_failed' || !event.retry_token) return
    const current = stateRef.current
    const failedStep = current.steps.find((step) => step.id === event.step_id)
    const toolSteps = current.steps.filter((step) => typeof step.tool === 'string')
    const safe = failedStep?.tool !== undefined
      && readOnlyRetryTools.has(failedStep.tool)
      && toolSteps.length > 0
      && toolSteps.every((step) => readOnlyRetryTools.has(step.tool!))
      && !current.steps.some((step) => step.status === 'completed' && Boolean(step.action))
    if (!safe) return
    retryCapabilitiesRef.current.set(event.event_id, {
      eventId: event.event_id,
      wireStepId: event.step_id,
      retryToken: event.retry_token,
      sessionId,
      streamGeneration,
      ready: false,
    })
  }, [])

  const updateSessions = useCallback((update: (current: AgentSessionSummary[]) => AgentSessionSummary[]) => {
    setSessions((current) => {
      const next = update(current).filter((item) => !deletedIdsRef.current.has(item.id))
      sessionsRef.current = next
      return next
    })
  }, [])

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
    if (durableHistory && 'event_id' in action) {
      const eventKey = `${action.event_id}:${action.type}`
      if (seenEventsRef.current.has(eventKey)) return false
      seenEventsRef.current.add(eventKey)
    }
    const next = reduceAgent(stateRef.current, action)
    stateRef.current = next
    setState(next)
    if (!durableHistory) return true
    if (action.type === 'request_started') {
      const active: AgentTurn = {
        id: action.turnId ?? `pending-${action.messageId}`,
        ordinal: turnsRef.current.length + 1,
        status: 'running', startedAt: action.createdAt, resultUncertain: false,
        messages: [next.messages.at(-1)!], steps: [],
      }
      commitTurns([...turnsRef.current, active])
      return true
    }
    const current = turnsRef.current.at(-1)
    if (!current) return true
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
    return true
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
      const detailSummary = {
        id: detail.id, title: detail.title, createdAt: detail.createdAt,
        updatedAt: detail.updatedAt, lastMessageAt: detail.lastMessageAt,
      }
      confirmedSessionsRef.current.set(sessionId, detailSummary)
      commitDetail(sessionId, detail.turns)
      updateSessions((current) => current.map((item) => item.id === sessionId ? {
        ...detailSummary,
      } : item))
    } catch (error) {
      if (!mountedRef.current || generation !== historyGenerationRef.current || controller.signal.aborted) return
      setHistoryError(error instanceof Error ? error.message : '加载会话失败')
    } finally {
      if (mountedRef.current && generation === historyGenerationRef.current) setIsHistoryLoading(false)
    }
  }, [commitDetail, sessionsApi, updateSessions])

  const selectSession = useCallback((sessionId: string) => {
    if (!sessions.some((item) => item.id === sessionId) || deletedIdsRef.current.has(sessionId)) return
    generationRef.current++
    closeStream()
    clearRetryCapabilities()
    selectionGenerationRef.current++
    selectedRef.current = sessionId
    setSelectedSessionId(sessionId)
    if (displayedSessionId === sessionId && !historyError) {
      historyGenerationRef.current++
      historyAbortRef.current?.abort()
      setIsHistoryLoading(false)
      return
    }
    void loadDetail(sessionId)
  }, [clearRetryCapabilities, closeStream, displayedSessionId, historyError, loadDetail, sessions])

  const loadSessions = useCallback(async (): Promise<void> => {
    const generation = ++listGenerationRef.current
    listAbortRef.current?.abort()
    const controller = new AbortController()
    listAbortRef.current = controller
    setIsHistoryLoading(true)
    setHistoryError(undefined)
    try {
      const listed = await sessionsApi.list(controller.signal)
      if (!mountedRef.current || generation !== listGenerationRef.current) return
      const visible = listed.filter((item) => !deletedIdsRef.current.has(item.id))
      for (const item of visible) confirmedSessionsRef.current.set(item.id, item)
      sessionsRef.current = visible
      setSessions(visible)
      const target = visible.some((item) => item.id === selectedRef.current)
        ? selectedRef.current
        : visible[0]?.id
      if (selectedRef.current !== target) selectionGenerationRef.current++
      selectedRef.current = target
      setSelectedSessionId(target)
      if (target) await loadDetail(target)
      else setIsHistoryLoading(false)
    } catch (error) {
      if (!mountedRef.current || generation !== listGenerationRef.current || controller.signal.aborted) return
      setHistoryError(error instanceof Error ? error.message : '加载会话失败')
      setIsHistoryLoading(false)
    }
  }, [loadDetail, sessionsApi])

  const cancelSessionList = useCallback(() => {
    listGenerationRef.current++
    listAbortRef.current?.abort()
  }, [])

  const syncDurableSession = useCallback(async (
    sessionId: string,
    expectedSelectionGeneration: number,
    sourceStreamGeneration: number,
  ): Promise<void> => {
    const generation = ++syncGenerationRef.current
    syncAbortRef.current?.abort()
    const controller = new AbortController()
    syncAbortRef.current = controller
    setIsHistoryLoading(true)
    setHistoryError(undefined)
    const isCurrentOperation = () => mountedRef.current
      && !controller.signal.aborted
      && generation === syncGenerationRef.current
      && selectionGenerationRef.current === expectedSelectionGeneration
      && selectedRef.current === sessionId
    try {
      const [detail, listed] = await Promise.all([
        sessionsApi.detail(sessionId, controller.signal),
        sessionsApi.list(controller.signal),
      ])
      if (!isCurrentOperation()) return
      const visible = listed.filter((item) => !deletedIdsRef.current.has(item.id))
      for (const item of visible) confirmedSessionsRef.current.set(item.id, item)
      sessionsRef.current = visible
      setSessions(visible)
      commitDetail(sessionId, detail.turns)
      const latest = detail.turns.at(-1)
      const failedEventIds = new Set(latest?.steps
        .filter((step) => step.status === 'failed')
        .map((step) => step.eventId) ?? [])
      const nextCapabilities = new Map<string, EphemeralRetryCapability>()
      for (const capability of retryCapabilitiesRef.current.values()) {
        const ready = capability.sessionId === sessionId
          && capability.streamGeneration === sourceStreamGeneration
          && latest?.resultUncertain === false
          && failedEventIds.has(capability.eventId)
        if (ready) nextCapabilities.set(capability.eventId, { ...capability, ready: true })
        else if (capability.streamGeneration !== sourceStreamGeneration) nextCapabilities.set(capability.eventId, capability)
      }
      retryCapabilitiesRef.current = nextCapabilities
      setHasReadyRetryCapability([...nextCapabilities.values()].some((capability) => capability.ready))
    } catch (error) {
      if (!isCurrentOperation()) return
      setHistoryError(error instanceof Error ? error.message : '同步会话失败')
    } finally {
      if (isCurrentOperation()) setIsHistoryLoading(false)
    }
  }, [commitDetail, sessionsApi])

  const reloadHistory = useCallback(async () => {
    if (selectedRef.current) await loadDetail(selectedRef.current)
    else await loadSessions()
  }, [loadDetail, loadSessions])

  const createSession = useCallback((title?: string): Promise<void> => {
    if (createPromiseRef.current) return createPromiseRef.current
    const selectionAtStart = selectedRef.current
    const historyGeneration = historyGenerationRef.current
    const operation = (async () => {
      const created = await sessionsApi.create(title ? { title } : {})
      if (!mountedRef.current || deletedIdsRef.current.has(created.id)) return
      confirmedSessionsRef.current.set(created.id, created)
      updateSessions((current) => [created, ...current.filter((item) => item.id !== created.id)])
      if (selectedRef.current !== selectionAtStart || historyGenerationRef.current !== historyGeneration) return
      selectionGenerationRef.current++
      clearRetryCapabilities()
      selectedRef.current = created.id
      setSelectedSessionId(created.id)
      await loadDetail(created.id)
    })().finally(() => {
      if (createPromiseRef.current === operation) createPromiseRef.current = undefined
    })
    createPromiseRef.current = operation
    return operation
  }, [clearRetryCapabilities, loadDetail, sessionsApi, updateSessions])

  const renameSession = useCallback(async (sessionId: string, title: string): Promise<void> => {
    if (deletedIdsRef.current.has(sessionId)) return
    const generation = (renameGenerationsRef.current.get(sessionId) ?? 0) + 1
    renameGenerationsRef.current.set(sessionId, generation)
    const current = sessionsRef.current.find((item) => item.id === sessionId)
    if (current && !confirmedSessionsRef.current.has(sessionId)) confirmedSessionsRef.current.set(sessionId, current)
    updateSessions((current) => current.map((item) => item.id === sessionId ? { ...item, title } : item))
    const previousQueue = renameQueuesRef.current.get(sessionId) ?? Promise.resolve()
    const operation = previousQueue.then(async () => {
      if (deletedIdsRef.current.has(sessionId)) return
      try {
        const renamed = await sessionsApi.rename(sessionId, title)
        if (deletedIdsRef.current.has(sessionId)) return
        confirmedSessionsRef.current.set(sessionId, renamed)
        if (renameGenerationsRef.current.get(sessionId) === generation) {
          updateSessions((current) => current.map((item) => item.id === sessionId ? renamed : item))
        }
      } catch (error) {
        if (!deletedIdsRef.current.has(sessionId) && renameGenerationsRef.current.get(sessionId) === generation) {
          const confirmed = confirmedSessionsRef.current.get(sessionId)
          if (confirmed) updateSessions((current) => current.map((item) => item.id === sessionId ? confirmed : item))
        }
        throw error
      }
    })
    const tail = operation.then(() => undefined, () => undefined)
    renameQueuesRef.current.set(sessionId, tail)
    void tail.then(() => {
      if (renameQueuesRef.current.get(sessionId) === tail) renameQueuesRef.current.delete(sessionId)
    })
    return operation
  }, [sessionsApi, updateSessions])

  const deleteSession = useCallback(async (sessionId: string): Promise<void> => {
    if (deletedIdsRef.current.has(sessionId)) return
    if (selectedRef.current === sessionId) clearRetryCapabilities()
    const deleteGeneration = (deleteGenerationsRef.current.get(sessionId) ?? 0) + 1
    deleteGenerationsRef.current.set(sessionId, deleteGeneration)
    const orderToken = sessionsRef.current.map((item) => item.id)
    const previous = sessionsRef.current.find((item) => item.id === sessionId)
    deletedIdsRef.current.add(sessionId)
    confirmedSessionsRef.current.delete(sessionId)
    renameGenerationsRef.current.set(sessionId, (renameGenerationsRef.current.get(sessionId) ?? 0) + 1)
    const wasCurrent = selectedRef.current === sessionId
    updateSessions((current) => current)
    if (wasCurrent) {
      generationRef.current++
      closeStream()
      historyGenerationRef.current++
      historyAbortRef.current?.abort()
      setIsHistoryLoading(true)
    }
    try {
      await sessionsApi.delete(sessionId)
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 404)) {
        if (deleteGenerationsRef.current.get(sessionId) === deleteGeneration && deletedIdsRef.current.has(sessionId)) {
          deletedIdsRef.current.delete(sessionId)
          if (previous) confirmedSessionsRef.current.set(sessionId, previous)
          if (previous) updateSessions((current) => {
            if (current.some((item) => item.id === sessionId)) return current
            const originalIndex = orderToken.indexOf(sessionId)
            for (let index = originalIndex - 1; index >= 0; index--) {
              const previousIndex = current.findIndex((item) => item.id === orderToken[index])
              if (previousIndex >= 0) return [...current.slice(0, previousIndex + 1), previous, ...current.slice(previousIndex + 1)]
            }
            for (let index = originalIndex + 1; index < orderToken.length; index++) {
              const nextIndex = current.findIndex((item) => item.id === orderToken[index])
              if (nextIndex >= 0) return [...current.slice(0, nextIndex), previous, ...current.slice(nextIndex)]
            }
            return [...current, previous]
          })
          if (wasCurrent) setIsHistoryLoading(false)
        }
        throw error
      }
    }
    if (!mountedRef.current || deleteGenerationsRef.current.get(sessionId) !== deleteGeneration) return
    await loadSessions()
    if (!selectedRef.current) {
      setDisplayedSessionId(undefined)
      commitTurns([])
      stateRef.current = initialAgentState
      setState(initialAgentState)
      setIsHistoryLoading(false)
    }
  }, [clearRetryCapabilities, closeStream, commitTurns, loadSessions, sessionsApi, updateSessions])

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
      || stateRef.current.resultUncertain === true
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
    if (durableHistory) clearRetryCapabilities()
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
            const accepted = dispatch(event)
            if (accepted) captureRetryCapability(event, sessionId, generation)
            if (event.type === 'done') {
              const selectionGeneration = selectionGenerationRef.current
              invalidateRequest(generation)
              if (durableHistory && selectedRef.current === sessionId) {
                void syncDurableSession(sessionId, selectionGeneration, generation)
              }
            }
          },
          onFailure: (failure) => {
            if (!isCurrent()) return
            clearRetryCapabilities()
            dispatch({ type: 'client_failed', failure })
            invalidateRequest(generation)
          },
          onControlReady: (sendControl) => {
            if (isCurrent()) controlRef.current = { send: sendControl, sessionId, streamGeneration: generation }
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
  }, [captureRetryCapability, clearRetryCapabilities, client, closeStream, dispatch, dispatchSynchronousFailure, displayedSessionId, durableHistory, idFactory, invalidateRequest, isHistoryLoading, messageIdFactory, now, sessionIdFactory, syncDurableSession])

  const send = useCallback((message: string) => startRequest(message), [startRequest])

  const canRetry = useCallback((stepId: string) => {
    if (!durableHistory) return canRetryServerStep(stateRef.current, stepId)
    const step = stateRef.current.steps.find((candidate) => candidate.id === stepId)
    const capability = step?.eventId ? retryCapabilitiesRef.current.get(step.eventId) : undefined
    return capability?.ready === true
      && capability.sessionId === selectedRef.current
      && stateRef.current.serverDone
      && step?.status === 'failed'
      && stateRef.current.resultUncertain !== true
  }, [durableHistory])

  const retry = useCallback((stepId: string) => {
    const current = stateRef.current
    const step = current.steps.find((candidate) => candidate.id === stepId)
    const capability = durableHistory && step?.eventId ? retryCapabilitiesRef.current.get(step.eventId) : undefined
    if (durableHistory ? !canRetry(stepId) || !capability : !canRetryServerStep(current, stepId) || !step?.retryToken) return
    if (!current.sessionId) return
    const sessionId = current.sessionId
    const wireStepId = capability?.wireStepId ?? stepId
    const retryToken = capability?.retryToken ?? step!.retryToken!
    if (capability) clearRetryCapabilities()
    const generation = ++generationRef.current
    closeStream()
    dispatch({ type: 'retry_started', stepId })
    const isCurrent = () => mountedRef.current && generationRef.current === generation
    try {
      const cancelRequest = client.send(
        {
          type: 'retry_step',
          session_id: sessionId,
          step_id: wireStepId,
          retry_token: retryToken,
        },
        {
          onOpen: () => { if (isCurrent()) dispatch({ type: 'connected' }) },
          onEvent: (event) => {
            if (!isCurrent()) return
            const accepted = dispatch(event)
            if (accepted) captureRetryCapability(event, sessionId, generation)
            if (event.type === 'done') {
              const selectionGeneration = selectionGenerationRef.current
              invalidateRequest(generation)
              if (durableHistory && selectedRef.current === sessionId) {
                void syncDurableSession(sessionId, selectionGeneration, generation)
              }
            }
          },
          onFailure: (failure) => {
            if (!isCurrent()) return
            clearRetryCapabilities()
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
  }, [canRetry, captureRetryCapability, clearRetryCapabilities, client, closeStream, dispatch, dispatchSynchronousFailure, durableHistory, invalidateRequest, syncDurableSession])

  const canConfirm = useCallback((confirmationId: string) => {
    const current = stateRef.current
    const capability = controlRef.current
    if (!capability) return false
    return !clearingRef.current
      && current.status === 'waiting_confirmation'
      && current.resultUncertain !== true
      && current.pendingConfirmation?.confirmationId === confirmationId
      && Boolean(current.sessionId)
      && capability.sessionId === current.sessionId
      && capability.streamGeneration === generationRef.current
      && (!durableHistory || selectedRef.current === current.sessionId)
  }, [durableHistory])

  const resolveConfirmation = useCallback((confirmationId: string, approved: boolean): boolean => {
    if (!canConfirm(confirmationId)) return false
    const capability = controlRef.current
    if (!capability) return false
    let sent: boolean
    try {
      sent = capability.send({
        type: 'confirmation_response',
        confirmation_id: confirmationId,
        approved,
      })
    } catch {
      return false
    }
    if (!sent) return false
    dispatch({ type: 'confirmation_submitted' })
    return true
  }, [canConfirm, dispatch])

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
    clearRetryCapabilities()
    closeStream()
    dispatch({ type: 'cancelled' })
  }, [clearRetryCapabilities, closeStream, dispatch])

  const clear = useCallback((): Promise<void> => {
    clearRetryCapabilities()
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
  }, [clearRetryCapabilities, closeStream, deleteSession, dispatch, durableHistory, historyApi])

  const deactivateLifecycle = useCallback(() => {
    mountedRef.current = false
    generationRef.current++
    historyGenerationRef.current++
    historyAbortRef.current?.abort()
    cancelSessionList()
    syncGenerationRef.current++
    syncAbortRef.current?.abort()
    clearRetryCapabilities()
    closeStream()
  }, [cancelSessionList, clearRetryCapabilities, closeStream])

  useEffect(() => {
    if (!durableHistory) return
    let active = true
    void Promise.resolve().then(() => {
      if (active) return loadSessions()
      return undefined
    })
    return () => {
      active = false
      cancelSessionList()
    }
  }, [cancelSessionList, durableHistory, loadSessions])

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
        && (durableHistory
          ? hasReadyRetryCapability
          : state.steps.some((step) => typeof step.retryToken === 'string')),
    },
    canSend: !isClearing && state.serverDone && !activeStatuses.has(state.status)
      && state.resultUncertain !== true
      && (!durableHistory || (Boolean(selectedSessionId) && !isHistoryLoading && selectedSessionId === displayedSessionId)),
    isClearing,
    send,
    canRetry,
    retry,
    canConfirm,
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
