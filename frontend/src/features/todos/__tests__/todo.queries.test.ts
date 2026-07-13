import { createElement, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { server } from '../../../mocks/server'
import { applyTodoCompletion, matchesNonCompletionFilters, restoreTodoCompletion, todoKeys, useCompleteTodo } from '../todo.queries'
import type { PaginatedData, Todo } from '../todo.types'

const active: Todo = { id: 1, title: 'active', description: '', priority: 'medium', completed: false, due_date: null, created_at: '', updated_at: '' }
const done: Todo = { ...active, id: 2, title: 'done', completed: true }
const page = (items: Todo[], total = items.length): PaginatedData<Todo> => ({ items, total, page: 1, page_size: 10 })

function seededClient() {
  const client = new QueryClient()
  client.setQueryData(todoKeys.list({ completed: false }), page([active], 1))
  client.setQueryData(todoKeys.list({ completed: true }), page([done], 1))
  client.setQueryData(todoKeys.list({}), page([active, done], 2))
  client.setQueryData(todoKeys.detail(1), active)
  return client
}

describe('optimistic todo completion cache', () => {
  it('mirrors repository keyword matching for title, case, and untrimmed input', () => {
    const described = { ...active, title: 'Plan Launch', description: 'secret phrase' }
    expect(matchesNonCompletionFilters(described, { keyword: 'LAUNCH' })).toBe(true)
    expect(matchesNonCompletionFilters(described, { keyword: 'secret' })).toBe(false)
    expect(matchesNonCompletionFilters(described, { keyword: ' Launch ' })).toBe(false)
  })

  it('removes a completed task from active filters and updates matching caches', () => {
    const client = seededClient()
    applyTodoCompletion(client, 1, true)
    expect(client.getQueryData<PaginatedData<Todo>>(todoKeys.list({ completed: false }))).toMatchObject({ items: [], total: 0 })
    expect(client.getQueryData<PaginatedData<Todo>>(todoKeys.list({ completed: true }))).toMatchObject({ items: [done], total: 2 })
    expect(client.getQueryData<PaginatedData<Todo>>(todoKeys.list({}))?.items[0]).toMatchObject({ id: 1, completed: true })
    expect(client.getQueryData<Todo>(todoKeys.detail(1))).toMatchObject({ completed: true })
  })

  it('removes an uncompleted task from completed filters without inventing rows', () => {
    const client = seededClient()
    client.setQueryData(todoKeys.detail(2), done)
    applyTodoCompletion(client, 2, false)
    expect(client.getQueryData<PaginatedData<Todo>>(todoKeys.list({ completed: true }))).toMatchObject({ items: [], total: 0 })
    expect(client.getQueryData<PaginatedData<Todo>>(todoKeys.list({ completed: false }))).toMatchObject({ items: [active], total: 2 })
  })

  it('adjusts both filtered totals even when the moving item is off-page', () => {
    const client = seededClient()
    client.setQueryData(todoKeys.list({ completed: false }), page([], 8))
    client.setQueryData(todoKeys.list({ completed: true }), page([], 4))
    applyTodoCompletion(client, 1, true)
    expect(client.getQueryData<PaginatedData<Todo>>(todoKeys.list({ completed: false }))).toMatchObject({ items: [], total: 7 })
    expect(client.getQueryData<PaginatedData<Todo>>(todoKeys.list({ completed: true }))).toMatchObject({ items: [], total: 5 })
  })

  it('does not change source or target totals when priority does not match', () => {
    const client = seededClient()
    client.setQueryData(todoKeys.list({ completed: false, priority: 'high' }), page([], 6))
    client.setQueryData(todoKeys.list({ completed: true, priority: 'high' }), page([], 3))
    applyTodoCompletion(client, 1, true)
    expect(client.getQueryData<PaginatedData<Todo>>(todoKeys.list({ completed: false, priority: 'high' }))?.total).toBe(6)
    expect(client.getQueryData<PaginatedData<Todo>>(todoKeys.list({ completed: true, priority: 'high' }))?.total).toBe(3)
  })

  it('does not change filtered totals when the backend keyword contract does not match', () => {
    const client = seededClient()
    client.setQueryData(todoKeys.list({ completed: false, keyword: 'missing' }), page([], 5))
    client.setQueryData(todoKeys.list({ completed: true, keyword: 'missing' }), page([], 2))
    applyTodoCompletion(client, 1, true)
    expect(client.getQueryData<PaginatedData<Todo>>(todoKeys.list({ completed: false, keyword: 'missing' }))?.total).toBe(5)
    expect(client.getQueryData<PaginatedData<Todo>>(todoKeys.list({ completed: true, keyword: 'missing' }))?.total).toBe(2)
  })

  it('updates matching combined-filter totals off-page using an original found in another list', () => {
    const client = seededClient()
    client.removeQueries({ queryKey: todoKeys.detail(1), exact: true })
    const source = { completed: false, priority: 'medium' as const, keyword: 'ACT' }
    const target = { completed: true, priority: 'medium' as const, keyword: 'ACT' }
    client.setQueryData(todoKeys.list(source), page([], 7))
    client.setQueryData(todoKeys.list(target), page([], 4))
    applyTodoCompletion(client, 1, true)
    expect(client.getQueryData<PaginatedData<Todo>>(todoKeys.list(source))).toMatchObject({ items: [], total: 6 })
    expect(client.getQueryData<PaginatedData<Todo>>(todoKeys.list(target))).toMatchObject({ items: [], total: 5 })
  })

  it('does not inflate totals when the todo is already in the requested completion state', () => {
    const client = seededClient()
    applyTodoCompletion(client, 1, true)
    applyTodoCompletion(client, 1, true)
    expect(client.getQueryData<PaginatedData<Todo>>(todoKeys.list({ completed: false }))?.total).toBe(0)
    expect(client.getQueryData<PaginatedData<Todo>>(todoKeys.list({ completed: true }))?.total).toBe(2)
  })

  it('updates only uncombined completion totals when the original todo is unknown', () => {
    const client = new QueryClient()
    client.setQueryData(todoKeys.list({ completed: false }), page([], 8))
    client.setQueryData(todoKeys.list({ completed: true }), page([], 4))
    client.setQueryData(todoKeys.list({ completed: false, priority: 'medium' }), page([], 3))
    client.setQueryData(todoKeys.list({ completed: true, priority: 'medium' }), page([], 2))
    applyTodoCompletion(client, 99, true)
    expect(client.getQueryData<PaginatedData<Todo>>(todoKeys.list({ completed: false }))?.total).toBe(7)
    expect(client.getQueryData<PaginatedData<Todo>>(todoKeys.list({ completed: true }))?.total).toBe(5)
    expect(client.getQueryData<PaginatedData<Todo>>(todoKeys.list({ completed: false, priority: 'medium' }))?.total).toBe(3)
    expect(client.getQueryData<PaginatedData<Todo>>(todoKeys.list({ completed: true, priority: 'medium' }))?.total).toBe(2)
  })

  it('restores every list and detail snapshot after failure', () => {
    const client = seededClient()
    const snapshot = applyTodoCompletion(client, 1, true)
    restoreTodoCompletion(client, snapshot)
    expect(client.getQueryData(todoKeys.list({ completed: false }))).toEqual(page([active], 1))
    expect(client.getQueryData(todoKeys.list({ completed: true }))).toEqual(page([done], 1))
    expect(client.getQueryData(todoKeys.list({}))).toEqual(page([active, done], 2))
    expect(client.getQueryData(todoKeys.detail(1))).toEqual(active)
  })

  it('ignores malformed list keys safely', () => {
    const client = seededClient()
    client.setQueryData([...todoKeys.lists(), 'bad-filter'], page([active], 1))
    expect(() => applyTodoCompletion(client, 1, true)).not.toThrow()
  })

  it('revalidates list queries after a toggle settles', async () => {
    const client = seededClient()
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client }, children)
    const { result } = renderHook(() => useCompleteTodo(), { wrapper })
    await result.current.mutateAsync(1)
    expect(invalidate).toHaveBeenCalledWith({ queryKey: todoKeys.lists() })
  })

  it('isolates concurrent ids when one succeeds, one fails, and revalidation fails', async () => {
    const second = { ...active, id: 3, title: 'second' }
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
    client.setQueryData(todoKeys.list({ completed: false }), page([active, second], 2))
    client.setQueryData(todoKeys.list({ completed: true }), page([], 0))
    client.setQueryData(todoKeys.list({}), page([active, second], 2))
    client.setQueryData(todoKeys.detail(1), active)
    client.setQueryData(todoKeys.detail(3), second)
    vi.spyOn(client, 'invalidateQueries').mockRejectedValue(new Error('refetch failed'))

    let resolveFirst!: () => void
    let resolveSecond!: () => void
    const firstGate = new Promise<void>((resolve) => { resolveFirst = resolve })
    const secondGate = new Promise<void>((resolve) => { resolveSecond = resolve })
    server.use(http.patch('/api/todos/:id/complete', async ({ params }) => {
      if (params.id === '1') {
        await firstGate
        return HttpResponse.json({ code: 0, message: 'ok', data: { ...active, completed: true } })
      }
      await secondGate
      return HttpResponse.json({ code: 50001, message: '失败', data: null }, { status: 500 })
    }))
    const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children)
    const { result } = renderHook(() => useCompleteTodo(), { wrapper })
    const first = result.current.mutateAsync(1)
    const secondRequest = result.current.mutateAsync(3)
    resolveSecond()
    await expect(secondRequest).rejects.toThrow('失败')
    resolveFirst()
    await expect(first).resolves.toMatchObject({ id: 1, completed: true })

    expect(client.getQueryData<PaginatedData<Todo>>(todoKeys.list({ completed: false }))).toMatchObject({ items: [second], total: 1 })
    expect(client.getQueryData<PaginatedData<Todo>>(todoKeys.list({ completed: true }))).toMatchObject({ items: [], total: 1 })
    expect(client.getQueryData<PaginatedData<Todo>>(todoKeys.list({}))?.items).toEqual([{ ...active, completed: true }, second])
    expect(client.getQueryData<Todo>(todoKeys.detail(1))).toMatchObject({ completed: true })
    expect(client.getQueryData<Todo>(todoKeys.detail(3))).toEqual(second)
  })
})
