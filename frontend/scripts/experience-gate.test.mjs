import assert from 'node:assert/strict'
import test from 'node:test'
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createServer } from 'node:net'
import { assertExperienceReport, findAvailablePort, verifyEvidenceFiles } from './experience-gate-lib.mjs'

function passingReport() {
  return {
    schemaVersion: 1,
    status: 'pass',
    build: {
      entry: { gzipBytes: 98_000, limitBytes: 100_000, pass: true },
    },
    fti: {
      mode: 'cold-first-navigation',
      samplesMs: [720, 760, 810, 780, 740],
      limitMs: 2_000,
      pass: true,
    },
    overflow: [
      { viewport: { width: 1223, height: 1227 }, overflowPx: 0, pass: true },
      { viewport: { width: 390, height: 844 }, overflowPx: 0, pass: true },
    ],
    agentRunning: {
      main: { scrollable: true, beforeScrollTop: 0, afterScrollTop: 120 },
      nonConflictingControl: { enabled: true, operated: true },
      pass: true,
    },
    evidence: Array.from({ length: 8 }, (_, index) => ({
      id: index + 1,
      timestamp: '2026-07-14T00:00:00.000Z',
      durationMs: 500,
      pass: true,
      screenshot: `docs/qa/evidence/path-${index + 1}.png`,
    })),
  }
}

test('accepts a complete passing experience report', () => {
  assert.doesNotThrow(() => assertExperienceReport(passingReport()))
})

test('rejects a report whose top-level status is not pass', () => {
  const report = passingReport()
  report.status = 'failed'
  assert.throws(() => assertExperienceReport(report), /status must be pass/i)
})

test('rejects forged or misplaced evidence paths', () => {
  const report = passingReport()
  report.evidence[2].screenshot = 'docs/qa/evidence/not-path-3.png'
  assert.throws(() => assertExperienceReport(report), /evidence path 3/i)
})

test('rejects missing and empty evidence files on disk', async () => {
  const root = await mkdtemp(join(tmpdir(), 'experience-evidence-'))
  try {
    const report = passingReport()
    const evidenceDir = join(root, 'docs/qa/evidence')
    await mkdir(evidenceDir, { recursive: true })
    for (let id = 1; id <= 8; id += 1) {
      await writeFile(join(evidenceDir, `path-${id}.png`), id === 4 ? '' : `png-${id}`)
    }
    await assert.rejects(() => verifyEvidenceFiles(report, root), /path-4.*empty/i)
    await writeFile(join(evidenceDir, 'path-4.png'), 'png-4')
    await rm(join(evidenceDir, 'path-7.png'))
    await assert.rejects(() => verifyEvidenceFiles(report, root), /path-7.*missing/i)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

async function exerciseGateTermination({ signal, expectedCode, extraEnv = {} }) {
  const stateDir = await mkdtemp(join(tmpdir(), 'experience-signal-'))
  const stateFile = join(stateDir, 'ready.json')
  const child = spawn(process.execPath, ['scripts/experience-gate.mjs'], {
    cwd: join(import.meta.dirname, '..'),
    env: { ...process.env, EXPERIENCE_GATE_SIGNAL_READY_FILE: stateFile, ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout.on('data', (chunk) => { output += chunk })
  child.stderr.on('data', (chunk) => { output += chunk })
  try {
    let state
    for (let attempt = 0; attempt < 200; attempt += 1) {
      try { state = JSON.parse(await readFile(stateFile, 'utf8')); break } catch { /* wait for ready state */ }
      if (child.exitCode !== null) assert.fail(`gate exited before signal readiness (${child.exitCode})\n${output}`)
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    assert.ok(state, `gate never exposed signal readiness\n${output}`)
    if (signal) child.kill(signal)
    const exit = child.exitCode !== null ? { code: child.exitCode, signal: child.signalCode } : await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`gate did not exit after ${signal ?? 'fault injection'}\n${output}`)), 10_000)
      child.once('exit', (code, signal) => { clearTimeout(timer); resolve({ code, signal }) })
    })
    assert.deepEqual(exit, { code: expectedCode, signal: null })
    assert.throws(() => process.kill(state.previewPid, 0), /ESRCH/)
    await new Promise((resolve, reject) => {
      const server = createServer()
      server.once('error', reject)
      server.listen(state.previewPort, '127.0.0.1', () => server.close((error) => error ? reject(error) : resolve()))
    })
  } finally {
    if (child.exitCode === null) child.kill('SIGKILL')
    try {
      const state = JSON.parse(await readFile(stateFile, 'utf8'))
      try { process.kill(-state.previewPid, 'SIGKILL') } catch { /* already clean */ }
    } catch { /* no preview was reported */ }
    await rm(stateDir, { recursive: true, force: true })
  }
}

test('SIGTERM cleans the detached preview group and preserves exit code 143', { timeout: 30_000 }, async () => {
  await exerciseGateTermination({ signal: 'SIGTERM', expectedCode: 143, extraEnv: { EXPERIENCE_GATE_HOLD_FOR_SIGNAL: 'true' } })
})

test('SIGINT cleans the detached preview group and preserves exit code 130', { timeout: 30_000 }, async () => {
  await exerciseGateTermination({ signal: 'SIGINT', expectedCode: 130, extraEnv: { EXPERIENCE_GATE_HOLD_FOR_SIGNAL: 'true' } })
})

test('a runtime failure still cleans the detached preview group and port', { timeout: 30_000 }, async () => {
  await exerciseGateTermination({ expectedCode: 1, extraEnv: { EXPERIENCE_GATE_FAIL_AFTER_READY: 'true' } })
})

test('allocates an isolated preview port instead of assuming a shared fixed port', async () => {
  const port = await findAvailablePort()
  assert.equal(Number.isInteger(port), true)
  assert.equal(port > 0, true)
  await new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => server.close((error) => error ? reject(error) : resolve()))
  })
})

test('rejects an entry bundle at or above 100 KB gzip', () => {
  const report = passingReport()
  report.build.entry.gzipBytes = 100_000
  report.build.entry.pass = false
  assert.throws(() => assertExperienceReport(report), /entry gzip/i)
})

test('requires exactly five FTI samples and rejects any sample at or above two seconds', () => {
  const missing = passingReport()
  missing.fti.samplesMs.pop()
  assert.throws(() => assertExperienceReport(missing), /five FTI samples/i)

  const slow = passingReport()
  slow.fti.samplesMs[3] = 2_000
  slow.fti.pass = false
  assert.throws(() => assertExperienceReport(slow), /FTI sample 4/i)
})

test('rejects FTI measured after a warm-up navigation', () => {
  const report = passingReport()
  report.fti.mode = 'prewarmed-navigation'
  assert.throws(() => assertExperienceReport(report), /cold first navigation/i)
})

test('requires zero horizontal overflow at both required viewports', () => {
  const report = passingReport()
  report.overflow[1].overflowPx = 1
  report.overflow[1].pass = false
  assert.throws(() => assertExperienceReport(report), /390x844 horizontal overflow/i)
})

test('requires the main task area to scroll and a non-conflicting control to operate while Agent runs', () => {
  const blocked = passingReport()
  blocked.agentRunning.nonConflictingControl.operated = false
  blocked.agentRunning.pass = false
  assert.throws(() => assertExperienceReport(blocked), /non-conflicting control/i)

  const frozen = passingReport()
  frozen.agentRunning.main.afterScrollTop = 0
  frozen.agentRunning.pass = false
  assert.throws(() => assertExperienceReport(frozen), /main task area/i)
})

test('requires eight reproducible evidence screenshots with timing metadata', () => {
  const missing = passingReport()
  missing.evidence.pop()
  assert.throws(() => assertExperienceReport(missing), /eight evidence paths/i)

  const incomplete = passingReport()
  incomplete.evidence[4].screenshot = ''
  assert.throws(() => assertExperienceReport(incomplete), /evidence path 5/i)
})
