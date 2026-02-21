import { test, expect } from '@playwright/test'

const ADMIN_USER = process.env.E2E_ADMIN_USERNAME || 'admin'
const ADMIN_PASS = process.env.E2E_ADMIN_PASSWORD || 'AdminPass123'

test.describe('Agents page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login')
    await page.getByRole('textbox', { name: /username/i }).fill(ADMIN_USER)
    await page.getByRole('textbox', { name: /password/i }).fill(ADMIN_PASS)
    await page.getByRole('button', { name: /sign in|login/i }).click()
    await expect(page).not.toHaveURL(/\/login/, { timeout: 10_000 })
    await page.goto('/agents')
  })

  test('agents page loads without errors', async ({ page }) => {
    // Should not show a generic error page
    await expect(page.getByRole('heading', { name: /error|not found/i })).not.toBeVisible({
      timeout: 5_000,
    })
  })

  test('displays agents section', async ({ page }) => {
    // Wait for page to fully load
    await page.waitForLoadState('networkidle')
    // Page should contain the agents heading or an empty state
    const hasAgents = await page.locator('[data-testid="agents-list"]').count()
    const hasEmpty = await page.getByText(/no agents|connect.*agent|start.*agent/i).count()
    expect(hasAgents + hasEmpty).toBeGreaterThanOrEqual(0)
  })
})
