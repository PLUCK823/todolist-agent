import { fireEvent, render, screen } from '@testing-library/react'
import { useRef } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { getAgentScrollRevision, useAgentAutoScroll } from '../useAgentAutoScroll'

function Harness({ revision }: { revision: string }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const endRef = useRef<HTMLSpanElement>(null)
  const onScroll = useAgentAutoScroll(containerRef, endRef, revision)
  return <div ref={containerRef} data-testid="scroll" onScroll={onScroll}><span ref={endRef}>end</span></div>
}

describe('useAgentAutoScroll', () => {
  it('follows only near the bottom and respects reduced motion', () => {
    const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView')
    const view = render(<Harness revision="one" />)
    const container = screen.getByTestId('scroll')
    Object.defineProperties(container, {
      scrollHeight: { configurable: true, value: 500 },
      clientHeight: { configurable: true, value: 100 },
      scrollTop: { configurable: true, writable: true, value: 100 },
    })
    scrollIntoView.mockClear()
    fireEvent.scroll(container)
    view.rerender(<Harness revision="two" />)
    expect(scrollIntoView).not.toHaveBeenCalled()

    container.scrollTop = 360
    fireEvent.scroll(container)
    view.rerender(<Harness revision="three" />)
    expect(scrollIntoView).toHaveBeenLastCalledWith({ behavior: 'smooth', block: 'end' })

    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })))
    view.rerender(<Harness revision="four" />)
    expect(scrollIntoView).toHaveBeenLastCalledWith({ behavior: 'auto', block: 'end' })
    vi.unstubAllGlobals()
  })

  it('follows streamed reply chunks when the last message keeps the same id', () => {
    const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView')
    function Stream({ content }: { content: string }) {
      const containerRef = useRef<HTMLDivElement>(null)
      const endRef = useRef<HTMLSpanElement>(null)
      const revision = getAgentScrollRevision({
        status: 'running', steps: [], messages: [{ id: 'same', role: 'assistant', content, createdAt: '2026-07-14T00:00:00Z' }],
      })
      const onScroll = useAgentAutoScroll(containerRef, endRef, revision)
      return <div ref={containerRef} onScroll={onScroll}><span ref={endRef} /></div>
    }
    const view = render(<Stream content="部分" />)
    scrollIntoView.mockClear()
    view.rerender(<Stream content="部分流式追加" />)
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'end' })
  })
})
