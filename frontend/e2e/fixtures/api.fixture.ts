import type { Todo } from '../../src/features/todos/todo.types'
import { defaultTodos } from '../../src/mocks/handlers'
import { expect, test as appTest } from './app.fixture'
import type { Page } from '@playwright/test'

export interface FailNextTodoRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  path?: string
  status?: number
  message?: string
}

export interface ApiFixtures {
  seedTodos: (todos?: Todo[]) => Promise<void>
  failNextTodoRequest: (options?: FailNextTodoRequestOptions) => Promise<void>
  _apiState: void
}

async function ensureMockPage(page: Page) {
  if (page.url() === 'about:blank') await page.goto('/login')
  await page.getByRole('button', { name: '登录' }).waitFor()
}

export async function postE2EControl(page: Page, path: string, body: unknown) {
  await ensureMockPage(page)
  const response = await page.evaluate(async ({ controlPath, payload }) => {
    const result = await fetch(controlPath, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
    return { ok: result.ok, status: result.status, text: await result.text() }
  }, { controlPath: path, payload: body })
  if (!response.ok) throw new Error(`E2E control ${path} failed (${response.status}): ${response.text}`)
}

export const test = appTest.extend<ApiFixtures>({
  seedTodos: async ({ page }, provide) => {
    await provide((todos = defaultTodos) => postE2EControl(page, '/api/__e2e__/todos/seed', { todos }))
  },

  failNextTodoRequest: async ({ page }, provide) => {
    await provide((options = {}) => postE2EControl(page, '/api/__e2e__/todos/fail-next', options))
  },

  _apiState: [async ({ page }, provide) => {
    await postE2EControl(page, '/api/__e2e__/todos/seed', { todos: defaultTodos })
    await provide()
  }, { auto: true }],
})

export { defaultTodos, expect }
