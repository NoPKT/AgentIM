import { test, expect } from '@playwright/test'

/**
 * Authentication E2E tests.
 *
 * These tests require a running server with:
 *   ADMIN_USERNAME=admin
 *   ADMIN_PASSWORD=AdminPass123
 *
 * In CI, this is provided by the e2e job environment.
 */

const ADMIN_USER = process.env.E2E_ADMIN_USERNAME || 'admin'
const ADMIN_PASS = process.env.E2E_ADMIN_PASSWORD || 'AdminPass123'

test.describe('Login page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login')
  })

  test('shows the login form', async ({ page }) => {
    await expect(page.getByRole('textbox', { name: /username/i })).toBeVisible()
    await expect(page.getByRole('textbox', { name: /password/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /sign in|login/i })).toBeVisible()
  })

  test('shows error on invalid credentials', async ({ page }) => {
    await page.getByRole('textbox', { name: /username/i }).fill('wronguser')
    await page.getByRole('textbox', { name: /password/i }).fill('wrongpass')
    await page.getByRole('button', { name: /sign in|login/i }).click()
    // Should show an error message
    await expect(page.getByRole('alert')).toBeVisible({ timeout: 5_000 })
  })

  test('redirects to chat on successful login', async ({ page }) => {
    await page.getByRole('textbox', { name: /username/i }).fill(ADMIN_USER)
    await page.getByRole('textbox', { name: /password/i }).fill(ADMIN_PASS)
    await page.getByRole('button', { name: /sign in|login/i }).click()
    // Should redirect away from /login
    await expect(page).not.toHaveURL(/\/login/, { timeout: 10_000 })
  })

  test('does not allow empty submission', async ({ page }) => {
    await page.getByRole('button', { name: /sign in|login/i }).click()
    // Should stay on login page with an error
    await expect(page).toHaveURL(/\/login/)
  })
})

test.describe('Authenticated session', () => {
  test.beforeEach(async ({ page }) => {
    // Log in as admin
    await page.goto('/login')
    await page.getByRole('textbox', { name: /username/i }).fill(ADMIN_USER)
    await page.getByRole('textbox', { name: /password/i }).fill(ADMIN_PASS)
    await page.getByRole('button', { name: /sign in|login/i }).click()
    await expect(page).not.toHaveURL(/\/login/, { timeout: 10_000 })
  })

  test('shows main chat layout after login', async ({ page }) => {
    // The room list nav should be present
    await expect(page.getByRole('navigation', { name: /rooms/i })).toBeVisible({ timeout: 10_000 })
  })

  test('can log out', async ({ page }) => {
    // Find the logout button (usually in settings or a menu)
    const logoutButton = page.getByRole('button', { name: /log.?out|sign.?out/i })
    if (await logoutButton.isVisible()) {
      await logoutButton.click()
      await expect(page).toHaveURL(/\/login/, { timeout: 5_000 })
    } else {
      // Navigate to settings page where logout typically lives
      await page.goto('/settings')
      await page.getByRole('button', { name: /log.?out|sign.?out/i }).click()
      await expect(page).toHaveURL(/\/login/, { timeout: 5_000 })
    }
  })

  test('redirects unauthenticated users to login', async ({ page, context }) => {
    // Clear storage to simulate unauthenticated state in a new context
    await context.clearCookies()
    await page.evaluate(() => {
      localStorage.clear()
      sessionStorage.clear()
    })
    await page.goto('/')
    await expect(page).toHaveURL(/\/login/, { timeout: 5_000 })
  })
})
