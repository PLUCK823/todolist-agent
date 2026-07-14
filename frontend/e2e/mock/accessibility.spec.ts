import AxeBuilder from '@axe-core/playwright'
import type { Locator, Page } from '@playwright/test'
import { expect, test } from '../fixtures/agent.fixture'

async function expectNoAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page }).analyze()
  expect(results.violations, results.violations.map((violation) =>
    `${violation.id}: ${violation.help}\n${violation.nodes.map((node) => node.target.join(' ')).join('\n')}`,
  ).join('\n\n')).toEqual([])
}

async function openAuthenticated(page: Page, login: () => Promise<void>, path: string) {
  await login()
  await page.goto(path)
  await page.locator('main, section').first().waitFor()
}

async function assertFocusTrapped(page: Page, dialog: Locator) {
  for (let index = 0; index < 16; index += 1) {
    await page.keyboard.press(index % 5 === 0 ? 'Shift+Tab' : 'Tab')
    expect(await dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true)
  }
}

async function tabTo(page: Page, target: Locator, options: { reverse?: boolean; limit?: number } = {}) {
  const key = options.reverse ? 'Shift+Tab' : 'Tab'
  const limit = options.limit ?? 80
  for (let index = 0; index < limit; index += 1) {
    if (await target.evaluate((node) => node === document.activeElement)) return
    await page.keyboard.press(key)
  }
  throw new Error(`Could not reach keyboard target after ${limit} ${key} presses`)
}

test.describe('WCAG 2.2 AA automated checks', () => {
  for (const [path, heading] of [
    ['/login', 'Agent TodoList'],
    ['/register', 'Agent TodoList'],
  ] as const) {
    test(`${path} has no axe violations`, async ({ page }) => {
      await page.goto(path)
      await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible()
      await expectNoAxeViolations(page)
    })
  }

  for (const [path, heading] of [
    ['/tasks', '今天，保持专注'],
    ['/upcoming', '近期安排'],
    ['/assistant', '智能助手'],
    ['/profile', '个人资料'],
  ] as const) {
    test(`${path} has no axe violations`, async ({ page, login }) => {
      await openAuthenticated(page, login, path)
      await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible()
      await expectNoAxeViolations(page)
    })
  }

  test('task create, detail, edit and delete dialogs have no axe violations', async ({ page, login }) => {
    await openAuthenticated(page, login, '/tasks')

    await page.locator('header').getByRole('button', { name: '新建任务' }).click()
    await expect(page.getByRole('dialog', { name: '新建任务' })).toBeVisible()
    await expectNoAxeViolations(page)
    await page.keyboard.press('Escape')

    await page.getByRole('button', { name: '查看任务：完成项目文档' }).click()
    await expect(page.getByRole('dialog', { name: '任务详情' })).toBeVisible()
    await expectNoAxeViolations(page)
    await page.getByRole('button', { name: '编辑任务' }).click()
    await expect(page.getByRole('dialog', { name: '编辑任务' })).toBeVisible()
    await expectNoAxeViolations(page)
    await page.keyboard.press('Escape')

    await page.getByRole('button', { name: '删除任务：完成项目文档' }).click()
    await expect(page.getByRole('dialog', { name: '删除任务' })).toBeVisible()
    await expectNoAxeViolations(page)
  })

  test('status and priority filter popovers have no axe violations', async ({ page, login }) => {
    await openAuthenticated(page, login, '/tasks')
    await page.getByRole('button', { name: '全部状态' }).click()
    await expect(page.getByRole('dialog', { name: '状态筛选' })).toBeVisible()
    await expectNoAxeViolations(page)
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: '优先级' }).click()
    await expect(page.getByRole('dialog', { name: '优先级筛选' })).toBeVisible()
    await expectNoAxeViolations(page)
  })

  test('settings and quick ask dialogs have no axe violations', async ({ page, login }) => {
    await openAuthenticated(page, login, '/tasks')
    await page.getByRole('button', { name: '设置' }).click()
    await expect(page.getByRole('dialog', { name: '设置' })).toBeVisible()
    await expectNoAxeViolations(page)
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: /快速询问/ }).click()
    await expect(page.getByRole('dialog', { name: '快速询问' })).toBeVisible()
    await expectNoAxeViolations(page)
  })

  test('avatar and logout dialogs have no axe violations', async ({ page, login }) => {
    await openAuthenticated(page, login, '/profile')
    await page.getByRole('button', { name: '更换头像' }).click()
    await expect(page.getByRole('dialog', { name: '更换头像' })).toBeVisible()
    await expectNoAxeViolations(page)
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: '退出登录' }).click()
    await expect(page.getByRole('dialog', { name: '确认退出登录' })).toBeVisible()
    await expectNoAxeViolations(page)
  })
})

test('completes the primary task controls with keyboard only', async ({ page, login, seedTodos }) => {
  await seedTodos([])
  await openAuthenticated(page, login, '/tasks')

  const newTask = page.locator('header').getByRole('button', { name: '新建任务' })
  await tabTo(page, newTask)
  await expect(newTask).toBeFocused()
  await page.keyboard.press('Enter')
  const createDialog = page.getByRole('dialog', { name: '新建任务' })
  await expect(createDialog).toBeVisible()
  await assertFocusTrapped(page, createDialog)
  await tabTo(page, createDialog.getByLabel('任务标题'))
  await page.keyboard.type('键盘创建任务')
  await tabTo(page, createDialog.getByRole('button', { name: '创建任务' }))
  await page.keyboard.press('Enter')
  await expect(page.getByRole('button', { name: '查看任务：键盘创建任务' })).toBeVisible()

  await tabTo(page, page.getByRole('button', { name: '全部状态' }))
  await page.keyboard.press('Space')
  const status = page.getByRole('dialog', { name: '状态筛选' })
  await expect(status).toBeVisible()
  await expect(status.getByRole('button', { name: '全部状态' })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(status.getByRole('button', { name: '进行中' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(status).toBeHidden()

  await tabTo(page, page.getByRole('button', { name: '收起智能助手' }))
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('agent-column')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '展开智能助手' })).toBeFocused()
  await page.keyboard.press('Space')
  await expect(page.getByTestId('agent-column')).toBeVisible()

  const quick = page.getByRole('button', { name: /快速询问/ })
  await tabTo(page, quick)
  await page.keyboard.press('Enter')
  const quickDialog = page.getByRole('dialog', { name: '快速询问' })
  await expect(quickDialog).toBeVisible()
  await assertFocusTrapped(page, quickDialog)
  await page.keyboard.press('Escape')
  await expect(quick).toBeFocused()
})

test('traps focus, dismisses and confirms logout with keyboard only', async ({ page, login }) => {
  await openAuthenticated(page, login, '/profile')
  const logout = page.getByRole('button', { name: '退出登录' })
  await tabTo(page, logout)
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog', { name: '确认退出登录' })
  await expect(dialog).toBeVisible()
  await assertFocusTrapped(page, dialog)
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(logout).toBeFocused()

  await page.keyboard.press('Space')
  await expect(dialog).toBeVisible()
  await tabTo(page, dialog.getByRole('button', { name: '确认退出' }))
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByRole('button', { name: '登录' })).toBeVisible()
})

test('system reduced motion caps Shell and Dialog animation durations at 1ms', async ({ page, login, enableMotion }) => {
  await enableMotion()
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await openAuthenticated(page, login, '/tasks')
  await page.getByRole('button', { name: /快速询问/ }).click()
  const durations = await page.evaluate(() => {
    const shell = document.querySelector<HTMLElement>('[data-testid="app-shell"]')
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')
    const read = (node: HTMLElement | null) => {
      if (!node) throw new Error('expected reduced-motion target')
      const style = getComputedStyle(node)
      return [...style.animationDuration.split(','), ...style.transitionDuration.split(',')]
        .map((value) => value.trim().endsWith('ms') ? Number.parseFloat(value) : Number.parseFloat(value) * 1000)
    }
    return { shell: read(shell), dialog: read(dialog) }
  })
  for (const duration of [...durations.shell, ...durations.dialog]) expect(duration).toBeLessThanOrEqual(1)
})
