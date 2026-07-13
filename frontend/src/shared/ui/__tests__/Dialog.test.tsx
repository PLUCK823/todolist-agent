import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
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

function StackedDialogHarness() {
  const [bottomOpen, setBottomOpen] = useState(false)
  const [topOpen, setTopOpen] = useState(false)

  return (
    <>
      <button type="button" onClick={() => setBottomOpen(true)}>
        打开底层
      </button>
      <button type="button" onClick={() => setBottomOpen(false)}>
        程序关闭底层
      </button>
      <Dialog open={bottomOpen} title="底层" onOpenChange={setBottomOpen}>
        <button type="button" onClick={() => setTopOpen(true)}>
          打开顶层
        </button>
      </Dialog>
      <Dialog open={topOpen} title="顶层" onOpenChange={setTopOpen}>
        <button type="button">顶层操作</button>
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
    const closeAction = screen.getByRole('button', { name: '关闭新建任务' })
    const input = screen.getByRole('textbox', { name: '任务名称' })
    const secondaryAction = screen.getByRole('button', { name: '稍后处理' })
    const saveAction = screen.getByRole('button', { name: '保存' })

    expect(dialog).toHaveFocus()

    await user.tab()
    expect(closeAction).toHaveFocus()

    await user.tab()
    expect(input).toHaveFocus()

    await user.tab({ shift: true })
    expect(closeAction).toHaveFocus()

    await user.tab({ shift: true })
    expect(saveAction).toHaveFocus()

    await user.tab()
    expect(closeAction).toHaveFocus()

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

  it('provides a named close button in its header', async () => {
    const user = userEvent.setup()
    render(<DialogHarness />)

    await user.click(screen.getByRole('button', { name: '打开' }))
    await user.click(screen.getByRole('button', { name: '关闭新建任务' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('only lets Escape close the top dialog and restores focus within the lower dialog', async () => {
    const user = userEvent.setup()
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'scroll'
    render(<StackedDialogHarness />)

    const outsideTrigger = screen.getByRole('button', { name: '打开底层' })
    await user.click(outsideTrigger)
    const topTrigger = screen.getByRole('button', { name: '打开顶层' })
    await user.click(topTrigger)

    expect(screen.getAllByRole('dialog')).toHaveLength(2)
    await user.keyboard('{Escape}')

    expect(screen.queryByRole('dialog', { name: '顶层' })).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: '底层' })).toBeInTheDocument()
    expect(topTrigger).toHaveFocus()
    expect(document.body.style.overflow).toBe('hidden')

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(outsideTrigger).toHaveFocus()
    expect(document.body.style.overflow).toBe('scroll')
    document.body.style.overflow = previousOverflow
  })

  it('keeps body scrolling locked until dialogs close in either order', async () => {
    const user = userEvent.setup()
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'scroll'

    const view = render(<StackedDialogHarness />)
    await user.click(screen.getByRole('button', { name: '打开底层' }))
    await user.click(screen.getByRole('button', { name: '打开顶层' }))
    expect(document.body.style.overflow).toBe('hidden')

    fireEvent.click(screen.getByRole('button', { name: '程序关闭底层' }))
    expect(screen.getByRole('dialog', { name: '顶层' })).toBeInTheDocument()
    expect(document.body.style.overflow).toBe('hidden')

    await user.click(screen.getByRole('button', { name: '关闭顶层' }))
    expect(document.body.style.overflow).toBe('scroll')

    view.unmount()
    document.body.style.overflow = previousOverflow
  })
})
