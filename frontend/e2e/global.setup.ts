import { mkdir, rm } from 'node:fs/promises'
import { resolve } from 'node:path'

export default async function globalSetup() {
  const resultsDir = resolve(process.cwd(), 'test-results')
  await rm(resultsDir, { recursive: true, force: true })
  await mkdir(resolve(resultsDir, 'artifacts'), { recursive: true })
}
