import { createElement, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { server } from '../../../mocks/server'
import { applyTodoCompletion, fetchUpcomingTodos, matchesNonCompletionFilters, restoreTodoCompletion, todoKeys, useCompleteTodo } from '../todo.queries'
import type { PaginatedData, Todo } from '../todo.types'

const active: Todo = { id: 1, title: 'active', description: '', priority: 'medium', completed: false, due_date: null, created_at: '2026-07-10T08:00:00Z', updated_at: '2026-07-10T08:00:00Z' }
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
  it('restores all 101 aggregated upcoming items when completion and revalidation fail', async () => {
    const items = Array.from({ length: 101 }, (_, index) => ({
      ...active,
      id: index + 1,
      title: `item-${index + 1}`,
      due_date: `2026-07-14T${String(index % 10).padStart(2, '0')}:00:00Z`,
    }))
    const filters = { due_from: '2026-07-13T16:00:00Z', due_to: '2026-07-20T16:00:00Z', page_size: 100 }
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
    client.setQueryData(todoKeys.list(filters), { items, total: 101, page: 1, page_size: 100 })
    vi.spyOn(client, 'invalidateQueries').mockRejectedValue(new Error('refetch failed'))
    server.use(http.patch('/api/todos/:id/complete', () => HttpResponse.json({ code: 50001, message: '完成失败', data: null }, { status: 500 })))
    const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children)
    const { result } = renderHook(() => useCompleteTodo(), { wrapper })

    await expect(result.current.mutateAsync(1)).rejects.toThrow('完成失败')

    const restored = client.getQueryData<PaginatedData<Todo>>(todoKeys.list(filters))!
    expect(restored.items).toHaveLength(101)
    expect(restored.total).toBe(101)
    expect(restored.items[0]).toMatchObject({ id: 1, completed: false })
    expect(restored.items[100]).toMatchObject({ id: 101, title: 'item-101' })
  })
  it('mirrors repository keyword matching for title, case, and trimmed input', () => {
    const described = { ...active, title: 'Plan Launch', description: 'secret phrase' }
    expect(matchesNonCompletionFilters(described, { keyword: 'LAUNCH' })).toBe(true)
    expect(matchesNonCompletionFilters(described, { keyword: 'secret' })).toBe(false)
    expect(matchesNonCompletionFilters(described, { keyword: ' Launch ' })).toBe(true)
    expect(matchesNonCompletionFilters(described, { keyword: '   ' })).toBe(true)
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

describe('upcoming pagination query', () => {
  const ranged = (id: number): Todo => ({
    ...active,
    id,
    title: `range-${id}`,
    due_date: `2026-07-14T${String(id % 10).padStart(2, '0')}:00:00Z`,
  })

  it('deduplicates stable IDs across page boundaries', async () => {
    server.use(http.get('/api/todos', ({ request }) => {
      const page = Number(new URL(request.url).searchParams.get('page'))
      const items = page === 1 ? [ranged(1), ranged(2)] : [ranged(2), ranged(3)]
      return HttpResponse.json({ code: 0, message: 'ok', data: { items, total: 3, page, page_size: 2 } })
    }))

    const result = await fetchUpcomingTodos('2026-07-13T16:00:00Z', '2026-07-20T16:00:00Z')
    expect(result.items.map((todo) => todo.id)).toEqual([1, 2, 3])
    expect(result.total).toBe(3)
  })

  it('stops with the second-page API error instead of returning partial data', async () => {
    server.use(http.get('/api/todos', ({ request }) => {
      const page = Number(new URL(request.url).searchParams.get('page'))
      if (page === 2) return HttpResponse.json({ code: 50311, message: '第二页失败', data: null }, { status: 503 })
      return HttpResponse.json({ code: 0, message: 'ok', data: { items: Array.from({ length: 100 }, (_, index) => ranged(index + 1)), total: 101, page: 1, page_size: 100 } })
    }))

    await expect(fetchUpcomingTodos('2026-07-13T16:00:00Z', '2026-07-20T16:00:00Z')).rejects.toMatchObject({ message: '第二页失败' })
  })

  it('rejects a changed total on a later page even when unique IDs fill the first total', async () => {
    server.use(http.get('/api/todos', ({ request }) => {
      const page = Number(new URL(request.url).searchParams.get('page'))
      const items = page === 1 ? [ranged(1), ranged(2)] : [ranged(3)]
      return HttpResponse.json({ code: 0, message: 'ok', data: { items, total: page === 1 ? 3 : 999, page, page_size: 2 } })
    }))

    await expect(fetchUpcomingTodos('2026-07-13T16:00:00Z', '2026-07-20T16:00:00Z')).rejects.toMatchObject({ message: '任务分页响应异常，请稍后重试' })
  })

  it('rejects an implausible page count before requesting page two', async () => {
    let requests = 0
    server.use(http.get('/api/todos', () => {
      requests += 1
      return HttpResponse.json({ code: 0, message: 'ok', data: { items: [ranged(1)], total: 10_001, page: 1, page_size: 100 } })
    }))

    await expect(fetchUpcomingTodos('2026-07-13T16:00:00Z', '2026-07-20T16:00:00Z')).rejects.toMatchObject({ message: '任务分页响应异常，请稍后重试' })
    expect(requests).toBe(1)
  })

  it('aborts an in-flight page and never requests a later page', async () => {
    const requested: number[] = []
    let secondStarted!: () => void
    const started = new Promise<void>((resolve) => { secondStarted = resolve })
    server.use(http.get('/api/todos', async ({ request }) => {
      const page = Number(new URL(request.url).searchParams.get('page'))
      requested.push(page)
      if (page === 2) {
        secondStarted()
        await new Promise(() => undefined)
      }
      return HttpResponse.json({ code: 0, message: 'ok', data: { items: Array.from({ length: 100 }, (_, index) => ranged((page - 1) * 100 + index + 1)), total: 201, page, page_size: 100 } })
    }))
    const controller = new AbortController()
    const request = fetchUpcomingTodos('2026-07-13T16:00:00Z', '2026-07-20T16:00:00Z', controller.signal)
    await started
    controller.abort()

    await expect(request).rejects.toMatchObject({ name: 'CanceledError' })
    expect(requested).toEqual([1, 2])
  })
})
