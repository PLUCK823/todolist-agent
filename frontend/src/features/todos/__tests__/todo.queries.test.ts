import { createElement, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { applyTodoCompletion, restoreTodoCompletion, todoKeys, useCompleteTodo } from '../todo.queries'
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
  it('removes a completed task from active filters and updates matching caches', () => {
    const client = seededClient()
    applyTodoCompletion(client, 1, true)
    expect(client.getQueryData<PaginatedData<Todo>>(todoKeys.list({ completed: false }))).toMatchObject({ items: [], total: 0 })
    expect(client.getQueryData<PaginatedData<Todo>>(todoKeys.list({ completed: true }))).toMatchObject({ items: [done], total: 1 })
    expect(client.getQueryData<PaginatedData<Todo>>(todoKeys.list({}))?.items[0]).toMatchObject({ id: 1, completed: true })
    expect(client.getQueryData<Todo>(todoKeys.detail(1))).toMatchObject({ completed: true })
  })

  it('removes an uncompleted task from completed filters without inventing rows', () => {
    const client = seededClient()
    client.setQueryData(todoKeys.detail(2), done)
    applyTodoCompletion(client, 2, false)
    expect(client.getQueryData<PaginatedData<Todo>>(todoKeys.list({ completed: true }))).toMatchObject({ items: [], total: 0 })
    expect(client.getQueryData<PaginatedData<Todo>>(todoKeys.list({ completed: false }))).toMatchObject({ items: [active], total: 1 })
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
})
