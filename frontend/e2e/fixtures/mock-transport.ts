import type { BrowserContext, Route, WebSocketRoute } from '@playwright/test'
import type { Todo } from '../../src/features/todos/todo.types'
import { defaultTodos } from '../../src/mocks/handlers'
import { agentEventScenarios } from '../../src/mocks/agentFixtures'

type Account = { id: string; name: string; email: string; timezone: string; avatar: { kind: 'preset'; value: 'amber' }; taskCount: number; agentSessionCount: number }
type Session = { id: string; title: string; created_at: string; updated_at: string; last_message_at: string; turns: Record<string, unknown>[] }
type Failure = { method?: string; path?: string; query?: string; remaining: number; status: number; message: string }
type Scenario = keyof typeof agentEventScenarios | 'disconnect' | 'readOnlyDisconnect'

const sessionCookie = 'todolist_mock_session'
const jsonHeaders = { 'content-type': 'application/json' }
const ok = <T>(data: T) => ({ code: 0, message: 'ok', data })
const iso = () => new Date().toISOString()
const uuid = () => crypto.randomUUID()
const asText = (body: string | Buffer) => typeof body === 'string' ? body : body.toString()
const isApi = (url: URL) => url.pathname.startsWith('/api/')

function accountFor(name: string, email: string, tasks: number): Account {
  return { id: `mock-${email.replace(/[^a-z0-9]/gi, '-')}`, name, email, timezone: 'Asia/Shanghai (UTC+8)', avatar: { kind: 'preset', value: 'amber' }, taskCount: tasks, agentSessionCount: 0 }
}

/** Test-only state. One instance is installed for each BrowserContext. */
class MockTransport {
  todos = defaultTodos.map((todo) => ({ ...todo }))
  nextTodoId = Math.max(...this.todos.map((todo) => todo.id)) + 1
  accounts = new Map<string, { account: Account; password: string }>()
  sessions = new Map<string, Map<string, Session>>()
  failure: Failure | undefined
  delay: (Failure & { delayMs: number }) | undefined
  scenario: { name: Scenario; timeScale: number } = { name: 'success', timeScale: 0 }
  retries = new Map<string, { sessionId: string; stepId: string; terminal: boolean; stored?: { session: Session; turn: Record<string, unknown> } }>()

  email(route: Route) {
    const cookie = route.request().headers().cookie ?? ''
    const value = cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${sessionCookie}=`))?.slice(sessionCookie.length + 1)
    return value ? decodeURIComponent(value).trim().toLowerCase() : undefined
  }
  account(route: Route) { const email = this.email(route); return email ? this.accounts.get(email)?.account : undefined }
  userSessions(email: string) { let own = this.sessions.get(email); if (!own) { own = new Map(); this.sessions.set(email, own) }; return own }
  async body(route: Route) { try { return JSON.parse(route.request().postData() || '{}') as Record<string, unknown> } catch { return {} } }
  async send(route: Route, status: number, body?: unknown, headers: Record<string, string> = {}) {
    await route.fulfill({ status, headers: { ...jsonHeaders, ...headers }, body: body === undefined ? '' : JSON.stringify(body) })
  }
  async unauthorized(route: Route) { await this.send(route, 401, { code: 40102, message: '登录已失效', data: null }) }
  summary(session: Session) { return { id: session.id, title: session.title, created_at: session.created_at, updated_at: session.updated_at, last_message_at: session.last_message_at } }
  async controlled(route: Route) {
    const request = route.request(); const url = new URL(request.url()); const control = this.delay
    if (control && (!control.method || control.method === request.method()) && (!control.path || url.pathname.includes(control.path)) && (!control.query || url.search.includes(control.query))) {
      control.remaining--; if (control.remaining <= 0) this.delay = undefined
      await new Promise((resolve) => setTimeout(resolve, control.delayMs))
    }
    const failure = this.failure
    if (failure && (!failure.method || failure.method === request.method()) && (!failure.path || url.pathname.includes(failure.path)) && (!failure.query || url.search.includes(failure.query))) {
      failure.remaining--; if (failure.remaining <= 0) this.failure = undefined
      await this.send(route, failure.status, { code: failure.status * 100 + 1, message: failure.message, data: null }); return true
    }
    return false
  }

  async handle(route: Route) {
    const request = route.request(); const url = new URL(request.url()); const { pathname } = url; const method = request.method()
    if (!isApi(url)) return route.continue()
    if (pathname.startsWith('/api/__e2e__/')) return this.control(route, pathname)
    if (pathname.startsWith('/api/auth/')) return this.auth(route, pathname)
    if (pathname.startsWith('/api/agent/')) return this.agent(route, pathname)
    if (pathname.startsWith('/api/todos')) return this.todo(route, pathname)
    await this.send(route, 501, { code: 50101, message: `Unhandled mock API route: ${method} ${pathname}`, data: null })
  }

  async auth(route: Route, pathname: string) {
    const method = route.request().method(); const body = await this.body(route)
    if (method === 'POST' && pathname === '/api/auth/register') {
      const name = typeof body.name === 'string' ? body.name.trim() : ''; const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''; const password = typeof body.password === 'string' ? body.password : ''
      if (!name || !email || !password) return this.send(route, 400, { code: 40001, message: '请求参数格式错误', data: null })
      if (this.accounts.has(email)) return this.send(route, 409, { code: 40901, message: '邮箱已被使用', data: null })
      const account = accountFor(name, email, this.todos.length); this.accounts.set(email, { account, password }); return this.send(route, 201, ok(account))
    }
    if (method === 'POST' && pathname === '/api/auth/login') {
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''; const stored = this.accounts.get(email)
      if (!stored || body.password !== stored.password) return this.send(route, 401, { code: 40102, message: '邮箱或密码不正确', data: null })
      return this.send(route, 200, ok(stored.account), { 'set-cookie': `${sessionCookie}=${encodeURIComponent(email)}; Path=/; HttpOnly; SameSite=Lax` })
    }
    if (method === 'POST' && pathname === '/api/auth/logout') return this.send(route, 204, undefined, { 'set-cookie': `${sessionCookie}=; Path=/; HttpOnly; Max-Age=0; SameSite=Lax` })
    const account = this.account(route); if (!account) return this.unauthorized(route)
    if ((method === 'GET' && pathname === '/api/auth/me') || (method === 'POST' && pathname === '/api/auth/refresh')) return this.send(route, 200, ok(account))
    if (method === 'PATCH' && pathname === '/api/auth/me') {
      if (typeof body.avatar === 'object') return this.send(route, 400, { code: 40001, message: '请求参数不合法', data: null })
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : account.email
      const stored = this.accounts.get(account.email)!; const next = { ...account, email, ...(typeof body.name === 'string' ? { name: body.name.trim() } : {}), ...(typeof body.timezone === 'string' ? { timezone: body.timezone } : {}) }
      this.accounts.delete(account.email); this.accounts.set(email, { account: next, password: stored.password }); return this.send(route, 200, ok(next), { 'set-cookie': `${sessionCookie}=${encodeURIComponent(email)}; Path=/; HttpOnly; SameSite=Lax` })
    }
    return this.send(route, 501, { code: 50101, message: `Unhandled mock auth route: ${method} ${pathname}`, data: null })
  }

  async control(route: Route, pathname: string) {
    const body = await this.body(route)
    if (pathname === '/api/__e2e__/todos/seed') { if (!Array.isArray(body.todos)) return this.send(route, 400, { message: 'todos must be an array' }); this.todos = structuredClone(body.todos) as Todo[]; this.nextTodoId = Math.max(0, ...this.todos.map((todo) => todo.id)) + 1; this.failure = undefined; this.delay = undefined; return this.send(route, 200, { seeded: this.todos.length }) }
    if (pathname === '/api/__e2e__/todos/fail-next') { this.failure = { method: typeof body.method === 'string' ? body.method.toUpperCase() : undefined, path: typeof body.path === 'string' ? body.path : undefined, query: typeof body.query === 'string' ? body.query : undefined, remaining: Math.max(1, Math.min(10, Number(body.times) || 1)), status: Number(body.status) || 500, message: typeof body.message === 'string' ? body.message : '模拟 Todo API 失败' }; return this.send(route, 200, { armed: true }) }
    if (pathname === '/api/__e2e__/todos/delay-next') { this.delay = { method: typeof body.method === 'string' ? body.method.toUpperCase() : undefined, path: typeof body.path === 'string' ? body.path : undefined, query: typeof body.query === 'string' ? body.query : undefined, remaining: Math.max(1, Math.min(10, Number(body.times) || 1)), status: 0, message: '', delayMs: Math.max(0, Math.min(10_000, Number(body.delayMs) || 250)) }; return this.send(route, 200, { armed: true }) }
    if (pathname === '/api/__e2e__/agent/scenario') { const name = body.name; if (typeof name !== 'string' || !(name in agentEventScenarios) && name !== 'disconnect' && name !== 'readOnlyDisconnect') return this.send(route, 400, { message: 'unknown Agent scenario' }); this.scenario = { name: name as Scenario, timeScale: Math.max(0, Number(body.timeScale) || 0) }; return this.send(route, 200, { armed: true }) }
    if (pathname === '/api/__e2e__/agent/history') { const account = this.account(route); if (!account) return this.unauthorized(route); if (!Array.isArray(body.sessions)) return this.send(route, 400, { message: 'sessions must be an array' }); const sessions = this.userSessions(account.email); sessions.clear(); for (const session of body.sessions as Session[]) sessions.set(session.id, structuredClone(session)); return this.send(route, 200, { seeded: sessions.size }) }
    return this.send(route, 501, { code: 50101, message: `Unhandled mock control route: ${pathname}`, data: null })
  }

  async todo(route: Route, pathname: string) {
    if (await this.controlled(route)) return
    const method = route.request().method(); const body = await this.body(route); const idMatch = pathname.match(/^\/api\/todos\/(\d+)(?:\/(complete|uncomplete))?$/); const notFound = () => this.send(route, 404, { code: 40401, message: '待办不存在', data: null })
    if (method === 'GET' && pathname === '/api/todos') { const url = new URL(route.request().url()); let items = [...this.todos]; const completed = url.searchParams.get('completed'); const priority = url.searchParams.get('priority'); const keyword = (url.searchParams.get('keyword') ?? '').toLowerCase(); if (completed !== null) items = items.filter((todo) => todo.completed === (completed === 'true')); if (priority) items = items.filter((todo) => todo.priority === priority); if (keyword) items = items.filter((todo) => todo.title.toLowerCase().includes(keyword)); const sort = url.searchParams.get('sort_by') ?? 'created_at'; const order = url.searchParams.get('order') ?? 'desc'; items.sort((a, b) => { const priorityWeight: Record<string, number> = { high: 3, medium: 2, low: 1 }; const value = sort === 'priority' ? priorityWeight[a.priority] - priorityWeight[b.priority] : sort === 'due_date' ? (a.due_date ?? '').localeCompare(b.due_date ?? '') : a.created_at.localeCompare(b.created_at); return order === 'asc' ? value : -value }); const page = Number(url.searchParams.get('page')) || 1; const pageSize = Number(url.searchParams.get('page_size')) || 20; return this.send(route, 200, ok({ items: items.slice((page - 1) * pageSize, page * pageSize), total: items.length, page, page_size: pageSize })) }
    if (method === 'POST' && pathname === '/api/todos') { if (typeof body.title !== 'string' || !body.title.trim()) return this.send(route, 400, { code: 40001, message: '待办标题不能为空', data: null }); const now = iso(); const todo: Todo = { id: this.nextTodoId++, title: body.title.trim(), description: typeof body.description === 'string' ? body.description : '', priority: body.priority === 'high' || body.priority === 'low' ? body.priority : 'medium', completed: false, due_date: typeof body.due_date === 'string' ? body.due_date : null, created_at: now, updated_at: now }; this.todos.unshift(todo); return this.send(route, 201, ok(todo)) }
    if (!idMatch) return this.send(route, 501, { code: 50101, message: `Unhandled mock todo route: ${method} ${pathname}`, data: null }); const id = Number(idMatch[1]); const index = this.todos.findIndex((todo) => todo.id === id); if (index < 0) return notFound(); const todo = this.todos[index]
    if (method === 'GET') return this.send(route, 200, ok(todo)); if (method === 'DELETE') { this.todos.splice(index, 1); return this.send(route, 204) }; if (method === 'PUT') { this.todos[index] = { ...todo, ...(typeof body.title === 'string' ? { title: body.title.trim() } : {}), ...(typeof body.description === 'string' ? { description: body.description } : {}), ...(body.priority === 'high' || body.priority === 'medium' || body.priority === 'low' ? { priority: body.priority } : {}), ...(typeof body.due_date === 'string' || body.due_date === null ? { due_date: body.due_date as string | null } : {}), updated_at: iso() }; return this.send(route, 200, ok(this.todos[index])) }; if (method === 'PATCH' && idMatch[2]) { this.todos[index] = { ...todo, completed: idMatch[2] === 'complete', updated_at: iso() }; return this.send(route, 200, ok(this.todos[index])) }; return this.send(route, 501, { code: 50101, message: `Unhandled mock todo method: ${method}`, data: null })
  }

  async agent(route: Route, pathname: string) {
    const account = this.account(route); if (!account) return this.unauthorized(route); const sessions = this.userSessions(account.email); const method = route.request().method(); const body = await this.body(route); const id = pathname.match(/^\/api\/agent\/sessions\/([^/]+)$/)?.[1]
    if (method === 'GET' && pathname === '/api/agent/sessions') return this.send(route, 200, ok({ items: [...sessions.values()].sort((a, b) => b.last_message_at.localeCompare(a.last_message_at)).map((session) => this.summary(session)) }))
    if (method === 'POST' && pathname === '/api/agent/sessions') { const now = iso(); const session: Session = { id: uuid(), title: typeof body.title === 'string' && body.title.trim() ? body.title.trim() : '新会话', created_at: now, updated_at: now, last_message_at: now, turns: [] }; sessions.set(session.id, session); return this.send(route, 201, ok(this.summary(session))) }
    if (id) { const session = sessions.get(id); if (!session) return this.send(route, 404, { code: 40401, message: '会话不存在', data: null }); if (method === 'GET') return this.send(route, 200, ok({ session: this.summary(session), turns: session.turns })); if (method === 'PATCH') { if (typeof body.title !== 'string' || !body.title.trim()) return this.send(route, 400, { code: 40001, message: '会话名称不能为空', data: null }); session.title = body.title.trim(); session.updated_at = iso(); return this.send(route, 200, ok(this.summary(session))) }; if (method === 'DELETE') { sessions.delete(id); return this.send(route, 200, ok({ deleted: true, session_id: id })) } }
    if (method === 'DELETE' && pathname === '/api/agent/history') { const session = sessions.get(new URL(route.request().url()).searchParams.get('session_id') ?? ''); if (!session) return this.send(route, 404, { code: 40401, message: '会话不存在', data: null }); session.turns = []; session.updated_at = iso(); session.last_message_at = session.updated_at; return this.send(route, 200, ok({ deleted: true, session_id: session.id })) }
    return this.send(route, 501, { code: 50101, message: `Unhandled mock agent route: ${method} ${pathname}`, data: null })
  }

  storeTurn(sessionId: string, message: string) {
    for (const sessions of this.sessions.values()) { const session = sessions.get(sessionId); if (session) { const now = iso(); const ordinal = session.turns.length + 1; const turn: Record<string, unknown> = { id: uuid(), ordinal, status: 'running', started_at: now, completed_at: null, failure_code: null, failure_message: null, result_uncertain: false, messages: [{ id: uuid(), role: 'user', content: message, ordinal: ordinal * 2 - 1, created_at: now }], steps: [] }; session.turns.push(turn); session.title = session.title === '新会话' ? message.trim().slice(0, 40) || '新会话' : session.title; session.updated_at = now; session.last_message_at = now; return { session, turn } } }; return undefined
  }
  websocket(ws: WebSocketRoute) {
    let started = false
    let waitingConfirmation: { stored?: { session: Session; turn: Record<string, unknown> }; events: typeof agentEventScenarios.success.events; confirmationAt: number } | undefined
    ws.onMessage((raw) => {
      let frame: Record<string, unknown>; try { frame = JSON.parse(asText(raw)) as Record<string, unknown> } catch { ws.close({ code: 1003, reason: 'invalid mock frame' }); return }
      if (frame.type === 'retry_step') { const token = typeof frame.retry_token === 'string' ? frame.retry_token : ''; const pending = this.retries.get(token); const validKeys = Object.keys(frame).every((key) => ['type', 'session_id', 'step_id', 'retry_token'].includes(key)); if (!validKeys || !pending || !pending.terminal || pending.sessionId !== frame.session_id || pending.stepId !== frame.step_id) { ws.send(JSON.stringify({ type: 'step_failed', step_id: frame.step_id ?? 'retry', error_code: 'INVALID_RETRY_STEP', message: '重试步骤不存在、已使用或不属于当前会话', retryable: false, duration_ms: 0 })); ws.send(JSON.stringify({ type: 'done' })); return }; this.retries.delete(token); this.emit(ws, agentEventScenarios.readOnlySuccess.events.filter(({ event }) => event.type !== 'step_completed'), pending.stored); return }
      if (waitingConfirmation && frame.type === 'confirmation_response') {
        const pending = waitingConfirmation; waitingConfirmation = undefined
        if (frame.approved === true) this.emit(ws, pending.events.filter(({ event }) => ['action_completed', 'reply', 'done'].includes(event.type)), pending.stored, false, pending.confirmationAt)
        else {
          const cancelled = [{ atMs: 0, event: { type: 'reply' as const, content: '已取消删除操作。' } }, { atMs: 1, event: { type: 'done' as const } }]
          this.emit(ws, cancelled, pending.stored)
        }
        return
      }
      if (started || typeof frame.message !== 'string' || typeof frame.session_id !== 'string') { ws.close({ code: 1003, reason: 'invalid mock frame' }); return }
      started = true
      if (this.scenario.name === 'disconnect') { setTimeout(() => ws.close({ code: 1011, reason: 'mock_disconnect' }), 10); return }
      const stored = this.storeTurn(frame.session_id, frame.message); const scenario = this.scenario.name === 'readOnlyDisconnect' ? agentEventScenarios.readOnlyTimeout : agentEventScenarios[this.scenario.name]
      if (this.scenario.name === 'confirmationRequired') {
        const confirmationAt = scenario.events.find(({ event }) => event.type === 'confirmation_required')?.atMs ?? 0
        waitingConfirmation = { stored, events: scenario.events, confirmationAt }
        this.emit(ws, scenario.events.filter(({ event }) => ['step_started', 'step_completed', 'confirmation_required'].includes(event.type)), stored)
      } else this.emit(ws, scenario.events, stored, this.scenario.name === 'readOnlyDisconnect', 0, frame.session_id)
    })
  }
  emit(ws: WebSocketRoute, events: typeof agentEventScenarios.success.events, stored?: { session: Session; turn: Record<string, unknown> }, disconnect = false, relativeTo = 0, sessionId = stored?.session.id ?? '') {
    let seq = 0; const scale = this.scenario.timeScale
    for (const item of events) { if (disconnect && item.event.type === 'done') continue; setTimeout(() => { let event: Record<string, unknown> = { ...item.event }; if (event.type === 'step_failed' && event.retryable && event.step_id === 'list-1') { const retry = `mock-retry-${uuid()}`; this.retries.set(retry, { sessionId, stepId: 'list-1', terminal: false, stored }); event = { ...event, retry_token: retry } }
      if (stored) this.apply(stored, event); ws.send(JSON.stringify(event)); if (event.type === 'done') for (const retry of this.retries.values()) retry.terminal = true; if (disconnect && event.type === 'step_failed') setTimeout(() => ws.close({ code: 1011, reason: 'mock_disconnect_before_done' }), 0)
    }, Math.max(0, Math.round((item.atMs - relativeTo) * scale)) + seq++) }
  }
  apply(stored: { session: Session; turn: Record<string, unknown> }, event: Record<string, unknown>) {
    const steps = stored.turn.steps as Record<string, unknown>[]; const messages = stored.turn.messages as Record<string, unknown>[]; const find = () => steps.find((step) => step.event_id === event.event_id)
    if (event.type === 'step_started') { const existing = find(); if (existing) { Object.assign(existing, { status: 'running', error_code: null, error_message: null, retryable: false, completed_at: null }); stored.turn.status = 'running' } else steps.push({ id: uuid(), event_id: event.event_id, ordinal: steps.length + 1, label: event.label, tool: event.tool ?? null, status: 'running', args: event.args ?? {}, result: null, result_preview: null, result_truncated: false, duration_ms: null, error_code: null, error_message: null, retryable: false, confirmation_id: null, confirmation_message: null, confirmation_approved: null, started_at: iso(), completed_at: null }) }
    if (event.type === 'step_completed' || event.type === 'action_completed') Object.assign(find() ?? {}, { status: 'completed', duration_ms: event.duration_ms, result: event.result ?? null, result_preview: event.result ? JSON.stringify(event.result) : null, completed_at: iso() })
    if (event.type === 'step_failed') { Object.assign(find() ?? {}, { status: 'failed', error_code: event.error_code, error_message: event.message, retryable: event.retryable, duration_ms: event.duration_ms, completed_at: iso() }); Object.assign(stored.turn, { status: 'failed', failure_code: event.error_code, failure_message: event.message, completed_at: iso() }) }
    if (event.type === 'confirmation_required') Object.assign(find() ?? {}, { status: 'waiting_confirmation', confirmation_id: event.confirmation_id, confirmation_message: event.message })
    if (event.type === 'reply') messages.push({ id: uuid(), role: 'assistant', content: event.content, ordinal: (stored.turn.ordinal as number) * 2, created_at: iso() })
    if (event.type === 'action_completed' && event.action === 'create_todo') { const result = event.result as { title?: unknown; priority?: unknown }; const now = iso(); this.todos.unshift({ id: this.nextTodoId++, title: typeof result.title === 'string' ? result.title : 'Agent 创建的任务', description: '', priority: result.priority === 'high' || result.priority === 'low' ? result.priority : 'medium', completed: false, due_date: null, created_at: now, updated_at: now }) }
    if (event.type === 'action_completed' && event.action === 'delete_todo') { const result = event.result as { id?: unknown }; if (typeof result.id === 'number') this.todos = this.todos.filter((todo) => todo.id !== result.id) }
    if (event.type === 'done') { if (stored.turn.status === 'running') Object.assign(stored.turn, { status: 'completed', failure_code: null, failure_message: null }); stored.turn.completed_at = iso(); stored.session.updated_at = iso(); stored.session.last_message_at = stored.session.updated_at }
  }
}

export async function installMockTransport(context: BrowserContext) {
  const state = new MockTransport()
  await context.route((url) => isApi(url), (route) => state.handle(route))
  await context.routeWebSocket((url) => url.pathname === '/api/agent/stream', (ws) => state.websocket(ws))
}
