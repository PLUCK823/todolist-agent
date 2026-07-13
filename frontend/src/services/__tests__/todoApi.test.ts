import { describe, it, expect } from 'vitest'
import {
  fetchTodos,
  fetchTodo,
  createTodo,
  updateTodo,
  deleteTodo,
  completeTodo,
  uncompleteTodo,
} from '../todoApi'

describe('todoApi', () => {
  describe('fetchTodos', () => {
    it('returns paginated todos', async () => {
      const result = await fetchTodos()
      expect(result.items).toHaveLength(4)
      expect(result.total).toBe(4)
      expect(result.page).toBe(1)
    })

    it('filters by completed status', async () => {
      const result = await fetchTodos({ completed: true })
      expect(result.items.every((t) => t.completed)).toBe(true)
    })

    it('filters by priority', async () => {
      const result = await fetchTodos({ priority: 'high' })
      expect(result.items.every((t) => t.priority === 'high')).toBe(true)
    })

    it('filters by keyword', async () => {
      const result = await fetchTodos({ keyword: '文档' })
      expect(result.items.some((t) => t.title.includes('文档'))).toBe(true)
    })

    it('paginates correctly', async () => {
      const result = await fetchTodos({ page: 1, page_size: 2 })
      expect(result.items).toHaveLength(2)
      expect(result.total).toBe(4)
    })

    it('supports sorting', async () => {
      const result = await fetchTodos({ sort_by: 'created_at', order: 'asc' })
      const dates = result.items.map((t) => t.created_at)
      for (let i = 1; i < dates.length; i++) {
        expect(dates[i] >= dates[i - 1]).toBe(true)
      }
    })
  })

  describe('fetchTodo', () => {
    it('returns a single todo by id', async () => {
      const todo = await fetchTodo(1)
      expect(todo.id).toBe(1)
      expect(todo.title).toBe('完成项目文档')
    })

    it('throws on non-existent id', async () => {
      await expect(fetchTodo(999)).rejects.toThrow()
    })
  })

  describe('createTodo', () => {
    it('creates a new todo', async () => {
      const todo = await createTodo({ title: '新任务', priority: 'high' })
      expect(todo.id).toBeGreaterThan(0)
      expect(todo.title).toBe('新任务')
      expect(todo.priority).toBe('high')
      expect(todo.completed).toBe(false)
    })

    it('defaults priority to medium', async () => {
      const todo = await createTodo({ title: '默认优先级' })
      expect(todo.priority).toBe('medium')
    })
  })

  describe('updateTodo', () => {
    it('updates a todo', async () => {
      const todo = await updateTodo(1, { title: '更新后的标题' })
      expect(todo.title).toBe('更新后的标题')
      expect(todo.id).toBe(1)
    })

    it('throws on non-existent id', async () => {
      await expect(updateTodo(999, { title: 'x' })).rejects.toThrow()
    })
  })

  describe('deleteTodo', () => {
    it('deletes a todo', async () => {
      await expect(deleteTodo(1)).resolves.toBeUndefined()
    })

    it('throws on non-existent id', async () => {
      await expect(deleteTodo(999)).rejects.toThrow()
    })
  })

  describe('completeTodo', () => {
    it('marks a todo as completed', async () => {
      const todo = await completeTodo(1)
      expect(todo.completed).toBe(true)
    })
  })

  describe('uncompleteTodo', () => {
    it('unmarks a completed todo', async () => {
      const todo = await uncompleteTodo(2)
      expect(todo.completed).toBe(false)
    })
  })
})
