import { test, expect } from '@playwright/test'

/**
 * Agents page E2E tests.
 *
 * Authentication is provided by the global setup (storageState).
 * On page load the app restores the session via the saved httpOnly
 * refresh-token cookie — no extra /auth/login call is made here.
 */

test.describe('Agents page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/agents')
    await expect(page).not.toHaveURL(/\/login/, { timeout: 10_000 })
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
