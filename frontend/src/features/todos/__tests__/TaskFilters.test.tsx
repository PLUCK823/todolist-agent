import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { TaskFilters } from '../TaskFilters'

describe('TaskFilters', () => {
  it('keeps status and priority in independent popovers and closes the other', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<TaskFilters filters={{}} onChange={onChange} />)

    await user.click(screen.getByRole('button', { name: '全部状态' }))
    expect(screen.getByRole('dialog', { name: '状态筛选' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: '优先级' }))
    expect(screen.queryByRole('dialog', { name: '状态筛选' })).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: '优先级筛选' })).toBeVisible()

    await user.click(screen.getByRole('button', { name: '高优先级' }))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ priority: 'high', page: 1 }))
  })

  it('exposes accessible search and sorting controls', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<TaskFilters filters={{}} onChange={onChange} />)

    expect(screen.getByRole('searchbox', { name: '搜索任务' })).toHaveAttribute('name', 'todo-search')

    await user.type(screen.getByRole('searchbox', { name: '搜索任务' }), '文档')
    await user.selectOptions(screen.getByLabelText('任务排序'), 'due_date:asc')

    expect(onChange).toHaveBeenCalled()
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ sort_by: 'due_date', order: 'asc', page: 1 }),
    )
  })

  it.each([
    ['全部状态', '全部状态', undefined],
    ['全部状态', '进行中', false],
    ['全部状态', '已完成', true],
  ] as const)('selects %s → %s', async (anchorName, optionName, completed) => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<TaskFilters filters={{}} onChange={onChange} />)
    await user.click(screen.getByRole('button', { name: anchorName }))
    const dialog = screen.getByRole('dialog', { name: '状态筛选' })
    await user.click(within(dialog).getByRole('button', { name: optionName }))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ completed, page: 1 }))
  })

  it.each([
    ['全部优先级', undefined],
    ['高优先级', 'high'],
    ['中优先级', 'medium'],
    ['低优先级', 'low'],
  ] as const)('selects the priority option %s', async (optionName, priority) => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<TaskFilters filters={{}} onChange={onChange} />)
    await user.click(screen.getByRole('button', { name: '优先级' }))
    await user.click(within(screen.getByRole('dialog', { name: '优先级筛选' })).getByRole('button', { name: optionName }))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ priority, page: 1 }))
  })

  it.each([
    [{ completed: false }, '进行中'],
    [{ completed: true }, '已完成'],
    [{ priority: 'high' as const }, '高优先级'],
    [{ priority: 'medium' as const }, '中优先级'],
    [{ priority: 'low' as const }, '低优先级'],
  ])('reflects the active filter %o in its trigger label', (filters, label) => {
    render(<TaskFilters filters={filters} onChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: label })).toBeVisible()
  })

  it.each([
    ['created_at:desc', 'created_at', 'desc'],
    ['due_date:asc', 'due_date', 'asc'],
    ['priority:desc', 'priority', 'desc'],
    ['priority:asc', 'priority', 'asc'],
  ] as const)('maps the sort value %s to query filters', async (option, sort_by, order) => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<TaskFilters filters={{}} onChange={onChange} />)
    await user.selectOptions(screen.getByLabelText('任务排序'), option)
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ sort_by, order, page: 1 }))
  })

  it('reports search text through the dedicated callback', async () => {
    const onKeywordChange = vi.fn()
    render(<TaskFilters filters={{}} onChange={vi.fn()} onKeywordChange={onKeywordChange} />)
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索任务' }), { target: { value: '文档' } })
    expect(onKeywordChange).toHaveBeenLastCalledWith('文档')
  })

  it('closes a popover with Escape and restores focus', async () => {
    const user = userEvent.setup()
    render(<TaskFilters filters={{}} onChange={vi.fn()} />)
    const trigger = screen.getByRole('button', { name: '优先级' })
    await user.click(trigger)
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: '优先级筛选' })).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('closes a popover when the pointer moves outside', async () => {
    const user = userEvent.setup()
    render(<TaskFilters filters={{}} onChange={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: '全部状态' }))
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('dialog', { name: '状态筛选' })).not.toBeInTheDocument()
  })
})
