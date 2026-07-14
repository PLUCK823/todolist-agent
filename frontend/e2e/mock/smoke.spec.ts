import { expect, test } from '../fixtures/agent.fixture'

test('loads the authenticated task dashboard', async ({ page, login }) => {
  await login()
  await page.goto('/tasks')
  await expect(page.getByRole('heading', { name: '今天，保持专注' })).toBeVisible()
})
