import { useRef, useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Popover } from '../Popover'

function PopoverHarness() {
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLButtonElement>(null)

  return (
    <>
      <button ref={anchorRef} type="button" onClick={() => setOpen(true)}>
        筛选
      </button>
      <Popover
        open={open}
        anchorRef={anchorRef}
        onOpenChange={setOpen}
      >
        <button type="button">全部任务</button>
      </Popover>
      <button type="button">页面操作</button>
    </>
  )
}

function IdentifiedPopoverHarness() {
  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(true)
  const anchorRef = useRef<HTMLButtonElement>(null)

  return (
    <>
      <button
        ref={anchorRef}
        id="caller-filter"
        type="button"
        aria-haspopup="menu"
        aria-expanded="false"
        aria-controls="caller-menu"
        onClick={() => setOpen(true)}
      >
        自定义筛选
      </button>
      {mounted ? (
        <Popover open={open} anchorRef={anchorRef} onOpenChange={setOpen}>
          <button type="button">选项</button>
        </Popover>
      ) : null}
      <button type="button" onClick={() => setMounted(false)}>
        卸载浮层
      </button>
    </>
  )
}

describe('Popover', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('moves focus to the first available action when opened', async () => {
    const user = userEvent.setup()
    render(<PopoverHarness />)

    await user.click(screen.getByRole('button', { name: '筛选' }))
    expect(screen.getByRole('button', { name: '全部任务' })).toHaveFocus()
  })

  it('closes when Escape is pressed and restores focus to its anchor', async () => {
    const user = userEvent.setup()
    render(<PopoverHarness />)

    const anchor = screen.getByRole('button', { name: '筛选' })
    await user.click(anchor)
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(anchor).toHaveFocus()
  })

  it('closes on an outside pointer interaction', async () => {
    const user = userEvent.setup()
    render(<PopoverHarness />)

    await user.click(screen.getByRole('button', { name: '筛选' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '页面操作' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('names and links the dialog from the anchor', async () => {
    const user = userEvent.setup()
    render(<PopoverHarness />)

    const anchor = screen.getByRole('button', { name: '筛选' })
    expect(anchor).toHaveAttribute('aria-expanded', 'false')
    await user.click(anchor)

    const popover = screen.getByRole('dialog', { name: /筛选.*浮层/ })
    expect(anchor).toHaveAttribute('aria-expanded', 'true')
    expect(anchor).toHaveAttribute('aria-controls', popover.id)
  })

  it('flips, clamps, and recomputes its position on resize and captured scroll', async () => {
    const user = userEvent.setup()
    let anchorRect = rect({ left: 900, right: 940, top: 740, bottom: 780 })

    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(240)
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(180)
    vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(1000)
    vi.spyOn(document.documentElement, 'clientHeight', 'get').mockReturnValue(800)

    render(<PopoverHarness />)
    const anchor = screen.getByRole('button', { name: '筛选' })
    vi.spyOn(anchor, 'getBoundingClientRect').mockImplementation(() => anchorRect)

    await user.click(anchor)
    const popover = screen.getByRole('dialog')
    expect(popover).toHaveStyle({ left: '748px', top: '552px' })

    anchorRect = rect({ left: -40, right: 0, top: 50, bottom: 90 })
    fireEvent(window, new Event('resize'))
    expect(popover).toHaveStyle({ left: '12px', top: '98px' })

    anchorRect = rect({ left: 500, right: 540, top: -100, bottom: -60 })
    fireEvent.scroll(document)
    expect(popover).toHaveStyle({ left: '500px', top: '12px' })
  })

  it('preserves a caller-owned anchor id and restores only managed aria attributes', async () => {
    const user = userEvent.setup()
    render(<IdentifiedPopoverHarness />)

    const anchor = screen.getByRole('button', { name: '自定义筛选' })
    expect(anchor).toHaveAttribute('id', 'caller-filter')
    await user.click(anchor)

    const popover = screen.getByRole('dialog', { name: /自定义筛选.*浮层/ })
    expect(anchor).toHaveAttribute('id', 'caller-filter')
    expect(anchor).toHaveAttribute('aria-controls', popover.id)

    await user.click(screen.getByRole('button', { name: '卸载浮层' }))
    expect(anchor).toHaveAttribute('id', 'caller-filter')
    expect(anchor).toHaveAttribute('aria-haspopup', 'menu')
    expect(anchor).toHaveAttribute('aria-expanded', 'false')
    expect(anchor).toHaveAttribute('aria-controls', 'caller-menu')
  })
})

function rect({
  left,
  right,
  top,
  bottom,
}: Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'>): DOMRect {
  return {
    left,
    right,
    top,
    bottom,
    width: right - left,
    height: bottom - top,
    x: left,
    y: top,
    toJSON: () => ({}),
  }
}
