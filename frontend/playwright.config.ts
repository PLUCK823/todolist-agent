import { defineConfig, devices } from '@playwright/test'

const mockBaseURL = 'http://127.0.0.1:3000'
const realBaseURL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:8080'
const runRealOnly = process.env.E2E_REAL === 'true'

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global.setup.ts',
  outputDir: './test-results/artifacts',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: process.env.CI ? [['line'], ['html', { open: 'never' }]] : 'line',
  expect: { timeout: 15_000 },
  use: {
    baseURL: mockBaseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    reducedMotion: 'reduce',
  },
  webServer: runRealOnly ? undefined : {
    command: 'VITE_ENABLE_MSW=true pnpm dev --host 127.0.0.1',
    url: mockBaseURL,
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    { name: 'chromium', grepInvert: /@real/, use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', grepInvert: /@real/, use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', grepInvert: /@real/, use: { ...devices['Desktop Safari'] } },
    {
      name: 'real-chromium',
      grep: /@real/,
      use: { ...devices['Desktop Chrome'], baseURL: realBaseURL, reducedMotion: 'reduce' },
    },
  ],
})
