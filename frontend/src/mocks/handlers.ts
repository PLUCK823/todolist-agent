import type { Todo, CreateTodoDTO, UpdateTodoDTO, ApiResponse, PaginatedData } from '../features/todos/todo.types'

// In-memory seed data
let nextId = 5
let todos: Todo[] = [
  {
    id: 1,
    title: '完成项目文档',
    description: '编写项目的 README 和 API 文档',
    priority: 'high',
    completed: false,
    due_date: '2026-07-15T00:00:00Z',
    created_at: '2026-07-10T08:00:00Z',
    updated_at: '2026-07-10T08:00:00Z',
  },
  {
    id: 2,
    title: '购买 groceries',
    description: '牛奶、面包、鸡蛋、水果',
    priority: 'medium',
    completed: true,
    due_date: '2026-07-13T00:00:00Z',
    created_at: '2026-07-11T10:00:00Z',
    updated_at: '2026-07-12T09:30:00Z',
  },
  {
    id: 3,
    title: '健身 30 分钟',
    description: '',
    priority: 'low',
    completed: false,
    due_date: null,
    created_at: '2026-07-12T07:00:00Z',
    updated_at: '2026-07-12T07:00:00Z',
  },
  {
    id: 4,
    title: '阅读《深入浅出 Golang》第三章',
    description: '关于并发编程的章节',
    priority: 'medium',
    completed: false,
    due_date: '2026-07-20T00:00:00Z',
    created_at: '2026-07-09T18:00:00Z',
    updated_at: '2026-07-09T18:00:00Z',
  },
]

export function resetTodos(): void {
  nextId = 5
  todos = [
    {
      id: 1,
      title: '完成项目文档',
      description: '编写项目的 README 和 API 文档',
      priority: 'high',
      completed: false,
      due_date: '2026-07-15T00:00:00Z',
      created_at: '2026-07-10T08:00:00Z',
      updated_at: '2026-07-10T08:00:00Z',
    },
    {
      id: 2,
      title: '购买 groceries',
      description: '牛奶、面包、鸡蛋、水果',
      priority: 'medium',
      completed: true,
      due_date: '2026-07-13T00:00:00Z',
      created_at: '2026-07-11T10:00:00Z',
      updated_at: '2026-07-12T09:30:00Z',
    },
    {
      id: 3,
      title: '健身 30 分钟',
      description: '',
      priority: 'low',
      completed: false,
      due_date: null,
      created_at: '2026-07-12T07:00:00Z',
      updated_at: '2026-07-12T07:00:00Z',
    },
    {
      id: 4,
      title: '阅读《深入浅出 Golang》第三章',
      description: '关于并发编程的章节',
      priority: 'medium',
      completed: false,
      due_date: '2026-07-20T00:00:00Z',
      created_at: '2026-07-09T18:00:00Z',
      updated_at: '2026-07-09T18:00:00Z',
    },
  ]
}

export function getTodos(): Todo[] {
  return todos
}

function ok<T>(data: T): ApiResponse<T> {
  return { code: 0, message: 'ok', data }
}

function notFound(): ApiResponse<null> {
  return { code: 40401, message: '待办不存在', data: null }
}

import { http, HttpResponse } from 'msw'

export const handlers = [
  // 1. GET /api/todos - list with filters
  http.get('/api/todos', ({ request }) => {
    const url = new URL(request.url)
    const page = parseInt(url.searchParams.get('page') || '1')
    const page_size = parseInt(url.searchParams.get('page_size') || '20')
    const completedParam = url.searchParams.get('completed')
    const priority = url.searchParams.get('priority') as Todo['priority'] | null
    const keyword = (url.searchParams.get('keyword') || '').trim().toLowerCase()
    const sort_by = url.searchParams.get('sort_by') || 'created_at'
    const order = url.searchParams.get('order') || 'desc'
    const dueFrom = url.searchParams.get('due_from')
    const dueTo = url.searchParams.get('due_to')

    let filtered = [...todos]

    if (completedParam !== null) {
      const isCompleted = completedParam === 'true'
      filtered = filtered.filter((t) => t.completed === isCompleted)
    }

    if (priority && ['high', 'medium', 'low'].includes(priority)) {
      filtered = filtered.filter((t) => t.priority === priority)
    }

    if (keyword) {
      filtered = filtered.filter((t) => t.title.toLowerCase().includes(keyword))
    }

    if (dueFrom) {
      filtered = filtered.filter((todo) => todo.due_date && Date.parse(todo.due_date) >= Date.parse(dueFrom))
    }
    if (dueTo) {
      filtered = filtered.filter((todo) => todo.due_date && Date.parse(todo.due_date) < Date.parse(dueTo))
    }

    filtered.sort((a, b) => {
      let cmp = 0
      if (sort_by === 'created_at') {
        cmp = a.created_at.localeCompare(b.created_at)
      } else if (sort_by === 'priority') {
        const priOrder: Record<string, number> = { high: 3, medium: 2, low: 1 }
        cmp = (priOrder[a.priority] || 2) - (priOrder[b.priority] || 2)
      } else if (sort_by === 'due_date') {
        cmp = (a.due_date || '').localeCompare(b.due_date || '')
        if (cmp === 0) cmp = a.id - b.id
      }
      return order === 'asc' ? cmp : -cmp
    })

    const total = filtered.length
    const start = (page - 1) * page_size
    const items = filtered.slice(start, start + page_size)

    const paginated: PaginatedData<Todo> = { items, total, page, page_size }
    return HttpResponse.json(ok(paginated))
  }),

  // 2. GET /api/todos/:id - single todo
  http.get('/api/todos/:id', ({ params }) => {
    const id = parseInt(params.id as string)
    const todo = todos.find((t) => t.id === id)
    if (!todo) {
      return HttpResponse.json(notFound(), { status: 404 })
    }
    return HttpResponse.json(ok(todo))
  }),

  // 3. POST /api/todos - create
  http.post('/api/todos', async ({ request }) => {
    const body = (await request.json()) as CreateTodoDTO
    if (!body.title || body.title.trim().length === 0) {
      return HttpResponse.json(
        { code: 40001, message: '待办标题不能为空', data: null },
        { status: 400 },
      )
    }
    const now = new Date().toISOString()
    const todo: Todo = {
      id: nextId++,
      title: body.title.trim(),
      description: body.description || '',
      priority: body.priority || 'medium',
      completed: false,
      due_date: body.due_date || null,
      created_at: now,
      updated_at: now,
    }
    todos.unshift(todo)
    return HttpResponse.json(ok(todo), { status: 201 })
  }),

  // 4. PUT /api/todos/:id - update
  http.put('/api/todos/:id', async ({ request, params }) => {
    const id = parseInt(params.id as string)
    const body = (await request.json()) as UpdateTodoDTO
    const idx = todos.findIndex((t) => t.id === id)
    if (idx === -1) {
      return HttpResponse.json(notFound(), { status: 404 })
    }
    todos[idx] = {
      ...todos[idx],
      ...(body.title !== undefined && { title: body.title.trim() }),
      ...(body.description !== undefined && { description: body.description }),
      ...(body.priority !== undefined && { priority: body.priority }),
      ...(body.due_date !== undefined && { due_date: body.due_date }),
      updated_at: new Date().toISOString(),
    }
    return HttpResponse.json(ok(todos[idx]))
  }),

  // 5. DELETE /api/todos/:id - delete
  http.delete('/api/todos/:id', ({ params }) => {
    const id = parseInt(params.id as string)
    const idx = todos.findIndex((t) => t.id === id)
    if (idx === -1) {
      return HttpResponse.json(notFound(), { status: 404 })
    }
    todos.splice(idx, 1)
    return new HttpResponse(null, { status: 204 })
  }),

  // 6. PATCH /api/todos/:id/complete
  http.patch('/api/todos/:id/complete', ({ params }) => {
    const id = parseInt(params.id as string)
    const idx = todos.findIndex((t) => t.id === id)
    if (idx === -1) {
      return HttpResponse.json(notFound(), { status: 404 })
    }
    todos[idx] = {
      ...todos[idx],
      completed: true,
      updated_at: new Date().toISOString(),
    }
    return HttpResponse.json(ok(todos[idx]))
  }),

  // 7. PATCH /api/todos/:id/uncomplete
  http.patch('/api/todos/:id/uncomplete', ({ params }) => {
    const id = parseInt(params.id as string)
    const idx = todos.findIndex((t) => t.id === id)
    if (idx === -1) {
      return HttpResponse.json(notFound(), { status: 404 })
    }
    todos[idx] = {
      ...todos[idx],
      completed: false,
      updated_at: new Date().toISOString(),
    }
    return HttpResponse.json(ok(todos[idx]))
  }),
]
