import { expect, test as base, type Page } from '@playwright/test'

export const FIXED_NOW = '2026-07-13T10:00:00+08:00'
const CONTEXT_INITIALIZED_COOKIE = 'todolist_e2e_initialized'

export interface DemoAccount {
  id: string
  name: string
  email: string
  timezone: string
  avatar: { kind: 'preset'; value: 'amber' | 'ocean' | 'forest' | 'violet' }
  taskCount: number
  agentSessionCount: number
}

export const demoAccount: DemoAccount = {
  id: 'e2e-demo-account',
  name: 'Plucky HZ',
  email: 'plucky@example.com',
  timezone: 'Asia/Shanghai (UTC+8)',
  avatar: { kind: 'preset', value: 'amber' },
  taskCount: 37,
  agentSessionCount: 12,
} as const

export interface LoginOptions {
  account?: DemoAccount
}

export interface AppFixtures {
  login: (options?: LoginOptions) => Promise<void>
  enableMotion: () => Promise<void>
  _appState: void
}

async function installTestState(page: Page) {
  await page.clock.setFixedTime(new Date(FIXED_NOW))
  await page.context().clearCookies({ name: CONTEXT_INITIALIZED_COOKIE })
  await page.context().addInitScript(() => {
    try {
      const initialized = document.cookie.split(';').some((part) => part.trim() === 'todolist_e2e_initialized=true')
      if (!initialized) {
        localStorage.clear()
        document.cookie = 'todolist_e2e_initialized=true; Path=/; SameSite=Lax'
      }
    } catch {
      // Storage is unavailable on opaque origins such as about:blank.
    }

    addEventListener('DOMContentLoaded', () => {
      if (sessionStorage.getItem('todolist:e2e:motion') === 'enabled') return
      const style = document.createElement('style')
      style.dataset.e2eMotion = 'disabled'
      style.textContent = `
        *, *::before, *::after {
          animation-delay: 0s !important;
          animation-duration: 0.001ms !important;
          scroll-behavior: auto !important;
          transition-delay: 0s !important;
          transition-duration: 0.001ms !important;
        }
      `
      document.head.append(style)
    }, { once: true })
  })
}

export async function reloadMockPage(page: Page) {
  const current = new URL(page.url())
  const target = `${current.pathname}${current.search}${current.hash}`
  await page.goto('about:blank')
  await page.goto(target)
}

export const test = base.extend<AppFixtures>({
  _appState: [async ({ page }, provide) => {
    await installTestState(page)
    await provide()
  }, { auto: true }],

  login: async ({ page }, provide) => {
    await provide(async ({ account = demoAccount } = {}) => {
      await page.goto('/login')
      await page.getByRole('button', { name: '登录' }).waitFor()
      await page.evaluate(({ accountValue }) => {
        localStorage.setItem('todolist.auth.account', JSON.stringify(accountValue))
        localStorage.setItem('todolist.auth.session', accountValue.id)
      }, { accountValue: account })
    })
  },

  enableMotion: async ({ page }, provide) => {
    await provide(async () => {
      await page.emulateMedia({ reducedMotion: 'no-preference' })
      await page.evaluate(() => {
        sessionStorage.setItem('todolist:e2e:motion', 'enabled')
        document.querySelectorAll('style[data-e2e-motion]').forEach((node) => node.remove())
      })
    })
  },
})

export { expect }
