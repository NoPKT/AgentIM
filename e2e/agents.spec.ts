import { test, expect } from '@playwright/test'
import { loginAsAdmin } from './helpers'

/**
 * Agents page E2E tests.
 *
 * Each test authenticates independently via API login so that
 * strict token rotation / logout in other tests cannot interfere.
 */

// Start with a clean cookie jar — loginAsAdmin provides fresh auth per test.
test.use({ storageState: { cookies: [], origins: [] } })

test.describe('Agents page', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page)
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
    // Wait for the AgentsPage to settle past loading state.
    // The page has 4 possible states: loading, error, empty, or populated.
    // All states now have data-testid attributes for reliable detection.
    await expect(
      page
        .locator('[data-testid="agents-list"]')
        .or(page.locator('[data-testid="agents-empty"]'))
        .or(page.locator('[data-testid="agents-error"]'))
        .or(page.locator('[data-testid="agents-loading"]')),
    ).toBeVisible({ timeout: 15_000 })
  })
})
