import { postE2EControl } from '../fixtures/api.fixture'
import { expect, test } from '../fixtures/agent.fixture'

test.beforeEach(async ({ login }) => { await login() })

const seededHistory = {
  sessions: [
    {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      title: '安全 Markdown 与历史',
      created_at: '2026-07-13T01:00:00Z',
      updated_at: '2026-07-13T01:04:00Z',
      last_message_at: '2026-07-13T01:04:00Z',
      turns: [
        {
          id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', ordinal: 1, status: 'completed',
          started_at: '2026-07-13T01:00:00Z', completed_at: '2026-07-13T01:00:02Z',
          failure_code: null, failure_message: null, result_uncertain: false,
          messages: [
            { id: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1', role: 'user', content: '列出任务', ordinal: 1, created_at: '2026-07-13T01:00:00Z' },
            {
              id: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2', role: 'assistant', ordinal: 2,
              content: '| 任务 | 优先级 |\n| --- | --- |\n| 复评审 | 高 |\n\n<img src=x onerror="window.__rawHtmlRan=true"> ![远程图](https://example.invalid/tracker.png)',
              created_at: '2026-07-13T01:00:02Z',
            },
          ],
          steps: [{
            id: 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1', event_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1', ordinal: 1,
            label: '查询 Todo 列表', tool: 'list_todos', status: 'completed', args: {}, result: { total: 1 },
            result_preview: '{"total":1}', result_truncated: false, duration_ms: 1200, error_code: null,
            error_message: null, retryable: false, confirmation_id: null, confirmation_message: null,
            confirmation_approved: null, started_at: '2026-07-13T01:00:00Z', completed_at: '2026-07-13T01:00:02Z',
          }],
        },
        ...(['failed', 'interrupted'] as const).map((status, index) => ({
          id: `bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb${index + 2}`,
          ordinal: index + 2, status, started_at: `2026-07-13T01:0${index + 1}:00Z`, completed_at: `2026-07-13T01:0${index + 1}:01Z`,
          failure_code: status === 'failed' ? 'TOOL_TIMEOUT' : 'STREAM_INTERRUPTED', failure_message: status,
          result_uncertain: status === 'interrupted',
          messages: [{
            id: `cccccccc-cccc-4ccc-8ccc-ccccccccccc${index + 3}`, role: 'user', content: `turn-${status}`,
            ordinal: index + 3, created_at: `2026-07-13T01:0${index + 1}:00Z`,
          }],
          steps: [{
            id: `dddddddd-dddd-4ddd-8ddd-ddddddddddd${index + 2}`, event_id: `eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee${index + 2}`,
            ordinal: 1, label: status, tool: 'list_todos', status, args: {}, result: null, result_preview: null,
            result_truncated: false, duration_ms: 1000, error_code: status, error_message: status, retryable: false,
            confirmation_id: null, confirmation_message: null, confirmation_approved: null,
            started_at: `2026-07-13T01:0${index + 1}:00Z`, completed_at: `2026-07-13T01:0${index + 1}:01Z`,
          }],
        })),
      ],
    },
  ],
}

async function seedHistory(page: import('@playwright/test').Page) {
  await postE2EControl(page, '/api/__e2e__/agent/history', seededHistory)
}

function capturePageFailures(page: import('@playwright/test').Page) {
  const failures: string[] = []
  page.on('pageerror', (error) => failures.push(`pageerror: ${error.message}`))
  page.on('console', (message) => {
    if (message.type() === 'error') failures.push(`console: ${message.text()}`)
  })
  return failures
}

test('renders safe GFM and assigns one disclosure to every restored turn', async ({ page }) => {
  const failures = capturePageFailures(page)
  await page.goto('/assistant')
  await seedHistory(page)
  await page.reload()

  const table = page.getByRole('table')
  await expect(table).toBeVisible()
  await expect(table.getByRole('columnheader')).toHaveText(['任务', '优先级'])
  await expect(table.getByRole('cell')).toHaveText(['复评审', '高'])
  await expect(page.locator('img')).toHaveCount(0)
  await expect(page.getByText('<img src=x onerror="window.__rawHtmlRan=true">', { exact: false })).toBeVisible()
  expect(await page.evaluate(() => (window as typeof window & { __rawHtmlRan?: boolean }).__rawHtmlRan)).not.toBe(true)

  const turns = page.locator('[data-testid^="agent-turn-"]')
  await expect(turns).toHaveCount(3)
  await expect(turns.nth(0).getByRole('button', { name: /执行详情/ })).toHaveAttribute('aria-expanded', 'false')
  await expect(turns.nth(1).getByRole('button', { name: /执行详情/ })).toHaveAttribute('aria-expanded', 'true')
  await expect(turns.nth(2).getByRole('button', { name: /执行详情/ })).toHaveAttribute('aria-expanded', 'true')
  await expect(turns.nth(2).getByRole('alert')).toContainText('操作可能已生效')
  expect(failures).toEqual([])
})

for (const viewport of [{ width: 1280, height: 720 }, { width: 390, height: 844 }]) {
  test(`keeps only conversation scrollable and composer inside ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await page.goto('/assistant')
    await seedHistory(page)
    await page.reload()
    await expect(page.getByLabel('智能助手消息')).toBeVisible()

    const boxes = await page.evaluate(() => {
      const conversation = document.querySelector<HTMLElement>('.assistant-conversation__scroll')!
      const composer = document.querySelector<HTMLElement>('.assistant-composer')!
      const textarea = document.querySelector<HTMLTextAreaElement>('.assistant-composer__input')!
      const conversationBox = conversation.getBoundingClientRect()
      const composerBox = composer.getBoundingClientRect()
      return {
        documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        bodyOverflowY: getComputedStyle(document.body).overflowY,
        conversationOverflowY: getComputedStyle(conversation).overflowY,
        conversationBottom: conversationBox.bottom,
        composerTop: composerBox.top,
        composerBottom: composerBox.bottom,
        textareaHeight: textarea.getBoundingClientRect().height,
      }
    })
    expect(boxes.documentOverflow).toBeLessThanOrEqual(0)
    expect(boxes.bodyOverflowY).not.toBe('auto')
    expect(boxes.conversationOverflowY).toBe('auto')
    expect(boxes.textareaHeight).toBeCloseTo(56, 0)
    expect(boxes.conversationBottom).toBeLessThanOrEqual(boxes.composerTop)
    expect(boxes.composerBottom).toBeLessThanOrEqual(viewport.height)

    if (viewport.width <= 860) await page.getByRole('button', { name: '打开会话列表' }).click()
    await page.getByRole('button', { name: '新建会话' }).click()
    if (viewport.width <= 860) await page.getByRole('button', { name: '关闭会话列表', exact: true }).click()
    const input = page.getByLabel('智能助手消息')
    await expect(input).toBeEnabled()
    await input.fill(Array.from({ length: 40 }, (_, index) => `第 ${index} 行`).join('\n'))
    await expect.poll(() => input.evaluate((element) => element.getBoundingClientRect().height)).toBeLessThanOrEqual(220)
    await input.evaluate((element) => { element.style.height = '360px' })
    await expect.poll(() => input.evaluate((element) => element.getBoundingClientRect().height)).toBeLessThanOrEqual(360)
  })
}

test('creates, selects, renames, restores and deletes an owned session', async ({ page, useAgentScenario }) => {
  await useAgentScenario('success')
  await page.goto('/assistant')
  await expect(page.getByRole('button', { name: '新建会话' })).toBeVisible()
  await page.getByRole('button', { name: '新建会话' }).click()
  await page.getByLabel('智能助手消息').fill('持久化会话消息')
  await page.getByRole('button', { name: '发送消息' }).click()
  await expect(page.getByRole('log')).toContainText('好的，已创建高优先级任务。')
  await page.reload()
  await expect(page.getByRole('log')).toContainText('持久化会话消息')

  await page.getByRole('button', { name: /会话操作/ }).click()
  await page.getByRole('button', { name: '重命名会话' }).click()
  await page.getByLabel('会话名称').fill('已重命名会话')
  await page.getByRole('button', { name: '保存名称' }).click()
  await expect(page.getByRole('button', { name: '打开会话：已重命名会话' })).toBeVisible()

  await page.getByRole('button', { name: /会话操作/ }).click()
  await page.getByRole('button', { name: '删除会话' }).click()
  await page.getByRole('button', { name: '确认删除会话' }).click()
  await expect(page.getByRole('button', { name: '打开会话：已重命名会话' })).toHaveCount(0)
})

test('mobile session drawer traps keyboard focus and closes with Escape', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/assistant')
  await seedHistory(page)
  await page.reload()
  const opener = page.getByRole('button', { name: '打开会话列表' })
  await opener.focus()
  await page.keyboard.press('Enter')
  const drawer = page.getByRole('complementary', { name: '会话列表' })
  const close = page.getByRole('button', { name: '关闭会话列表', exact: true })
  await expect(drawer).toBeVisible()
  await page.keyboard.press('Tab')
  await expect(close).toBeFocused()
  const focusable = drawer.locator('button:not([disabled])')
  expect(await focusable.count()).toBeGreaterThan(2)
  const last = focusable.last()
  await page.keyboard.press('Shift+Tab')
  await expect(last).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(close).toBeFocused()
  for (let index = 0; index < await focusable.count() + 2; index++) {
    await page.keyboard.press('Tab')
    expect(await drawer.evaluate((element) => element.contains(document.activeElement))).toBe(true)
    await expect(opener).not.toBeFocused()
  }
  await page.keyboard.press('Escape')
  await expect(opener).toBeFocused()
})
