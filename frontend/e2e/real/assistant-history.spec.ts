import { execFileSync } from 'node:child_process'
import { expect, test } from '../fixtures/app.fixture'

test.describe.configure({ mode: 'serial' })

const root = '..'
const composeArgs = ['compose', '-p', 'todolist-agent-e2e', '-f', `${root}/docker-compose.yml`, '-f', `${root}/docker-compose.e2e.yml`]
const composeEnv = {
  ...process.env,
  AUTH_JWT_SECRET: process.env.AUTH_JWT_SECRET ?? 'e2e-only-auth-secret-32-characters-minimum',
}

function compose(...args: string[]) {
  return execFileSync('docker', [...composeArgs, ...args], {
    cwd: process.cwd(), env: composeEnv, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

function sql(statement: string) {
  return compose('exec', '-T', 'postgres', 'psql', '-U', 'todolist', '-d', 'todolist', '-At', '-v', 'ON_ERROR_STOP=1', '-c', statement)
}

async function registerAndLogin(page: import('@playwright/test').Page, name: string, email: string, navigate = true) {
  if (navigate) await page.goto('/login')
  const result = await page.evaluate(async ({ displayName, accountEmail }) => {
    const password = 'e2e-password-1'
    const headers = { 'content-type': 'application/json' }
    const register = await fetch('/api/auth/register', {
      method: 'POST', credentials: 'include', headers,
      body: JSON.stringify({ name: displayName, email: accountEmail, password }),
    })
    const login = await fetch('/api/auth/login', {
      method: 'POST', credentials: 'include', headers,
      body: JSON.stringify({ email: accountEmail, password }),
    })
    return { register: register.status, login: login.status }
  }, { displayName: name, accountEmail: email })
  expect(result.register).toBe(201)
  expect(result.login).toBe(200)
}

async function logout(page: import('@playwright/test').Page) {
  await page.evaluate(async () => {
    const response = await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' })
    if (!response.ok) throw new Error(`logout failed: ${response.status}`)
  })
}

async function browserGet(page: import('@playwright/test').Page, path: string) {
  return page.evaluate(async (url) => {
    const response = await fetch(url, { credentials: 'include' })
    return { status: response.status, ok: response.ok, body: await response.json() as unknown }
  }, path)
}

async function contextGet(page: import('@playwright/test').Page, path: string) {
  const response = await page.context().request.get(`http://127.0.0.1:3000${path}`)
  return { status: response.status(), ok: response.ok(), body: await response.json() as unknown }
}

interface PgHistorySnapshot {
  title: string
  turns: Array<{ id: string; ordinal: number; status: string }>
  messages: Array<{ id: string; turn_id: string; role: string; content: string; ordinal: number }>
  steps: Array<{
    id: string; turn_id: string; turn_ordinal: number; event_id: string
    ordinal: number; status: string; tool: string | null; result_preview: string | null
  }>
}

function historySnapshot(sessionId: string): PgHistorySnapshot {
  return JSON.parse(sql(`
    SELECT json_build_object(
      'title', (SELECT title FROM agent_sessions WHERE id='${sessionId}'::uuid),
      'turns', COALESCE((
        SELECT json_agg(json_build_object('id', t.id, 'ordinal', t.ordinal, 'status', t.status) ORDER BY t.ordinal)
        FROM agent_turns t WHERE t.session_id='${sessionId}'::uuid
      ), '[]'::json),
      'messages', COALESCE((
        SELECT json_agg(json_build_object(
          'id', m.id, 'turn_id', m.turn_id, 'role', m.role, 'content', m.content, 'ordinal', m.ordinal
        ) ORDER BY m.ordinal)
        FROM agent_messages m WHERE m.session_id='${sessionId}'::uuid
      ), '[]'::json),
      'steps', COALESCE((
        SELECT json_agg(json_build_object(
          'id', st.id, 'turn_id', st.turn_id, 'turn_ordinal', t.ordinal,
          'event_id', st.event_id::text, 'ordinal', st.ordinal, 'status', st.status,
          'tool', st.tool, 'result_preview', st.result_preview
        ) ORDER BY t.ordinal, st.ordinal)
        FROM agent_steps st JOIN agent_turns t ON t.id=st.turn_id
        WHERE t.session_id='${sessionId}'::uuid
      ), '[]'::json)
    );
  `)) as PgHistorySnapshot
}

function expectCompletedHistory(snapshot: PgHistorySnapshot, turnCount: number) {
  expect(snapshot.turns.map(({ ordinal, status }) => ({ ordinal, status }))).toEqual(
    Array.from({ length: turnCount }, (_, index) => ({ ordinal: index + 1, status: 'completed' })),
  )
  expect(snapshot.messages.map((message) => message.ordinal)).toEqual(
    Array.from({ length: turnCount * 2 }, (_, index) => index + 1),
  )
  expect(snapshot.messages.map((message) => message.role)).toEqual(
    Array.from({ length: turnCount }, () => ['user', 'assistant']).flat(),
  )
  for (const turn of snapshot.turns) {
    const messages = snapshot.messages.filter((message) => message.turn_id === turn.id)
    expect(messages.map((message) => message.role)).toEqual(['user', 'assistant'])
    const steps = snapshot.steps.filter((step) => step.turn_id === turn.id)
    expect(steps.map((step) => step.ordinal)).toEqual(Array.from({ length: steps.length }, (_, index) => index + 1))
    expect(steps.every((step) => step.status === 'completed')).toBe(true)
    expect(steps.find((step) => step.tool === 'list_todos')).toMatchObject({ ordinal: 2, status: 'completed' })
  }
  const eventIds = snapshot.steps.map((step) => step.event_id)
  expect(eventIds.every((eventId) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(eventId))).toBe(true)
  expect(new Set(eventIds).size).toBe(eventIds.length)
}

test('@real persists authenticated Agent history, isolates owners and cascades delete', async ({ page, request }) => {
  test.setTimeout(180_000)
  const suffix = `${Date.now()}-${process.pid}`
  const aliceEmail = `alice-history-${suffix}@example.test`
  const bobEmail = `bob-history-${suffix}@example.test`
  const renamedTitle = `Alice durable ${suffix}`
  const consoleErrors: string[] = []
  const expectedConsoleErrors: string[] = []
  const pageErrors: string[] = []
  const failedRequests: string[] = []
  const completedThenAborted: string[] = []
  const bootstrapRequestFailures: string[] = []
  const websocketUrls: string[] = []
  let expectedConsole404: { path: string; status: number } | undefined
  let abortBoundary: { method: string; path: string } | undefined
  const trackedAbortRequests = new WeakMap<import('@playwright/test').Request, { method: string; path: string; status?: number }>()
  const captureBootstrapFailure = (failed: import('@playwright/test').Request) => {
    bootstrapRequestFailures.push(`${failed.method()} ${new URL(failed.url()).pathname}: ${failed.failure()?.errorText ?? ''}`)
  }
  page.on('requestfailed', captureBootstrapFailure)
  await registerAndLogin(page, 'Alice History', aliceEmail)
  await page.goto('/assistant')
  await page.waitForLoadState('networkidle')
  page.off('requestfailed', captureBootstrapFailure)
  page.on('console', (message) => {
    if (message.type() !== 'error') return
    const locationUrl = message.location().url
    const locationPath = locationUrl ? new URL(locationUrl).pathname : ''
    if (expectedConsole404
      && locationPath === expectedConsole404.path
      && message.text().includes(String(expectedConsole404.status))) {
      expectedConsoleErrors.push(`${expectedConsole404.status} ${locationPath}`)
      return
    }
    consoleErrors.push(message.text())
  })
  page.on('pageerror', (error) => pageErrors.push(error.message))
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname
    if (abortBoundary && request.method() === abortBoundary.method && path === abortBoundary.path) {
      trackedAbortRequests.set(request, { ...abortBoundary })
    }
  })
  page.on('response', (response) => {
    const tracked = trackedAbortRequests.get(response.request())
    if (tracked) tracked.status = response.status()
  })
  page.on('requestfailed', (failed) => {
    const path = new URL(failed.url()).pathname
    const errorText = failed.failure()?.errorText ?? ''
    const tracked = trackedAbortRequests.get(failed)
    if (errorText === 'net::ERR_ABORTED' && tracked) {
      completedThenAborted.push(`${failed.method()} ${path}${tracked.status ? ` ${tracked.status}` : ''}`)
      return
    }
    failedRequests.push(`${failed.method()} ${path}: ${errorText}`)
  })
  page.on('websocket', (socket) => websocketUrls.push(socket.url()))
  const withAbortBoundary = async (method: string, path: string, action: () => Promise<void>) => {
    abortBoundary = { method, path }
    try {
      await action()
    } finally {
      abortBoundary = undefined
    }
  }
  const withExpected404Boundary = async (path: string, action: () => Promise<void>) => {
    expectedConsole404 = { path, status: 404 }
    try {
      await action()
      await page.waitForTimeout(50)
    } finally {
      expectedConsole404 = undefined
    }
  }
  await page.getByRole('button', { name: '新建会话' }).click()
  await page.getByLabel('智能助手消息').fill('E2E_TABLE_HISTORY：查询真实任务并返回表格')
  await page.getByRole('button', { name: '发送消息' }).click()
  await expect(page.getByRole('table')).toBeVisible()
  await expect(page.getByRole('columnheader')).toContainText(['任务', '优先级'])
  const firstTurn = page.locator('[data-testid^="agent-turn-"]').nth(0)
  await expect(firstTurn.getByRole('button', { name: /执行详情/ })).toHaveAttribute('aria-expanded', 'false')

  const sessionsResponse = await browserGet(page, '/api/agent/sessions')
  expect(sessionsResponse.ok).toBeTruthy()
  const sessionsEnvelope = sessionsResponse.body as { data: { items: Array<{ id: string }> } }
  const aliceSessionId = sessionsEnvelope.data.items[0]?.id
  expect(aliceSessionId).toMatch(/^[0-9a-f-]{36}$/)
  expect(websocketUrls).toHaveLength(1)
  const socketUrl = new URL(websocketUrls[0])
  expect(socketUrl.searchParams.get('session_id')).toBe(aliceSessionId)
  expect(socketUrl.searchParams.has('token')).toBe(false)
  expect(socketUrl.origin).toBe('ws://127.0.0.1:3000')

  await page.getByRole('button', { name: /会话操作/ }).first().click()
  await page.getByRole('button', { name: '重命名会话' }).click()
  await page.getByLabel('会话名称').fill(renamedTitle)
  await withAbortBoundary('PATCH', `/api/agent/sessions/${aliceSessionId}`, async () => {
    await page.getByRole('button', { name: '保存名称' }).click()
    await expect(page.getByRole('button', { name: `打开会话：${renamedTitle}` })).toHaveAttribute('aria-current', 'page')
  })
  await page.reload()
  await expect(page.getByRole('button', { name: `打开会话：${renamedTitle}` })).toBeVisible()
  await expect(firstTurn.getByRole('button', { name: /执行详情/ })).toHaveAttribute('aria-expanded', 'false')

  const ownerMatches = sql(`SELECT EXISTS(
    SELECT 1 FROM agent_sessions s JOIN users u ON u.id=s.owner_id
    WHERE s.id='${aliceSessionId}'::uuid AND u.email='${aliceEmail}'
  );`)
  expect(ownerMatches).toBe('t')
  const beforeRestart = historySnapshot(aliceSessionId)
  expect(beforeRestart.title).toBe(renamedTitle)
  expectCompletedHistory(beforeRestart, 1)
  expect(beforeRestart.messages.map((message) => message.content)).toEqual([
    'E2E_TABLE_HISTORY：查询真实任务并返回表格',
    expect.stringContaining('| 任务 | 优先级 | 状态 |'),
  ])

  compose('restart', 'agent')
  await expect.poll(async () => (await request.get('/api/agent/health')).ok(), { timeout: 60_000 }).toBe(true)
  await page.reload()
  await expect(page.getByRole('button', { name: `打开会话：${renamedTitle}` })).toBeVisible()
  await expect(page.getByRole('table')).toBeVisible()
  await expect(firstTurn.getByRole('button', { name: /执行详情/ })).toHaveAttribute('aria-expanded', 'false')
  await firstTurn.getByRole('button', { name: /执行详情/ }).click()
  await expect(firstTurn.getByRole('list', { name: 'Agent 执行步骤' })).toBeVisible()
  await expect(firstTurn.locator('code')).toContainText('list_todos')
  await expect(firstTurn.getByRole('region', { name: 'list_todos 执行结果' })).toBeVisible()
  await firstTurn.getByRole('button', { name: /执行详情/ }).click()
  expect(historySnapshot(aliceSessionId)).toEqual(beforeRestart)

  await page.getByLabel('智能助手消息').fill('E2E_TABLE_HISTORY：重启后再次查询')
  await page.getByRole('button', { name: '发送消息' }).click()
  await expect(page.locator('[data-testid^="agent-turn-"]')).toHaveCount(2)
  await expect(page.getByRole('table')).toHaveCount(2)
  const secondTurn = page.locator('[data-testid^="agent-turn-"]').nth(1)
  await expect(firstTurn.getByRole('button', { name: /执行详情/ })).toHaveAttribute('aria-expanded', 'false')
  await expect(secondTurn.getByRole('button', { name: /执行详情/ })).toHaveAttribute('aria-expanded', 'false')
  await firstTurn.getByRole('button', { name: /执行详情/ }).click()
  await expect(firstTurn.getByRole('list', { name: 'Agent 执行步骤' })).toBeVisible()
  await expect(firstTurn.getByRole('region', { name: 'list_todos 执行结果' })).toBeVisible()
  await expect(secondTurn.getByRole('list', { name: 'Agent 执行步骤' })).not.toBeVisible()
  await expect(firstTurn).not.toContainText('E2E_TABLE_HISTORY：重启后再次查询')
  await firstTurn.getByRole('button', { name: /执行详情/ }).click()
  await secondTurn.getByRole('button', { name: /执行详情/ }).click()
  await expect(secondTurn.getByRole('list', { name: 'Agent 执行步骤' })).toBeVisible()
  await expect(secondTurn.getByRole('region', { name: 'list_todos 执行结果' })).toBeVisible()
  await expect(firstTurn.getByRole('list', { name: 'Agent 执行步骤' })).not.toBeVisible()
  await expect(secondTurn).not.toContainText('E2E_TABLE_HISTORY：查询真实任务并返回表格')

  const afterRestart = historySnapshot(aliceSessionId)
  expect(afterRestart.title).toBe(renamedTitle)
  expectCompletedHistory(afterRestart, 2)
  expect(afterRestart.turns.slice(0, beforeRestart.turns.length).map((turn) => turn.id)).toEqual(beforeRestart.turns.map((turn) => turn.id))
  expect(afterRestart.messages.slice(0, beforeRestart.messages.length).map((message) => message.id)).toEqual(beforeRestart.messages.map((message) => message.id))
  expect(afterRestart.steps.slice(0, beforeRestart.steps.length).map((step) => step.id)).toEqual(beforeRestart.steps.map((step) => step.id))
  expect(afterRestart.messages[2].content).toBe('E2E_TABLE_HISTORY：重启后再次查询')
  expect(afterRestart.messages[3].content).toContain('| 任务 | 优先级 | 状态 |')

  await withAbortBoundary('POST', '/api/auth/logout', () => logout(page))
  await withAbortBoundary('POST', '/api/auth/login', () => registerAndLogin(page, 'Bob History', bobEmail, false))
  const isolationPath = `/api/agent/sessions/${aliceSessionId}`
  const forbidden = await contextGet(page, isolationPath)
  expect(forbidden.status).toBe(404)
  expect(JSON.stringify(forbidden.body)).not.toContain('E2E_TABLE_HISTORY')
  await withExpected404Boundary(isolationPath, async () => {
    await page.goto(`/assistant?session=${aliceSessionId}`)
    await expect(page.getByRole('log')).not.toContainText('E2E_TABLE_HISTORY')
  })
  const bobOwnerCount = Number(sql(`SELECT count(*) FROM agent_sessions s JOIN users u ON u.id=s.owner_id WHERE u.email='${bobEmail}';`))
  expect(bobOwnerCount).toBe(0)

  await withAbortBoundary('POST', '/api/auth/logout', () => logout(page))
  await withAbortBoundary('POST', '/api/auth/login', () => page.evaluate(async ({ email }) => {
      const response = await fetch('/api/auth/login', {
        method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password: 'e2e-password-1' }),
      })
      if (!response.ok) throw new Error(`login failed: ${response.status}`)
    }, { email: aliceEmail }))
  await page.goto('/assistant')
  await page.getByRole('button', { name: /会话操作/ }).first().click()
  await page.getByRole('button', { name: '删除会话' }).click()
  await page.getByRole('button', { name: '确认删除会话' }).click()
  await expect(page.getByRole('button', { name: `打开会话：${renamedTitle}` })).toHaveCount(0)
  const deleted = await contextGet(page, isolationPath)
  expect(deleted.status).toBe(404)
  expect(JSON.parse(sql(`SELECT json_build_object(
    'sessions', (SELECT count(*) FROM agent_sessions WHERE id='${aliceSessionId}'::uuid),
    'turns', (SELECT count(*) FROM agent_turns WHERE session_id='${aliceSessionId}'::uuid),
    'messages', (SELECT count(*) FROM agent_messages WHERE session_id='${aliceSessionId}'::uuid),
    'steps', (SELECT count(*) FROM agent_steps st JOIN agent_turns t ON t.id=st.turn_id WHERE t.session_id='${aliceSessionId}'::uuid)
  );`))).toEqual({ sessions: 0, turns: 0, messages: 0, steps: 0 })

  expect(pageErrors).toEqual([])
  expect(consoleErrors).toEqual([])
  expect(bootstrapRequestFailures.every((entry) => entry === 'POST /api/auth/login: net::ERR_ABORTED')).toBe(true)
  expect(expectedConsoleErrors.every((entry) => entry === `404 ${isolationPath}`)).toBe(true)
  expect(completedThenAborted.every((entry) => (
    /^(POST) \/api\/auth\/(login|logout)( 2\d\d)?$/.test(entry)
    || new RegExp(`^PATCH /api/agent/sessions/${aliceSessionId}( 200)?$`).test(entry)
  ))).toBe(true)
  expect(failedRequests).toEqual([])
})
