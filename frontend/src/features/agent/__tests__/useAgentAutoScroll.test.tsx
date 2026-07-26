import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PreferencesProvider } from '../../preferences/PreferencesContext'
import { getAgentScrollRevision, useAgentAutoScroll } from '../useAgentAutoScroll'

function Harness({
  revision,
  forceFollowKey = 'session-a',
  userMessageKey = 'user-1',
  messageKey = 'assistant-1',
}: {
  revision: string
  forceFollowKey?: string
  userMessageKey?: string
  messageKey?: string
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const endRef = useRef<HTMLSpanElement>(null)
  const autoScroll = useAgentAutoScroll(containerRef, endRef, revision, { forceFollowKey, userMessageKey, messageKey })
  return (
    <div>
      <div ref={containerRef} data-testid="scroll" onScroll={autoScroll.onScroll}>
        <div data-testid="content"><span ref={endRef}>end</span></div>
      </div>
      {autoScroll.showReturnToBottom ? (
        <button type="button" onClick={autoScroll.returnToBottom}>
          {autoScroll.hasNewMessage ? '有新消息，回到底部' : '回到底部'}
        </button>
      ) : null}
    </div>
  )
}

function setMetrics(container: HTMLElement, { top, height = 500, client = 100 }: { top: number; height?: number; client?: number }) {
  Object.defineProperties(container, {
    scrollHeight: { configurable: true, value: height },
    clientHeight: { configurable: true, value: client },
    scrollTop: { configurable: true, writable: true, value: top },
  })
}

describe('useAgentAutoScroll', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0)
      return 1
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('initially anchors the actual scroll container without calling marker.scrollIntoView', () => {
    const markerScroll = vi.spyOn(Element.prototype, 'scrollIntoView')
    render(<PreferencesProvider><Harness revision="initial" /></PreferencesProvider>)
    const container = screen.getByTestId('scroll')
    setMetrics(container, { top: 0 })

    act(() => { window.dispatchEvent(new Event('resize')) })

    expect(container.scrollTop).toBe(500)
    expect(markerScroll).not.toHaveBeenCalled()
  })

  it('follows reply updates near the bottom but does not steal position after the user scrolls away', () => {
    const view = render(<PreferencesProvider><Harness revision="reply-1" /></PreferencesProvider>)
    const container = screen.getByTestId('scroll')
    setMetrics(container, { top: 370 })
    fireEvent.scroll(container)
    view.rerender(<PreferencesProvider><Harness revision="reply-2" /></PreferencesProvider>)
    expect(container.scrollTop).toBe(500)

    container.scrollTop = 120
    fireEvent.scroll(container)
    view.rerender(<PreferencesProvider><Harness revision="reply-3" /></PreferencesProvider>)
    expect(container.scrollTop).toBe(120)
    expect(screen.getByRole('button', { name: '回到底部' })).toBeVisible()
  })

  it('announces a new message while far away and restores following when the button is clicked', async () => {
    vi.useRealTimers()
    const user = userEvent.setup()
    const view = render(<PreferencesProvider><Harness revision="assistant-short" userMessageKey="user-1" messageKey="assistant-1" /></PreferencesProvider>)
    const container = screen.getByTestId('scroll')
    setMetrics(container, { top: 80 })
    fireEvent.scroll(container)
    view.rerender(<PreferencesProvider><Harness revision="assistant-longer" userMessageKey="user-1" messageKey="assistant-2" /></PreferencesProvider>)
    expect(container.scrollTop).toBe(80)
    const button = screen.getByRole('button', { name: '有新消息，回到底部' })
    await user.click(button)
    expect(container.scrollTop).toBe(500)
    expect(screen.queryByRole('button', { name: /回到底部/ })).not.toBeInTheDocument()
  })

  it('forces the current user send and a completed session switch to the bottom even when previously far', () => {
    const view = render(<PreferencesProvider><Harness revision="old" forceFollowKey="session-a" userMessageKey="user-1" /></PreferencesProvider>)
    const container = screen.getByTestId('scroll')
    setMetrics(container, { top: 50 })
    fireEvent.scroll(container)

    view.rerender(<PreferencesProvider><Harness revision="sent" forceFollowKey="session-a" userMessageKey="user-2" /></PreferencesProvider>)
    expect(container.scrollTop).toBe(500)
    container.scrollTop = 50
    fireEvent.scroll(container)
    view.rerender(<PreferencesProvider><Harness revision="loaded" forceFollowKey="session-b" userMessageKey="user-2" /></PreferencesProvider>)
    expect(container.scrollTop).toBe(500)
  })

  it('observes layout changes only while following and cleans observers and queued frames', () => {
    let resize!: ResizeObserverCallback
    const observe = vi.fn()
    const disconnect = vi.fn()
    class ResizeObserverStub {
      constructor(callback: ResizeObserverCallback) { resize = callback }
      observe = observe
      disconnect = disconnect
    }
    vi.stubGlobal('ResizeObserver', ResizeObserverStub)
    const request = vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(42)
    const cancel = vi.spyOn(window, 'cancelAnimationFrame')
    const view = render(<PreferencesProvider><Harness revision="layout" /></PreferencesProvider>)
    const container = screen.getByTestId('scroll')
    setMetrics(container, { top: 380 })

    expect(observe).toHaveBeenCalledWith(container)
    expect(observe).toHaveBeenCalledWith(screen.getByTestId('content'))
    act(() => resize([], {} as ResizeObserver))
    expect(request).toHaveBeenCalled()
    view.unmount()
    expect(disconnect).toHaveBeenCalledTimes(1)
    expect(cancel).toHaveBeenCalledWith(42)
  })

  it('includes displayed session and streamed turn content in the revision', () => {
    const base = {
      status: 'running' as const,
      displayedSessionId: 'session-a',
      messages: [{ id: 'same', role: 'assistant' as const, content: '部分', createdAt: '2026-07-26T00:00:00Z' }],
      steps: [],
      turns: [{ id: 'turn-1', ordinal: 1, status: 'running' as const, startedAt: '2026-07-26T00:00:00Z', resultUncertain: false, messages: [], steps: [] }],
    }
    expect(getAgentScrollRevision(base)).not.toBe(getAgentScrollRevision({
      ...base,
      displayedSessionId: 'session-b',
      messages: [{ ...base.messages[0], content: '部分流式追加' }],
    }))
  })
})
