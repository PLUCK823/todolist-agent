import { useRef, useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
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

describe('Popover', () => {
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
})
