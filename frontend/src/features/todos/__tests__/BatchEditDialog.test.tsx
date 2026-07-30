import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { BatchEditDialog } from '../BatchEditDialog'

describe('BatchEditDialog', () => {
  it('requires an opted-in field', async () => {
    const user = userEvent.setup()
    render(<BatchEditDialog open count={3} pending={false} onOpenChange={vi.fn()} onSubmit={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: '应用修改' }))
    expect(screen.getByRole('alert')).toHaveTextContent('至少选择一个')
  })

  it('submits only opted-in fields', async () => {
    const user = userEvent.setup()
    const submit = vi.fn().mockResolvedValue(undefined)
    render(<BatchEditDialog open count={2} pending={false} onOpenChange={vi.fn()} onSubmit={submit} />)
    await user.click(screen.getByRole('checkbox', { name: '修改优先级' }))
    await user.selectOptions(screen.getByLabelText('批量优先级'), 'high')
    await user.click(screen.getByRole('button', { name: '应用修改' }))
    expect(submit).toHaveBeenCalledWith({ priority: 'high' })
  })
})
