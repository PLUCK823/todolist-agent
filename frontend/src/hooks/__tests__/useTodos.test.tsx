import { describe, it, expect } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useTodos, useTodo, useCreateTodo, useUpdateTodo, useDeleteTodo, useCompleteTodo, useUncompleteTodo } from '../useTodos'
import { TestProviders } from '../../testUtils'

describe('useTodos', () => {
  it('fetches todos on mount', async () => {
    const { result } = renderHook(() => useTodos(), {
      wrapper: TestProviders,
    })

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    expect(result.current.data?.items).toHaveLength(4)
    expect(result.current.data?.total).toBe(4)
  })

  it('respects filters', async () => {
    const { result } = renderHook(() => useTodos({ completed: true }), {
      wrapper: TestProviders,
    })

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    expect(result.current.data?.items.every((t) => t.completed)).toBe(true)
  })
})

describe('useTodo', () => {
  it('fetches single todo', async () => {
    const { result } = renderHook(() => useTodo(1), {
      wrapper: TestProviders,
    })

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    expect(result.current.data?.id).toBe(1)
    expect(result.current.data?.title).toBe('完成项目文档')
  })

  it('does not fetch when id is null', () => {
    const { result } = renderHook(() => useTodo(null), {
      wrapper: TestProviders,
    })

    expect(result.current.isPending).toBe(true)
    expect(result.current.fetchStatus).toBe('idle')
  })
})

describe('useCreateTodo', () => {
  it('creates a todo and invalidates queries', async () => {
    const { result } = renderHook(() => useCreateTodo(), {
      wrapper: TestProviders,
    })

    const todo = await result.current.mutateAsync({ title: '测试创建' })
    expect(todo.title).toBe('测试创建')
    expect(todo.id).toBeGreaterThan(0)
  })
})

describe('useUpdateTodo', () => {
  it('updates a todo', async () => {
    const { result } = renderHook(() => useUpdateTodo(), {
      wrapper: TestProviders,
    })

    const todo = await result.current.mutateAsync({ id: 1, dto: { title: '已更新' } })
    expect(todo.title).toBe('已更新')
  })
})

describe('useDeleteTodo', () => {
  it('deletes a todo', async () => {
    const { result } = renderHook(() => useDeleteTodo(), {
      wrapper: TestProviders,
    })

    await expect(result.current.mutateAsync(1)).resolves.toBeUndefined()
  })
})

describe('useCompleteTodo', () => {
  it('completes a todo', async () => {
    const { result } = renderHook(() => useCompleteTodo(), {
      wrapper: TestProviders,
    })

    const todo = await result.current.mutateAsync(1)
    expect(todo.completed).toBe(true)
  })
})

describe('useUncompleteTodo', () => {
  it('uncompletes a todo', async () => {
    const { result } = renderHook(() => useUncompleteTodo(), {
      wrapper: TestProviders,
    })

    const todo = await result.current.mutateAsync(2)
    expect(todo.completed).toBe(false)
  })
})
