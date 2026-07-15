import assert from 'node:assert/strict'
import test from 'node:test'

import { createServer } from 'node:net'
import { assertExperienceReport, findAvailablePort } from './experience-gate-lib.mjs'

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
      screenshot: `evidence/${index + 1}.png`,
    })),
  }
}

test('accepts a complete passing experience report', () => {
  assert.doesNotThrow(() => assertExperienceReport(passingReport()))
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
