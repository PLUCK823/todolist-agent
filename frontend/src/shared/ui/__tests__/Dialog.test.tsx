import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { Dialog } from '../Dialog'

function DialogHarness() {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        打开
      </button>
      <Dialog
        open={open}
        title="新建任务"
        description="填写任务详情"
        onOpenChange={setOpen}
        footer={<button type="button">保存</button>}
      >
        <label>
          任务名称
          <input />
        </label>
        <button type="button">稍后处理</button>
      </Dialog>
    </>
  )
}

describe('Dialog', () => {
  it('traps Tab focus inside and restores focus to the trigger after Escape', async () => {
    const user = userEvent.setup()
    render(<DialogHarness />)

    const trigger = screen.getByRole('button', { name: '打开' })
    await user.click(trigger)

    const dialog = screen.getByRole('dialog', { name: '新建任务' })
    const input = screen.getByRole('textbox', { name: '任务名称' })
    const secondaryAction = screen.getByRole('button', { name: '稍后处理' })
    const saveAction = screen.getByRole('button', { name: '保存' })

    expect(dialog).toHaveFocus()

    await user.tab()
    expect(input).toHaveFocus()

    await user.tab({ shift: true })
    expect(saveAction).toHaveFocus()

    await user.tab()
    expect(input).toHaveFocus()

    secondaryAction.focus()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('closes when the backdrop is clicked', async () => {
    const user = userEvent.setup()
    render(<DialogHarness />)

    await user.click(screen.getByRole('button', { name: '打开' }))
    const dialog = screen.getByRole('dialog')
    const backdrop = dialog.parentElement
    expect(backdrop).not.toBeNull()

    await user.click(backdrop!)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
