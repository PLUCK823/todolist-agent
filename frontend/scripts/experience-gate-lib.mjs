import { gzipSync } from 'node:zlib'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { createServer } from 'node:net'

export const ENTRY_GZIP_LIMIT_BYTES = 100_000
export const FTI_LIMIT_MS = 2_000
export const REQUIRED_VIEWPORTS = [
  { width: 1223, height: 1227 },
  { width: 390, height: 844 },
]

export async function measureGzip(filePath) {
  const source = await readFile(filePath)
  return { rawBytes: source.byteLength, gzipBytes: gzipSync(source).byteLength }
}

export async function findAvailablePort(host = '127.0.0.1') {
  return await new Promise((resolve, reject) => {
    const server = createServer()
    server.unref()
    server.once('error', reject)
    server.listen(0, host, () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('unable to allocate an experience-gate port')))
        return
      }
      server.close((error) => error ? reject(error) : resolve(address.port))
    })
  })
}

function mockSessionCookie(baseURL, account) {
  const origin = new URL(baseURL)
  const identity = {
    email: account.email.trim().toLowerCase(),
    name: account.name.trim(),
  }
  return {
    name: 'todolist_mock_session',
    value: encodeURIComponent(JSON.stringify(identity)),
    domain: origin.hostname,
    path: '/',
    httpOnly: true,
    secure: origin.protocol === 'https:',
    sameSite: 'Lax',
  }
}

function coldAuthenticatedHTML(entryHTML, account) {
  const entryPattern = /<script type="module" crossorigin src="(\/assets\/index-[A-Za-z0-9_-]+\.js)"><\/script>/g
  const matches = [...entryHTML.matchAll(entryPattern)]
  if (matches.length !== 1) throw new Error('cold experience bootstrap requires exactly one Vite entry script')
  const entry = matches[0][1]
  const accountJSON = JSON.stringify(JSON.stringify(account)).replaceAll('<', '\\u003c')
  const bootstrap = `<script type="module">
const cache = await caches.open('todolist-mock-auth')
await cache.put('http://mock.local/session', new Response(${accountJSON}, { headers: { 'Content-Type': 'application/json' } }))
await import('${entry}')
</script>`
  return entryHTML.replace(entryPattern, bootstrap)
}

export async function seedColdMockSession(context, baseURL, account, entryHTML) {
  const body = coldAuthenticatedHTML(entryHTML, account)
  await context.route(`${baseURL}/tasks`, async (route) => {
    await route.fulfill({ status: 200, contentType: 'text/html', body })
  })
  await context.addCookies([mockSessionCookie(baseURL, account)])
}

export async function bootstrapMockAuthenticatedPage(context, page, baseURL, account, password) {
  const result = await page.evaluate(async ({ accountValue, passwordValue }) => {
    const register = await fetch('/api/auth/register', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: accountValue.name, email: accountValue.email, password: passwordValue }),
    })
    if (!register.ok && register.status !== 409) throw new Error(`mock register failed: ${register.status}`)
    const login = await fetch('/api/auth/login', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: accountValue.email, password: passwordValue }),
    })
    if (!login.ok) throw new Error(`mock login failed: ${login.status}`)
    return { registerStatus: register.status, loginStatus: login.status }
  }, { accountValue: account, passwordValue: password })
  if (result.registerStatus !== 201 && result.registerStatus !== 409) throw new Error(`mock register failed: ${result.registerStatus}`)
  if (result.loginStatus < 200 || result.loginStatus >= 300) throw new Error(`mock login failed: ${result.loginStatus}`)
  await context.addCookies([mockSessionCookie(baseURL, account)])
}

export function experienceAgentHistorySeed(timestamp) {
  return {
    sessions: [{
      id: 'e1e7c0de-7a5c-4b8d-9f10-123456789abc',
      title: '运行中验收会话',
      created_at: timestamp,
      updated_at: timestamp,
      last_message_at: timestamp,
      turns: [],
    }],
  }
}

export async function verifyEvidenceFiles(report, root) {
  for (const item of report.evidence) {
    const filePath = join(root, item.screenshot)
    let details
    try {
      details = await stat(filePath)
    } catch (error) {
      if (error?.code === 'ENOENT') throw new Error(`evidence path-${item.id} is missing`)
      throw error
    }
    if (!details.isFile() || details.size === 0) throw new Error(`evidence path-${item.id} is empty`)
  }
}

export function assertExperienceReport(report) {
  if (report?.schemaVersion !== 1) throw new Error('experience report schemaVersion must be 1')
  if (report?.status !== 'pass') throw new Error('experience report status must be pass')

  const entry = report?.build?.entry
  if (!entry || entry.gzipBytes >= ENTRY_GZIP_LIMIT_BYTES || entry.pass !== true) {
    throw new Error(`entry gzip must be < ${ENTRY_GZIP_LIMIT_BYTES} bytes`)
  }

  const samples = report?.fti?.samplesMs
  if (report?.fti?.mode !== 'cold-first-navigation') {
    throw new Error('FTI must measure a cold first navigation without prewarming the origin')
  }
  if (!Array.isArray(samples) || samples.length !== 5) throw new Error('experience report must contain exactly five FTI samples')
  samples.forEach((sample, index) => {
    if (!Number.isFinite(sample) || sample >= FTI_LIMIT_MS) throw new Error(`FTI sample ${index + 1} must be < ${FTI_LIMIT_MS}ms`)
  })
  if (report.fti.pass !== true) throw new Error('FTI gate must pass')

  for (const viewport of REQUIRED_VIEWPORTS) {
    const result = report?.overflow?.find((item) => item?.viewport?.width === viewport.width && item?.viewport?.height === viewport.height)
    if (!result || result.overflowPx !== 0 || result.pass !== true) {
      throw new Error(`${viewport.width}x${viewport.height} horizontal overflow must be zero`)
    }
  }

  const running = report?.agentRunning
  if (!running?.main?.scrollable || !(running.main.afterScrollTop > running.main.beforeScrollTop)) {
    throw new Error('main task area must remain scrollable while Agent runs')
  }
  if (!running?.nonConflictingControl?.enabled || !running.nonConflictingControl.operated) {
    throw new Error('non-conflicting control must remain operable while Agent runs')
  }
  if (running.pass !== true) throw new Error('Agent running experience gate must pass')

  if (!Array.isArray(report?.evidence) || report.evidence.length !== 8) {
    throw new Error('experience report must contain exactly eight evidence paths')
  }
  report.evidence.forEach((item, index) => {
    const expectedScreenshot = `docs/qa/evidence/path-${index + 1}.png`
    if (item?.id !== index + 1 || !item.timestamp || !Number.isFinite(item.durationMs) || item.durationMs < 0 || item.pass !== true || item.screenshot !== expectedScreenshot) {
      throw new Error(`evidence path ${index + 1} must include timestamp, duration, pass and screenshot`)
    }
  })

  return report
}
