import { execFileSync, spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { assertExperienceReport, findAvailablePort, measureGzip } from './experience-gate-lib.mjs'

const frontend = join(dirname(fileURLToPath(import.meta.url)), '..')
const root = join(frontend, '..')
const evidenceDir = join(root, 'docs/qa/evidence')
const previewPort = await findAvailablePort()
const baseURL = `http://127.0.0.1:${previewPort}`
const account = { id: 'experience-account', name: '体验门禁', email: 'experience@example.com', timezone: 'Asia/Shanghai (UTC+8)', avatar: { kind: 'preset', value: 'amber' }, taskCount: 4, agentSessionCount: 1 }
const password = 'password1'

execFileSync('pnpm', ['build'], { cwd: frontend, stdio: 'inherit', env: { ...process.env, VITE_ENABLE_MSW: 'true' } })
const html = await readFile(join(frontend, 'dist/index.html'), 'utf8')
const entryName = html.match(/src="\/assets\/(index-[^"]+\.js)"/)?.[1]
if (!entryName) throw new Error('unable to identify Vite entry chunk')
const entrySize = await measureGzip(join(frontend, 'dist/assets', entryName))

const preview = spawn(process.execPath, [join(frontend, 'node_modules/vite/bin/vite.js'), 'preview', '--host', '127.0.0.1', '--port', String(previewPort), '--strictPort'], {
  cwd: frontend,
  detached: true,
  stdio: 'inherit',
})
let browser
try {
for (let attempt = 0; attempt < 100; attempt += 1) {
  if (preview.exitCode !== null) throw new Error(`production preview exited with code ${preview.exitCode}`)
  try { if ((await fetch(baseURL)).ok) break } catch { /* wait */ }
  await new Promise((resolve) => setTimeout(resolve, 100))
  if (attempt === 99) throw new Error('production preview did not start')
}

browser = await chromium.launch({ headless: true })
await mkdir(evidenceDir, { recursive: true })
const evidence = []
async function session(viewport = { width: 1223, height: 1227 }) {
  const context = await browser.newContext({ viewport, locale: 'zh-CN', timezoneId: 'Asia/Shanghai', reducedMotion: 'reduce' })
  const page = await context.newPage()
  await page.goto(`${baseURL}/login`)
  await page.evaluate(async () => {
    if ('serviceWorker' in navigator) await navigator.serviceWorker.ready
  })
  if (!await page.evaluate(() => navigator.serviceWorker?.controller != null)) await page.reload()
  await page.evaluate(async ({ accountValue, passwordValue }) => {
    const salt = '00112233445566778899aabbccddeeff'
    const encoded = new TextEncoder().encode(`${salt}:${passwordValue}`)
    const digest = await crypto.subtle.digest('SHA-256', encoded)
    const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
    localStorage.setItem('todolist.auth.account', JSON.stringify(accountValue))
    localStorage.setItem('todolist.auth.credential', JSON.stringify({ version: 1, accountId: accountValue.id, salt, hash }))
    localStorage.setItem('todolist.auth.session', accountValue.id)
  }, { accountValue: account, passwordValue: password })
  return { context, page }
}
async function capture(id, action) {
  const started = performance.now()
  const { context, page } = await session()
  try {
    await action(page)
    const screenshot = `docs/qa/evidence/path-${id}.png`
    await page.screenshot({ path: join(root, screenshot), fullPage: true })
    evidence.push({ id, timestamp: new Date().toISOString(), durationMs: Math.round(performance.now() - started), pass: true, screenshot })
  } finally {
    await context.close()
  }
}

const ftiSamples = []
for (let index = 0; index < 5; index += 1) {
  const { context, page } = await session()
  const started = performance.now()
  await page.goto(`${baseURL}/tasks`)
  await page.getByRole('heading', { name: '今天，保持专注' }).waitFor()
  await page.getByRole('button', { name: /^查看任务：/ }).first().waitFor()
  ftiSamples.push(Math.round(performance.now() - started))
  await context.close()
}

const overflow = []
for (const viewport of [{ width: 1223, height: 1227 }, { width: 390, height: 844 }]) {
  const { context, page } = await session(viewport)
  await page.goto(`${baseURL}/tasks`)
  await page.getByRole('heading', { name: '今天，保持专注' }).waitFor()
  const overflowPx = await page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth))
  overflow.push({ viewport, overflowPx, pass: overflowPx === 0 })
  await context.close()
}

await capture(1, async (page) => { await page.goto(`${baseURL}/tasks`); await page.locator('header').getByRole('button', { name: '新建任务' }).click(); await page.getByLabel('任务标题').fill('验收证据任务'); await page.getByRole('button', { name: '创建任务' }).click(); await page.getByText('验收证据任务').waitFor() })
await capture(2, async (page) => { await page.goto(`${baseURL}/tasks`); await page.getByRole('button', { name: /^查看任务：/ }).first().click(); await page.getByRole('button', { name: '编辑任务' }).click(); await page.getByLabel('任务标题').fill('验收编辑任务'); await page.getByRole('button', { name: '保存修改' }).click(); await page.getByRole('button', { name: /删除任务：验收编辑任务/ }).click(); await page.getByRole('dialog', { name: '删除任务' }).waitFor() })
await capture(3, async (page) => { await page.goto(`${baseURL}/tasks`); await page.getByRole('button', { name: '全部状态' }).click(); await page.getByRole('dialog', { name: '状态筛选' }).getByRole('button', { name: '进行中' }).click(); await page.getByRole('button', { name: '优先级' }).click() })
await capture(4, async (page) => { await page.goto(`${baseURL}/tasks`); await page.getByRole('button', { name: '展开导航' }).click(); await page.getByRole('link', { name: '近期安排' }).click(); await page.getByRole('heading', { name: '近期安排' }).waitFor() })
await capture(5, async (page) => { await page.goto(`${baseURL}/tasks`); await page.getByRole('button', { name: '收起智能助手' }).click(); await page.keyboard.press('Meta+K'); await page.getByRole('dialog', { name: '快速询问' }).waitFor() })

let agentRunning
async function armScrollableAgentRun(page) {
  const seededTodos = Array.from({ length: 24 }, (_, index) => ({
    id: index + 1,
    title: `滚动验收任务 ${index + 1}`,
    description: 'Agent 运行期间主任务区滚动验证',
    priority: index % 3 === 0 ? 'high' : index % 3 === 1 ? 'medium' : 'low',
    completed: false,
    due_date: null,
    created_at: '2026-07-13T02:00:00.000Z',
    updated_at: '2026-07-13T02:00:00.000Z',
  }))
  await page.evaluate(async ({ todos }) => {
    const response = await fetch('/api/__e2e__/todos/seed', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ todos }) })
    if (!response.ok) throw new Error(`todo seed failed: ${response.status}`)
  }, { todos: seededTodos })
  await page.evaluate(async () => {
    const response = await fetch('/api/__e2e__/agent/scenario', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'success', timeScale: 1 }) })
    if (!response.ok) throw new Error(`agent scenario failed: ${response.status}`)
  })
  await page.goto(`${baseURL}/tasks`)
  await page.getByLabel('消息输入框').fill('创建运行中验收任务')
  await page.getByRole('button', { name: '发送消息' }).click()
  await page.getByText('运行中', { exact: true }).first().waitFor()
}

await capture(6, async (evidencePage) => {
  const { context, page } = await session({ width: 1223, height: 844 })
  try {
    await armScrollableAgentRun(page)
  const main = page.locator('.app-shell__main')
  const beforeScrollTop = await main.evaluate((node) => node.scrollTop)
  await main.evaluate((node) => { node.scrollTop = Math.max(1, node.scrollHeight - node.clientHeight) })
  const afterScrollTop = await main.evaluate((node) => node.scrollTop)
  const control = page.locator('header').getByRole('button', { name: '新建任务' })
  const enabled = await control.isEnabled()
  await control.click()
  const operated = await page.getByRole('dialog', { name: '新建任务' }).isVisible()
  await page.getByRole('dialog', { name: '新建任务' }).getByRole('button', { name: '关闭' }).click()
  agentRunning = { main: { scrollable: afterScrollTop > beforeScrollTop, beforeScrollTop, afterScrollTop }, nonConflictingControl: { enabled, operated }, pass: afterScrollTop > beforeScrollTop && enabled && operated }
  } finally {
    await context.close()
  }

  await evidencePage.evaluate(async () => {
    const response = await fetch('/api/__e2e__/agent/scenario', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'success', timeScale: 1 }) })
    if (!response.ok) throw new Error(`agent scenario failed: ${response.status}`)
  })
  await evidencePage.goto(`${baseURL}/tasks`)
  await evidencePage.getByLabel('消息输入框').fill('创建运行中验收任务')
  await evidencePage.getByRole('button', { name: '发送消息' }).click()
  await evidencePage.getByText('运行中', { exact: true }).first().waitFor()
})
await capture(7, async (page) => { await page.goto(`${baseURL}/profile`); await page.getByLabel('显示名称').fill('验收资料'); await page.getByRole('button', { name: '保存修改' }).click(); await page.getByRole('button', { name: '更换头像' }).click(); await page.getByRole('dialog', { name: '更换头像' }).waitFor() })
await capture(8, async (page) => {
  await page.goto(`${baseURL}/profile`)
  await page.getByRole('button', { name: '退出登录' }).click()
  await page.getByRole('dialog', { name: '确认退出登录' }).getByRole('button', { name: '确认退出' }).click()
  await page.getByRole('heading', { name: 'Agent TodoList' }).waitFor()
  await page.getByRole('link', { name: '注册' }).click()
  await page.getByText('创建新账号', { exact: true }).waitFor()
  await page.getByRole('link', { name: '去登录' }).click()
  await page.getByLabel('邮箱地址').fill(account.email)
  await page.getByLabel('密码').fill(password)
  await page.getByRole('button', { name: '登录' }).click()
  await page.getByRole('heading', { name: '今天，保持专注' }).waitFor()
})

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  status: 'pass',
  build: { entry: { file: `dist/assets/${entryName}`, ...entrySize, limitBytes: 100_000, pass: entrySize.gzipBytes < 100_000 } },
  fti: { samplesMs: ftiSamples, limitMs: 2_000, pass: ftiSamples.every((value) => value < 2_000) },
  overflow,
  agentRunning,
  evidence,
}
assertExperienceReport(report)
await writeFile(join(root, 'docs/qa/experience-report.json'), `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify(report, null, 2))
} finally {
  await browser?.close()
  if (preview.pid) {
    try { process.kill(-preview.pid, 'SIGTERM') } catch { preview.kill('SIGTERM') }
  }
}
