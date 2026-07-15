import { expect, test } from '../fixtures/app.fixture'

test('@real all services are healthy through the frontend proxy', async ({ page, request }) => {
  const todoHealth = await request.get('/api/health')
  expect(todoHealth.ok()).toBeTruthy()
  await expect(todoHealth.json()).resolves.toMatchObject({ code: 0, data: { status: 'ok' } })

  const agentHealth = await request.get('/api/agent/health')
  expect(agentHealth.ok()).toBeTruthy()
  await expect(agentHealth.json()).resolves.toMatchObject({ status: 'ok' })

  await page.goto('/login')
  const registrations = await page.evaluate(async () => (
    'serviceWorker' in navigator ? (await navigator.serviceWorker.getRegistrations()).length : 0
  ))
  expect(registrations, 'the real-stack project must never register MSW').toBe(0)
})
