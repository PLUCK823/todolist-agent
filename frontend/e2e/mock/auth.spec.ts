import { expect, test } from '../fixtures/agent.fixture'

async function register(page: import('@playwright/test').Page, email = 'new@example.com', password = 'password8') {
  await page.goto('/register')
  await page.getByLabel('显示名称').fill('新用户')
  await page.getByLabel('邮箱地址').fill(email)
  await page.getByLabel('密码').fill(password)
  await page.getByRole('button', { name: '创建账号' }).click()
  await expect(page).toHaveURL(/\/login$/)
}

test('validates registration fields without leaving the form', async ({ page }) => {
  await page.goto('/register')
  await page.getByRole('button', { name: '创建账号' }).click()
  await expect(page.getByText('请输入显示名称')).toBeVisible()
  await expect(page.getByText('请输入有效的邮箱地址')).toBeVisible()
  await expect(page.getByText('密码至少需要 8 位')).toBeVisible()
  await expect(page).toHaveURL(/\/register$/)
})

test('registers an account and returns to login with the email prefilled', async ({ page }) => {
  await register(page, 'Plucky+E2E@example.com')
  await expect(page.getByRole('status')).toContainText('账号已创建，请登录')
  await expect(page.getByLabel('邮箱地址')).toHaveValue('Plucky+E2E@example.com')
})

test('shows a useful error for invalid login credentials', async ({ page }) => {
  await register(page)
  await page.getByLabel('密码').fill('incorrect-password')
  await page.getByRole('button', { name: '登录' }).click()
  await expect(page.getByRole('alert')).toHaveText('邮箱或密码不正确')
  await expect(page).toHaveURL(/\/login$/)
})

test('logs in and returns to the originally requested protected route', async ({ page }) => {
  await page.goto('/upcoming')
  await expect(page).toHaveURL(/\/login$/)
  await page.getByRole('link', { name: '注册' }).click()
  await page.getByLabel('显示名称').fill('返回目标用户')
  await page.getByLabel('邮箱地址').fill('return@example.com')
  await page.getByLabel('密码').fill('password8')
  await page.getByRole('button', { name: '创建账号' }).click()
  await expect(page).toHaveURL(/\/login$/)
  await page.getByLabel('密码').fill('password8')
  await page.getByRole('button', { name: '登录' }).click()
  await expect(page).toHaveURL(/\/upcoming$/)
  await expect(page.getByRole('heading', { name: '近期安排' })).toBeVisible()
})

test('redirects anonymous visitors away from every protected page', async ({ page }) => {
  for (const path of ['/tasks', '/upcoming', '/assistant', '/profile']) {
    await page.goto(path)
    await expect(page).toHaveURL(/\/login$/)
  }
})

test('cancels logout, then confirms logout and returns to login', async ({ page, login }) => {
  await login()
  await page.goto('/profile')
  await page.getByRole('button', { name: '退出登录' }).click()
  const dialog = page.getByRole('dialog', { name: '确认退出登录' })
  await dialog.getByRole('button', { name: '取消' }).click()
  await expect(dialog).toBeHidden()
  await expect(page).toHaveURL(/\/profile$/)

  await page.getByRole('button', { name: '退出登录' }).click()
  await dialog.getByRole('button', { name: '确认退出' }).click()
  await expect(page).toHaveURL(/\/login$/)
  await page.goto('/tasks')
  await expect(page).toHaveURL(/\/login$/)
})
