import type { Todo, CreateTodoDTO, UpdateTodoDTO, ApiResponse, PaginatedData } from '../features/todos/todo.types'
import { agentEventScenarios } from './agentFixtures'

export { agentEventScenarios, agentMockDelays } from './agentFixtures'

// In-memory seed data. Each browser worker imports its own copy, so E2E pages
// can reset this state without sharing data across Playwright workers.
export const defaultTodos: Todo[] = [
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

let nextId = 5
let todos: Todo[] = defaultTodos.map((todo) => ({ ...todo }))

interface NextTodoFailure {
  method?: string
  path?: string
  query?: string
  remaining: number
  status: number
  message: string
}

interface NextTodoDelay {
  method?: string
  path?: string
  query?: string
  remaining: number
  delayMs: number
}

let nextTodoFailure: NextTodoFailure | null = null
let nextTodoDelay: NextTodoDelay | null = null
const E2E_TODOS_KEY = 'todolist:e2e:todos'
const E2E_TODO_FAILURE_KEY = 'todolist:e2e:todo-failure'
const E2E_TODO_DELAY_KEY = 'todolist:e2e:todo-delay'
const E2E_AGENT_SCENARIO_KEY = 'todolist:e2e:agent-scenario'

function readStorage(key: string) {
  try { return globalThis.localStorage?.getItem(key) ?? null } catch { return null }
}

function writeStorage(key: string, value: unknown) {
  try { globalThis.localStorage?.setItem(key, JSON.stringify(value)) } catch { /* Storage is optional outside browsers. */ }
}

function removeStorage(key: string) {
  try { globalThis.localStorage?.removeItem(key) } catch { /* Storage is optional outside browsers. */ }
}

function hydrateE2ETodoState() {
  try {
    const storedTodos = JSON.parse(readStorage(E2E_TODOS_KEY) ?? 'null') as Todo[] | null
    if (Array.isArray(storedTodos)) {
      todos = storedTodos.map((todo) => ({ ...todo }))
      nextId = Math.max(0, ...todos.map((todo) => todo.id)) + 1
    }
    const storedFailure = JSON.parse(readStorage(E2E_TODO_FAILURE_KEY) ?? 'null') as NextTodoFailure | null
    if (storedFailure) nextTodoFailure = storedFailure
    const storedDelay = JSON.parse(readStorage(E2E_TODO_DELAY_KEY) ?? 'null') as NextTodoDelay | null
    if (storedDelay) nextTodoDelay = storedDelay
  } catch {
    removeStorage(E2E_TODOS_KEY)
    removeStorage(E2E_TODO_FAILURE_KEY)
    removeStorage(E2E_TODO_DELAY_KEY)
  }
}

function persistTodos() {
  writeStorage(E2E_TODOS_KEY, todos)
}

export function resetTodos(): void {
  nextId = Math.max(0, ...defaultTodos.map((todo) => todo.id)) + 1
  todos = defaultTodos.map((todo) => ({ ...todo }))
  nextTodoFailure = null
  nextTodoDelay = null
  removeStorage(E2E_TODOS_KEY)
  removeStorage(E2E_TODO_FAILURE_KEY)
  removeStorage(E2E_TODO_DELAY_KEY)
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

import { http, HttpResponse, ws } from 'msw'

async function consumeTodoControl(request: Request) {
  hydrateE2ETodoState()
  const url = new URL(request.url)
  if (nextTodoDelay
    && (!nextTodoDelay.method || nextTodoDelay.method === request.method.toUpperCase())
    && (!nextTodoDelay.path || url.pathname.includes(nextTodoDelay.path))
    && (!nextTodoDelay.query || url.search.includes(nextTodoDelay.query))) {
    const delay = nextTodoDelay
    delay.remaining -= 1
    if (delay.remaining <= 0) {
      nextTodoDelay = null
      removeStorage(E2E_TODO_DELAY_KEY)
    } else {
      writeStorage(E2E_TODO_DELAY_KEY, delay)
    }
    await new Promise((resolve) => setTimeout(resolve, delay.delayMs))
  }
  if (!nextTodoFailure) return undefined
  if (nextTodoFailure.method && nextTodoFailure.method !== request.method.toUpperCase()) return undefined
  if (nextTodoFailure.path && !url.pathname.includes(nextTodoFailure.path)) return undefined
  if (nextTodoFailure.query && !url.search.includes(nextTodoFailure.query)) return undefined
  const failure = nextTodoFailure
  failure.remaining -= 1
  if (failure.remaining <= 0) {
    nextTodoFailure = null
    removeStorage(E2E_TODO_FAILURE_KEY)
  } else {
    writeStorage(E2E_TODO_FAILURE_KEY, failure)
  }
  return HttpResponse.json(
    { code: failure.status * 100 + 1, message: failure.message, data: null },
    { status: failure.status },
  )
}

const agentStream = ws.link('/api/agent/stream')

const agentStreamHandler = agentStream.addEventListener('connection', ({ client }) => {
  let started = false
  let waitingForConfirmation = false
  client.addEventListener('message', (message) => {
    let frame: { type?: string; approved?: boolean }
    try { frame = JSON.parse(String(message.data)) as { type?: string; approved?: boolean } } catch { return }
    const config = (() => {
      try {
        return JSON.parse(readStorage(E2E_AGENT_SCENARIO_KEY) ?? 'null') as {
          name?: keyof typeof agentEventScenarios | 'disconnect'
          timeScale?: number
        } | null
      } catch { return null }
    })()
    const name = config?.name ?? 'success'
    const timeScale = config?.timeScale ?? 0
    if (name === 'disconnect') {
      setTimeout(() => client.close(1011, 'mock_disconnect'), Math.max(0, Math.round(50 * timeScale)))
      return
    }
    const scenario = agentEventScenarios[name] ?? agentEventScenarios.success
    const applyAction = (event: (typeof scenario.events)[number]['event']) => {
      if (event.type !== 'action_completed') return
      if (event.action === 'create_todo') {
        const result = event.result as { title?: unknown; priority?: unknown }
        const now = new Date().toISOString()
        todos.unshift({
          id: nextId++,
          title: typeof result.title === 'string' ? result.title : 'Agent 创建的任务',
          description: '',
          priority: result.priority === 'high' || result.priority === 'low' ? result.priority : 'medium',
          completed: false,
          due_date: null,
          created_at: now,
          updated_at: now,
        })
        persistTodos()
      }
      if (event.action === 'delete_todo') {
        const result = event.result as { id?: unknown }
        if (typeof result.id === 'number') {
          todos = todos.filter((todo) => todo.id !== result.id)
          persistTodos()
        }
      }
    }
    const send = (item: (typeof scenario.events)[number], relativeToMs = 0) => {
      const delay = Math.max(0, Math.round((item.atMs - relativeToMs) * timeScale))
      setTimeout(() => {
        applyAction(item.event)
        client.send(JSON.stringify(item.event))
      }, delay)
    }

    if (!started) {
      started = true
      if (name === 'confirmationRequired') {
        waitingForConfirmation = true
        scenario.events
          .filter(({ event }) => event.type === 'step_started' || event.type === 'step_completed' || event.type === 'confirmation_required')
          .forEach(send)
      } else {
        scenario.events.forEach(send)
      }
      return
    }

    if (waitingForConfirmation && frame.type === 'confirmation_response') {
      waitingForConfirmation = false
      if (frame.approved) {
        const confirmationAt = scenario.events.find(({ event }) => event.type === 'confirmation_required')?.atMs ?? 0
        scenario.events
          .filter(({ event }) => event.type === 'action_completed' || event.type === 'reply' || event.type === 'done')
          .forEach((event) => send(event, confirmationAt))
      } else {
        client.send(JSON.stringify({ type: 'reply', content: '已取消删除操作。' }))
        client.send(JSON.stringify({ type: 'done' }))
      }
    }
  })
})

export const handlers = [
  // Test controls are available only when the browser MSW worker is enabled.
  http.post('/api/__e2e__/todos/seed', async ({ request }) => {
    const body = await request.json() as { todos?: Todo[] }
    if (!Array.isArray(body.todos)) {
      return HttpResponse.json({ message: 'todos must be an array' }, { status: 400 })
    }
    todos = body.todos.map((todo) => ({ ...todo }))
    nextId = Math.max(0, ...todos.map((todo) => todo.id)) + 1
    nextTodoFailure = null
    nextTodoDelay = null
    writeStorage(E2E_TODOS_KEY, todos)
    removeStorage(E2E_TODO_FAILURE_KEY)
    removeStorage(E2E_TODO_DELAY_KEY)
    return HttpResponse.json({ seeded: todos.length })
  }),
  http.post('/api/__e2e__/todos/fail-next', async ({ request }) => {
    const body = await request.json() as Partial<NextTodoFailure> & { times?: number }
    nextTodoFailure = {
      method: body.method?.toUpperCase(),
      path: body.path,
      query: body.query,
      remaining: Math.max(1, Math.min(10, body.times ?? 1)),
      status: body.status ?? 500,
      message: body.message ?? '模拟 Todo API 失败',
    }
    writeStorage(E2E_TODO_FAILURE_KEY, nextTodoFailure)
    return HttpResponse.json({ armed: true })
  }),
  http.post('/api/__e2e__/todos/delay-next', async ({ request }) => {
    const body = await request.json() as Partial<NextTodoDelay> & { times?: number }
    nextTodoDelay = {
      method: body.method?.toUpperCase(),
      path: body.path,
      query: body.query,
      remaining: Math.max(1, Math.min(10, body.times ?? 1)),
      delayMs: Math.max(0, Math.min(10_000, body.delayMs ?? 250)),
    }
    writeStorage(E2E_TODO_DELAY_KEY, nextTodoDelay)
    return HttpResponse.json({ armed: true })
  }),
  http.post('/api/__e2e__/agent/scenario', async ({ request }) => {
    const body = await request.json() as { name?: keyof typeof agentEventScenarios | 'disconnect'; timeScale?: number }
    if (!body.name || (body.name !== 'disconnect' && !agentEventScenarios[body.name])) {
      return HttpResponse.json({ message: 'unknown Agent scenario' }, { status: 400 })
    }
    writeStorage(E2E_AGENT_SCENARIO_KEY, { name: body.name, timeScale: body.timeScale ?? 0 })
    return HttpResponse.json({ armed: true })
  }),
  http.all(/\/api\/todos(?:\/.*)?$/, ({ request }) => consumeTodoControl(request)),

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
    persistTodos()
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
    persistTodos()
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
    persistTodos()
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
    persistTodos()
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
    persistTodos()
    return HttpResponse.json(ok(todos[idx]))
  }),

  // Agent WebSocket events use the deterministic scenarios from agentFixtures.ts.
  agentStreamHandler,
  http.delete('/api/agent/history', ({ request }) => {
    const sessionId = new URL(request.url).searchParams.get('session_id')
    if (!sessionId) {
      return HttpResponse.json(
        { code: 40001, message: 'session_id 不能为空', data: null },
        { status: 400 },
      )
    }
    return HttpResponse.json(ok({ deleted: true, session_id: sessionId }))
  }),
]
