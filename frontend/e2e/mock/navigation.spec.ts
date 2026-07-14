import { expect, test } from '../fixtures/agent.fixture'

test.beforeEach(async ({ login }) => { await login() })

test('navigates among all four workspaces with an active destination', async ({ page }) => {
  await page.goto('/tasks')
  const destinations = [
    ['近期安排', '/upcoming', '近期安排'],
    ['智能助手', '/assistant', '智能助手'],
    ['用户资料', '/profile', '个人资料'],
    ['我的任务', '/tasks', '今天，保持专注'],
  ] as const
  for (const [label, path, heading] of destinations) {
    const link = page.getByRole('link', { name: label })
    await link.click()
    await expect(page).toHaveURL(new RegExp(`${path}$`))
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible()
    await expect(link).toHaveAttribute('aria-current', 'page')
  }
})

test('expands the icon rail, exposes labels and persists the state across reload', async ({ page }) => {
  await page.goto('/tasks')
  const navigation = page.getByRole('navigation', { name: '主导航' })
  await expect(navigation).toHaveAttribute('data-expanded', 'false')
  await page.getByRole('button', { name: '展开导航' }).click()
  await expect(navigation).toHaveAttribute('data-expanded', 'true')
  await expect(page.getByText('近期安排', { exact: true })).toBeVisible()
  await page.reload()
  await expect(navigation).toHaveAttribute('data-expanded', 'true')
  await page.getByRole('button', { name: '收起导航' }).click()
  await expect(navigation).toHaveAttribute('data-expanded', 'false')
})

test('fully removes the collapsed Agent column and places its spark after new task', async ({ page }) => {
  await page.goto('/tasks')
  await expect(page.getByTestId('agent-column')).toBeVisible()
  await page.getByRole('button', { name: '收起智能助手' }).click()
  await expect(page.getByTestId('agent-column')).toHaveCount(0)
  const newTask = page.getByRole('button', { name: '新建任务' })
  const spark = page.getByRole('button', { name: '展开智能助手' })
  await expect(spark).toBeVisible()
  const actionsSlot = newTask.locator('xpath=following-sibling::*[1]')
  await expect(actionsSlot).toHaveClass(/shell-header-actions-slot/)
  await expect(actionsSlot.getByRole('button', { name: '展开智能助手' })).toBeVisible()
  await spark.click()
  await expect(page.getByTestId('agent-column')).toBeVisible()
})

test('opens quick ask with both shortcuts and restores focus after Escape', async ({ page }) => {
  await page.goto('/tasks')
  const trigger = page.getByRole('button', { name: /快速询问/ })
  await trigger.focus()
  await page.keyboard.press('Meta+K')
  const dialog = page.getByRole('dialog', { name: '快速询问' })
  await expect(dialog).toBeVisible()
  await expect(page.getByLabel('快速询问内容')).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(trigger).toBeFocused()

  await page.keyboard.press('Alt+K')
  await expect(dialog).toBeVisible()
  await page.keyboard.press('Escape')
})

test('does not hijack Alt+K while typing in an editable field', async ({ page }) => {
  await page.goto('/tasks')
  const search = page.getByLabel('搜索任务')
  await search.focus()
  await page.keyboard.press('Alt+K')
  await expect(page.getByRole('dialog', { name: '快速询问' })).toHaveCount(0)
  await expect(search).toBeFocused()
})
