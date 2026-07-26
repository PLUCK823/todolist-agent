import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import AgentSessionList from '../AgentSessionList'
import type { AgentSessionSummary } from '../agent.types'

function session(id: string, title: string, lastMessageAt: Date): AgentSessionSummary {
  const timestamp = lastMessageAt.toISOString()
  return { id, title, createdAt: timestamp, updatedAt: timestamp, lastMessageAt: timestamp }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

const noopAsync = vi.fn().mockResolvedValue(undefined)

function renderList(overrides: Partial<React.ComponentProps<typeof AgentSessionList>> = {}) {
  const now = new Date(2026, 6, 26, 0, 15)
  const sessions = [
    session('today-1', '今天第一条', new Date(2026, 6, 26, 0, 10)),
    session('recent-1', '最近第一条', new Date(2026, 6, 24, 12, 0)),
    session('today-2', '今天第二条', new Date(2026, 6, 26, 0, 1)),
    session('boundary', '第七天边界', new Date(2026, 6, 20, 0, 0)),
    session('older', '更早记录', new Date(2026, 6, 19, 23, 59)),
  ]
  const props: React.ComponentProps<typeof AgentSessionList> = {
    sessions,
    selectedSessionId: 'today-1',
    isLoading: false,
    now,
    onSelect: vi.fn(),
    onCreate: noopAsync,
    onRetry: vi.fn(),
    onRename: noopAsync,
    onDelete: noopAsync,
    ...overrides,
  }
  return { ...render(<AgentSessionList {...props} />), props }
}

describe('AgentSessionList', () => {
  it('groups by local calendar boundaries and preserves server order within groups', () => {
    renderList()

    const today = screen.getByRole('group', { name: '今天' })
    const recent = screen.getByRole('group', { name: '最近 7 天' })
    const older = screen.getByRole('group', { name: '更早' })
    expect(within(today).getAllByRole('button', { name: /打开会话/ }).map((item) => item.textContent)).toEqual(['今天第一条', '今天第二条'])
    expect(within(recent).getAllByRole('button', { name: /打开会话/ }).map((item) => item.textContent)).toEqual(['最近第一条', '第七天边界'])
    expect(within(older).getAllByRole('button', { name: /打开会话/ }).map((item) => item.textContent)).toEqual(['更早记录'])
  })

  it('marks the current session and routes selection and creation', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    const onCreate = vi.fn().mockResolvedValue(undefined)
    renderList({ onSelect, onCreate })

    expect(screen.getByRole('button', { name: '打开会话：今天第一条' })).toHaveAttribute('aria-current', 'page')
    await user.click(screen.getByRole('button', { name: '打开会话：最近第一条' }))
    expect(onSelect).toHaveBeenCalledWith('recent-1')
    await user.click(screen.getByRole('button', { name: '新建会话' }))
    expect(onCreate).toHaveBeenCalledTimes(1)
  })

  it('retains the old list with busy disabled semantics and a non-disruptive status', () => {
    renderList({ isLoading: true })
    expect(screen.getByRole('navigation', { name: 'Agent 会话' })).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('status')).toHaveTextContent('正在加载会话')
    expect(screen.getByText('今天第一条')).toBeVisible()
    expect(screen.getByRole('button', { name: '打开会话：今天第一条' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '新建会话' })).toBeDisabled()
  })

  it('keeps sessions visible on list errors and provides an explicit retry', async () => {
    const user = userEvent.setup()
    const onRetry = vi.fn()
    renderList({ historyError: '加载会话失败', onRetry })
    expect(screen.getByRole('alert')).toHaveTextContent('加载会话失败')
    expect(screen.getByText('今天第一条')).toBeVisible()
    await user.click(screen.getByRole('button', { name: '重试加载会话' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('opens its named action popover by keyboard without selecting and restores focus on Escape', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    renderList({ onSelect })
    const trigger = screen.getByRole('button', { name: '打开“今天第一条”会话操作' })
    trigger.focus()
    await user.keyboard('{Enter}')
    expect(screen.getByRole('dialog', { name: '“今天第一条”会话操作' })).toBeVisible()
    expect(onSelect).not.toHaveBeenCalled()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: '“今天第一条”会话操作' })).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()

    await user.keyboard(' ')
    expect(screen.getByRole('dialog', { name: '“今天第一条”会话操作' })).toBeVisible()
  })

  it('validates and trims rename input, prefills the title, and prevents duplicate pending submits', async () => {
    const user = userEvent.setup()
    const pending = deferred<void>()
    const onRename = vi.fn().mockReturnValue(pending.promise)
    renderList({ onRename })
    await user.click(screen.getByRole('button', { name: '打开“今天第一条”会话操作' }))
    await user.click(within(screen.getByRole('dialog', { name: '“今天第一条”会话操作' })).getByRole('button', { name: '重命名会话' }))

    const dialog = screen.getByRole('dialog', { name: '重命名会话' })
    const input = within(dialog).getByRole('textbox', { name: '会话名称' })
    expect(input).toHaveValue('今天第一条')
    expect(input).toHaveFocus()
    await user.clear(input)
    await user.click(within(dialog).getByRole('button', { name: '保存名称' }))
    expect(within(dialog).getByRole('alert')).toHaveTextContent('请输入 1 到 160 个字符')
    expect(onRename).not.toHaveBeenCalled()

    await user.type(input, `  ${'新'.repeat(161)}  `)
    await user.click(within(dialog).getByRole('button', { name: '保存名称' }))
    expect(within(dialog).getByRole('alert')).toHaveTextContent('请输入 1 到 160 个字符')
    await user.clear(input)
    await user.type(input, '  新名称  ')
    const submit = within(dialog).getByRole('button', { name: '保存名称' })
    await user.click(submit)
    await user.click(submit)
    expect(onRename).toHaveBeenCalledTimes(1)
    expect(onRename).toHaveBeenCalledWith('today-1', '新名称')
    expect(submit).toBeDisabled()
    pending.resolve()
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '重命名会话' })).not.toBeInTheDocument())
  })

  it('keeps rename authoritative data and dialog open when the callback fails', async () => {
    const user = userEvent.setup()
    renderList({ onRename: vi.fn().mockRejectedValue(new Error('重命名保存失败')) })
    await user.click(screen.getByRole('button', { name: '打开“今天第一条”会话操作' }))
    await user.click(screen.getByRole('button', { name: '重命名会话' }))
    const input = screen.getByRole('textbox', { name: '会话名称' })
    await user.clear(input)
    await user.type(input, '临时名称')
    await user.click(screen.getByRole('button', { name: '保存名称' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('重命名保存失败')
    expect(screen.getByRole('dialog', { name: '重命名会话' })).toBeVisible()
    expect(screen.getByText('今天第一条')).toBeVisible()
  })

  it('describes deletion, initially focuses cancel, supports Escape, and prevents duplicate pending submits', async () => {
    const user = userEvent.setup()
    const pending = deferred<void>()
    const onDelete = vi.fn().mockReturnValue(pending.promise)
    renderList({ onDelete })
    await user.click(screen.getByRole('button', { name: '打开“今天第一条”会话操作' }))
    await user.click(screen.getByRole('button', { name: '删除会话' }))

    let dialog = screen.getByRole('dialog', { name: '删除会话' })
    expect(dialog).toHaveTextContent('将永久删除这段会话及其执行记录')
    expect(within(dialog).getByRole('button', { name: '取消删除' })).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: '删除会话' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '打开“今天第一条”会话操作' }))
    await user.click(screen.getByRole('button', { name: '删除会话' }))
    dialog = screen.getByRole('dialog', { name: '删除会话' })
    const confirm = within(dialog).getByRole('button', { name: '确认删除会话' })
    await user.click(confirm)
    await user.click(confirm)
    expect(onDelete).toHaveBeenCalledTimes(1)
    expect(onDelete).toHaveBeenCalledWith('today-1')
    expect(confirm).toBeDisabled()
    pending.resolve()
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '删除会话' })).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: '打开会话：最近第一条' })).toHaveFocus()
  })

  it('keeps delete confirmation open on failure and falls back to the new button when no sibling exists', async () => {
    const user = userEvent.setup()
    const only = session('only', '唯一会话', new Date(2026, 6, 26, 0, 1))
    const view = renderList({ sessions: [only], selectedSessionId: 'only', onDelete: vi.fn().mockRejectedValue(new Error('删除失败')) })
    await user.click(screen.getByRole('button', { name: '打开“唯一会话”会话操作' }))
    await user.click(screen.getByRole('button', { name: '删除会话' }))
    await user.click(screen.getByRole('button', { name: '确认删除会话' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('删除失败')
    expect(screen.getByText('唯一会话')).toBeVisible()

    view.rerender(<AgentSessionList {...view.props} onDelete={vi.fn().mockResolvedValue(undefined)} />)
    await user.click(screen.getByRole('button', { name: '确认删除会话' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '删除会话' })).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: '新建会话' })).toHaveFocus()
  })
})
