import { test, expect } from '@playwright/test'

const ADMIN_USER = process.env.E2E_ADMIN_USERNAME || 'admin'
const ADMIN_PASS = process.env.E2E_ADMIN_PASSWORD || 'AdminPass123'

async function login(page: import('@playwright/test').Page) {
  await page.goto('/login')
  await page.getByRole('textbox', { name: /username/i }).fill(ADMIN_USER)
  await page.getByRole('textbox', { name: /password/i }).fill(ADMIN_PASS)
  await page.getByRole('button', { name: /sign in|login/i }).click()
  await expect(page).not.toHaveURL(/\/login/, { timeout: 10_000 })
}

test.describe('App navigation', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test('navigates to agents page', async ({ page }) => {
    await page.goto('/agents')
    await expect(page).toHaveURL(/\/agents/)
    // Should render without crashing
    await page.waitForLoadState('networkidle')
    await expect(page.locator('body')).not.toContainText('Unhandled error')
  })

  test('navigates to tasks page', async ({ page }) => {
    await page.goto('/tasks')
    await expect(page).toHaveURL(/\/tasks/)
    await page.waitForLoadState('networkidle')
    await expect(page.locator('body')).not.toContainText('Unhandled error')
  })

  test('navigates to settings page', async ({ page }) => {
    await page.goto('/settings')
    await expect(page).toHaveURL(/\/settings/)
    await page.waitForLoadState('networkidle')
    await expect(page.locator('body')).not.toContainText('Unhandled error')
  })

  test('404 page for unknown routes', async ({ page }) => {
    await page.goto('/this-does-not-exist-xyz')
    // Should show a not-found page, not crash
    await page.waitForLoadState('networkidle')
    const notFoundVisible = await page
      .getByText(/not found|404|page doesn.*exist/i)
      .isVisible()
      .catch(() => false)
    // Either shows not-found text or redirects — should not be blank or errored
    expect(notFoundVisible || (await page.title()) !== '').toBeTruthy()
  })

  test('health check endpoint responds', async ({ request }) => {
    const response = await request.get('/api/health')
    expect(response.status()).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
  })

  test('metrics endpoint responds', async ({ request }) => {
    const response = await request.get('/api/metrics')
    expect([200, 401, 403]).toContain(response.status())
  })
})

test.describe('Admin-only pages', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test('admin can access users page', async ({ page }) => {
    await page.goto('/users')
    await page.waitForLoadState('networkidle')
    // Admin should not be redirected
    await expect(page).not.toHaveURL(/\/login/)
    await expect(page.locator('body')).not.toContainText('Unauthorized')
  })
})
