import type { Page } from '@playwright/test'
import { expect, test } from '../fixtures/agent.fixture'

const desktop = { width: 1223, height: 1227 }

async function authenticatedPage(page: Page, login: () => Promise<void>, path: string) {
  await page.setViewportSize(desktop)
  await login()
  await page.goto(path)
  await page.locator('main, section').first().waitFor()
}

async function capture(page: Page, name: string) {
  await expect(page).toHaveScreenshot(name, {
    fullPage: true,
    animations: 'disabled',
    caret: 'hide',
    maxDiffPixelRatio: 0.01,
  })
}

test.describe('V6 desktop visual contract', () => {
  test.use({ viewport: desktop })

  test('tasks with Agent expanded and collapsed', async ({ page, login }) => {
    await authenticatedPage(page, login, '/tasks')
    await expect(page.getByRole('heading', { name: '今天，保持专注' })).toBeVisible()
    await capture(page, 'tasks-agent-expanded.png')
    await page.getByRole('button', { name: '收起智能助手' }).click()
    await expect(page.getByTestId('agent-column')).toHaveCount(0)
    await capture(page, 'tasks-agent-collapsed.png')
  })

  for (const [path, heading, name] of [
    ['/upcoming', '近期安排', 'upcoming.png'],
    ['/assistant', '智能助手', 'assistant.png'],
    ['/profile', '个人资料', 'profile.png'],
  ] as const) {
    test(`${name} page`, async ({ page, login }) => {
      await authenticatedPage(page, login, path)
      await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible()
      await capture(page, name)
    })
  }

  for (const [path, heading, name] of [
    ['/login', 'Agent TodoList', 'login.png'],
    ['/register', 'Agent TodoList', 'register.png'],
  ] as const) {
    test(`${name} page`, async ({ page }) => {
      await page.setViewportSize(desktop)
      await page.goto(path)
      await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible()
      await capture(page, name)
    })
  }

  test('task, delete, settings, avatar and quick-ask overlays', async ({ page, login }) => {
    await authenticatedPage(page, login, '/tasks')
    await page.locator('header').getByRole('button', { name: '新建任务' }).click()
    await expect(page.getByRole('dialog', { name: '新建任务' })).toBeVisible()
    await capture(page, 'overlay-task-create.png')
    await page.keyboard.press('Escape')

    await page.getByRole('button', { name: '删除任务：完成项目文档' }).click()
    await expect(page.getByRole('dialog', { name: '删除任务' })).toBeVisible()
    await capture(page, 'overlay-task-delete.png')
    await page.keyboard.press('Escape')

    await page.getByRole('button', { name: '设置' }).click()
    await expect(page.getByRole('dialog', { name: '设置' })).toBeVisible()
    await capture(page, 'overlay-settings.png')
    await page.keyboard.press('Escape')

    await page.goto('/profile')
    await page.getByRole('button', { name: '更换头像' }).click()
    await expect(page.getByRole('dialog', { name: '更换头像' })).toBeVisible()
    await capture(page, 'overlay-avatar.png')
    await page.keyboard.press('Escape')

    await page.goto('/tasks')
    await page.getByRole('button', { name: /快速询问/ }).click()
    await expect(page.getByRole('dialog', { name: '快速询问' })).toBeVisible()
    await capture(page, 'overlay-quick-ask.png')
  })

  test('Agent running and failure states', async ({ page, login, useAgentScenario }) => {
    await authenticatedPage(page, login, '/tasks')
    await useAgentScenario('success', { timeScale: 2 })
    await page.getByLabel('消息输入框').fill('创建高优先级任务')
    await page.getByRole('button', { name: '发送消息' }).click()
    await expect(page.getByRole('list', { name: 'Agent 执行步骤' })).toContainText('运行中')
    await capture(page, 'agent-running.png')

    await page.getByRole('button', { name: '清空对话' }).click()
    await useAgentScenario('timeout')
    await page.getByLabel('消息输入框').fill('创建超时任务')
    await page.getByRole('button', { name: '发送消息' }).click()
    await expect(page.getByRole('alert').filter({ hasText: 'Todo API 响应超时' })).toBeVisible()
    await capture(page, 'agent-failure.png')
  })
})
