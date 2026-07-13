import { fireEvent, render, screen } from '@testing-library/react'
import { useRef } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { useAgentAutoScroll } from '../useAgentAutoScroll'

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
})
