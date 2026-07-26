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

test('@real persists authenticated Agent history, isolates owners and cascades delete', async ({ page, request }) => {
  test.setTimeout(180_000)
  const suffix = `${Date.now()}-${process.pid}`
  const aliceEmail = `alice-history-${suffix}@example.test`
  const bobEmail = `bob-history-${suffix}@example.test`
  const consoleErrors: string[] = []
  const pageErrors: string[] = []
  const failedRequests: string[] = []
  const websocketUrls: string[] = []
  await registerAndLogin(page, 'Alice History', aliceEmail)
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()) })
  page.on('pageerror', (error) => pageErrors.push(error.message))
  page.on('requestfailed', (failed) => {
    const path = new URL(failed.url()).pathname
    const errorText = failed.failure()?.errorText ?? ''

    // Chromium may report the already-asserted login/logout response body as
    // aborted when the auth state immediately redirects the SPA.
    if (errorText === 'net::ERR_ABORTED' && (path === '/api/auth/login' || path === '/api/auth/logout')) return

    failedRequests.push(`${failed.method()} ${path}: ${errorText}`)
  })
  page.on('websocket', (socket) => websocketUrls.push(socket.url()))
  await page.goto('/assistant')
  await page.getByRole('button', { name: '新建会话' }).click()
  await page.getByLabel('智能助手消息').fill('E2E_TABLE_HISTORY：查询真实任务并返回表格')
  await page.getByRole('button', { name: '发送消息' }).click()
  await expect(page.getByRole('table')).toBeVisible()
  await expect(page.getByRole('columnheader')).toContainText(['任务', '优先级'])
  await expect(page.locator('[data-testid^="agent-turn-"]').last().getByRole('button', { name: /执行详情/ })).toContainText('已完成')

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

  const beforeRestart = JSON.parse(sql(`
    SELECT json_build_object(
      'owner', s.owner_id = u.id,
      'turns', (SELECT count(*) FROM agent_turns t WHERE t.session_id=s.id),
      'messages', (SELECT count(*) FROM agent_messages m WHERE m.session_id=s.id),
      'roles', (SELECT array_agg(m.role ORDER BY m.ordinal) FROM agent_messages m WHERE m.session_id=s.id),
      'steps', (SELECT count(*) FROM agent_steps st JOIN agent_turns t ON t.id=st.turn_id WHERE t.session_id=s.id),
      'ordinals', (SELECT array_agg(t.ordinal ORDER BY t.ordinal) FROM agent_turns t WHERE t.session_id=s.id),
      'statuses', (SELECT array_agg(t.status ORDER BY t.ordinal) FROM agent_turns t WHERE t.session_id=s.id),
      'events_valid', (SELECT bool_and(st.event_id IS NOT NULL) FROM agent_steps st JOIN agent_turns t ON t.id=st.turn_id WHERE t.session_id=s.id)
    )
    FROM agent_sessions s JOIN users u ON u.email='${aliceEmail}' WHERE s.id='${aliceSessionId}'::uuid;
  `)) as { owner: boolean; turns: number; messages: number; roles: string[]; steps: number; ordinals: number[]; statuses: string[]; events_valid: boolean }
  expect(beforeRestart).toMatchObject({ owner: true, turns: 1, messages: 2, roles: ['user', 'assistant'], ordinals: [1], statuses: ['completed'], events_valid: true })
  expect(beforeRestart.steps).toBeGreaterThanOrEqual(1)

  compose('restart', 'agent')
  await expect.poll(async () => (await request.get('/api/agent/health')).ok(), { timeout: 60_000 }).toBe(true)
  await page.reload()
  await expect(page.getByRole('table')).toBeVisible()
  expect(JSON.parse(sql(`SELECT json_build_object('turns', count(*)) FROM agent_turns WHERE session_id='${aliceSessionId}'::uuid;`))).toEqual({ turns: 1 })
  await page.getByLabel('智能助手消息').fill('创建高优先级任务：重启后消息')
  await page.getByRole('button', { name: '发送消息' }).click()
  await expect(page.getByRole('log')).toContainText('已创建高优先级任务「重启后消息」。')

  await logout(page)
  await registerAndLogin(page, 'Bob History', bobEmail, false)
  const forbidden = await browserGet(page, `/api/agent/sessions/${aliceSessionId}`)
  expect(forbidden.status).toBe(404)
  expect(JSON.stringify(forbidden.body)).not.toContain('E2E_TABLE_HISTORY')
  await page.goto(`/assistant?session=${aliceSessionId}`)
  await expect(page.getByRole('log')).not.toContainText('E2E_TABLE_HISTORY')
  const bobOwnerCount = Number(sql(`SELECT count(*) FROM agent_sessions s JOIN users u ON u.id=s.owner_id WHERE u.email='${bobEmail}';`))
  expect(bobOwnerCount).toBe(0)

  await logout(page)
  await page.evaluate(async ({ email }) => {
    const response = await fetch('/api/auth/login', {
      method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'e2e-password-1' }),
    })
    if (!response.ok) throw new Error(`login failed: ${response.status}`)
  }, { email: aliceEmail })
  await page.goto('/assistant')
  await page.getByRole('button', { name: /会话操作/ }).first().click()
  await page.getByRole('button', { name: '删除会话' }).click()
  await page.getByRole('button', { name: '确认删除会话' }).click()
  await expect(page.getByRole('button', { name: /E2E_TABLE_HISTORY/ })).toHaveCount(0)
  const deleted = await browserGet(page, `/api/agent/sessions/${aliceSessionId}`)
  expect(deleted.status).toBe(404)
  expect(JSON.parse(sql(`SELECT json_build_object(
    'sessions', (SELECT count(*) FROM agent_sessions WHERE id='${aliceSessionId}'::uuid),
    'turns', (SELECT count(*) FROM agent_turns WHERE session_id='${aliceSessionId}'::uuid),
    'messages', (SELECT count(*) FROM agent_messages WHERE session_id='${aliceSessionId}'::uuid),
    'steps', (SELECT count(*) FROM agent_steps st JOIN agent_turns t ON t.id=st.turn_id WHERE t.session_id='${aliceSessionId}'::uuid)
  );`))).toEqual({ sessions: 0, turns: 0, messages: 0, steps: 0 })

  expect(pageErrors).toEqual([])
  expect(consoleErrors.filter((message) => !message.includes('404'))).toEqual([])
  expect(failedRequests).toEqual([])
})
