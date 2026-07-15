import { gzipSync } from 'node:zlib'
import { readFile } from 'node:fs/promises'
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

export function assertExperienceReport(report) {
  if (report?.schemaVersion !== 1) throw new Error('experience report schemaVersion must be 1')

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
    if (item?.id !== index + 1 || !item.timestamp || !Number.isFinite(item.durationMs) || item.durationMs < 0 || item.pass !== true || !item.screenshot) {
      throw new Error(`evidence path ${index + 1} must include timestamp, duration, pass and screenshot`)
    }
  })

  return report
}
