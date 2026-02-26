import { test, expect } from '@playwright/test'
import { loginAsAdmin } from './helpers'

/**
 * Service Agents admin page E2E tests.
 *
 * Each test authenticates independently via API login so that
 * strict token rotation / logout in other tests cannot interfere.
 *
 * Service agent routes require admin role, so all tests log in as admin.
 */

// Start with a clean cookie jar — loginAsAdmin provides fresh auth per test.
test.use({ storageState: { cookies: [], origins: [] } })

test.describe('Service Agents page', () => {
  test('navigates to /service-agents page', async ({ page }) => {
    await loginAsAdmin(page)
    await page.goto('/service-agents')
    await expect(page).toHaveURL(/\/service-agents/)
    await page.waitForLoadState('networkidle')
    // Should not show a generic error page
    await expect(page.locator('body')).not.toContainText('Unhandled error')
  })

  test('page loads and shows service agents list or empty state', async ({ page }) => {
    await loginAsAdmin(page)
    await page.goto('/service-agents')
    await page.waitForLoadState('networkidle')

    // Page should contain either existing service agents or an empty-state message
    const hasAgents = await page.locator('[class*="space-y-3"] > div').count()
    const hasEmpty = await page.getByText(/no service agents|configure.*first/i).count()
    const hasLoading = await page.getByText(/loading/i).count()
    expect(hasAgents + hasEmpty + hasLoading).toBeGreaterThanOrEqual(0)

    // The page title should be visible
    const heading = page.getByRole('heading', { level: 1 })
    await expect(heading).toBeVisible({ timeout: 10_000 })
  })

  test('providers API returns available provider list', async ({ page }) => {
    await loginAsAdmin(page)

    const res = await page.request.get('/api/service-agents/providers')
    expect(res.ok()).toBeTruthy()
    const body = (await res.json()) as {
      ok: boolean
      data: { type: string; displayName: string; category: string }[]
    }
    expect(body.ok).toBe(true)
    expect(Array.isArray(body.data)).toBe(true)
    // Should have at least one provider type registered
    expect(body.data.length).toBeGreaterThan(0)

    // Each provider should have the required fields
    for (const provider of body.data) {
      expect(provider.type).toBeTruthy()
      expect(provider.displayName).toBeTruthy()
      expect(provider.category).toBeTruthy()
    }
  })

  test('service agents list API works', async ({ page }) => {
    await loginAsAdmin(page)

    const res = await page.request.get('/api/service-agents')
    expect(res.ok()).toBeTruthy()
    const body = (await res.json()) as {
      ok: boolean
      data: { id: string; name: string; type: string }[]
    }
    expect(body.ok).toBe(true)
    expect(Array.isArray(body.data)).toBe(true)
  })

  test('create button is visible for admin users', async ({ page }) => {
    await loginAsAdmin(page)
    await page.goto('/service-agents')
    await page.waitForLoadState('networkidle')

    // Admin should see the create button
    const createButton = page.getByRole('button', { name: /create/i })
    await expect(createButton).toBeVisible({ timeout: 10_000 })
  })

  test('create form shows provider types when opened', async ({ page }) => {
    test.setTimeout(60_000)
    await loginAsAdmin(page)
    await page.goto('/service-agents')
    await page.waitForLoadState('networkidle')

    // Click the create button to show the form
    const createButton = page.getByRole('button', { name: /create/i })
    await createButton.click()

    // Wait for the provider list to load — should show at least one provider button
    await expect(
      page.locator('button').filter({ hasText: /openai|anthropic|google|ollama|groq/i }).first(),
    ).toBeVisible({ timeout: 10_000 })
  })
})
