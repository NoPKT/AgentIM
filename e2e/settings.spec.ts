import { test, expect } from '@playwright/test'
import { loginAsAdmin, authHeaders } from './helpers'

/**
 * Settings page E2E tests.
 *
 * Each test authenticates independently via API login so that
 * strict token rotation / logout in other tests cannot interfere.
 *
 * Tests exercise the settings page UI: profile, theme, language.
 */

// Start with a clean cookie jar — loginAsAdmin provides fresh auth per test.
test.use({ storageState: { cookies: [], origins: [] } })

test.describe('Settings page', () => {
  test('navigates to /settings successfully', async ({ page }) => {
    await loginAsAdmin(page)
    await page.goto('/settings')
    await expect(page).toHaveURL(/\/settings/)
    await page.waitForLoadState('networkidle')
    // Should not show a generic error page
    await expect(page.locator('body')).not.toContainText('Unhandled error')
  })

  test('page loads with user profile information', async ({ page }) => {
    await loginAsAdmin(page)
    await page.goto('/settings')
    await page.waitForLoadState('networkidle')

    // The settings heading should be visible
    const heading = page.getByRole('heading', { name: /settings/i })
    await expect(heading).toBeVisible({ timeout: 10_000 })

    // Profile section should display the username (admin)
    await expect(page.getByText('@admin')).toBeVisible({ timeout: 10_000 })

    // Display name input should be present
    const displayNameInput = page.locator('#displayName')
    await expect(displayNameInput).toBeVisible()
  })

  test('can update display name', async ({ page }) => {
    test.setTimeout(60_000)
    const token = await loginAsAdmin(page)
    await page.goto('/settings')
    await page.waitForLoadState('networkidle')

    const displayNameInput = page.locator('#displayName')
    await expect(displayNameInput).toBeVisible({ timeout: 10_000 })

    // Save the original display name to restore later
    const originalName = await displayNameInput.inputValue()
    const newName = `E2E Admin ${Date.now()}`

    try {
      // Clear and fill the new name
      await displayNameInput.clear()
      await displayNameInput.fill(newName)

      // Click the save button within the profile section
      const saveButton = page.getByRole('button', { name: /^save$/i }).first()
      await saveButton.click()

      // Wait for save to complete — a success toast or the input retains the value
      // Verify by re-fetching the user profile via API
      await page.waitForTimeout(1_000)

      const meRes = await page.request.get('/api/users/me', {
        headers: authHeaders(token),
      })
      expect(meRes.ok()).toBeTruthy()
      const meBody = (await meRes.json()) as { ok: boolean; data: { displayName: string } }
      expect(meBody.data.displayName).toBe(newName)
    } finally {
      // Restore original name
      await page.request.put('/api/users/me', {
        data: { displayName: originalName || 'Admin' },
        headers: authHeaders(token),
      })
    }
  })

  test('theme toggle works', async ({ page }) => {
    await loginAsAdmin(page)
    await page.goto('/settings')
    await page.waitForLoadState('networkidle')

    // The theme section should have light / dark / system buttons
    const lightButton = page.getByRole('button', { name: /light/i })
    const darkButton = page.getByRole('button', { name: /dark/i })
    const systemButton = page.getByRole('button', { name: /system/i })

    await expect(lightButton).toBeVisible({ timeout: 10_000 })
    await expect(darkButton).toBeVisible()
    await expect(systemButton).toBeVisible()

    // Click dark mode
    await darkButton.click()

    // The HTML element should have the dark class or data attribute
    // (depends on implementation — check for either)
    const htmlClass = await page.locator('html').getAttribute('class')
    const htmlDataTheme = await page.locator('html').getAttribute('data-theme')
    const isDark =
      htmlClass?.includes('dark') || htmlDataTheme === 'dark' || htmlDataTheme?.includes('dark')
    expect(isDark).toBeTruthy()

    // Switch back to light mode
    await lightButton.click()
    await page.waitForTimeout(300)

    const htmlClassAfter = await page.locator('html').getAttribute('class')
    const htmlDataThemeAfter = await page.locator('html').getAttribute('data-theme')
    // After switching to light, dark class should be gone
    const isLight = !htmlClassAfter?.includes('dark') || htmlDataThemeAfter === 'light'
    expect(isLight).toBeTruthy()
  })

  test('language selector is present and has multiple options', async ({ page }) => {
    await loginAsAdmin(page)
    await page.goto('/settings')
    await page.waitForLoadState('networkidle')

    // The language section should show multiple language buttons
    // Based on the SettingsPage code, languages are rendered as buttons
    const englishButton = page.getByRole('button', { name: /english/i })
    await expect(englishButton).toBeVisible({ timeout: 10_000 })

    // Should have multiple language options (the app supports EN, ZH-CN, JA, KO, FR, DE, RU)
    const languageButtons = page
      .getByRole('button')
      .filter({ hasText: /english|中文|日本語|한국어|français|deutsch|русский/i })
    const count = await languageButtons.count()
    expect(count).toBeGreaterThanOrEqual(2)
  })

  test('username field is disabled (not editable)', async ({ page }) => {
    await loginAsAdmin(page)
    await page.goto('/settings')
    await page.waitForLoadState('networkidle')

    const usernameInput = page.locator('#username')
    await expect(usernameInput).toBeVisible({ timeout: 10_000 })
    await expect(usernameInput).toBeDisabled()
  })

  test('change password section is present', async ({ page }) => {
    await loginAsAdmin(page)
    await page.goto('/settings')
    await page.waitForLoadState('networkidle')

    // The change password heading should be visible
    await expect(page.getByRole('heading', { name: /change password/i })).toBeVisible({
      timeout: 10_000,
    })

    // Password inputs should be present
    const currentPassword = page.locator('#currentPassword')
    const newPassword = page.locator('#newPassword')
    const confirmPassword = page.locator('#confirmNewPassword')

    await expect(currentPassword).toBeVisible()
    await expect(newPassword).toBeVisible()
    await expect(confirmPassword).toBeVisible()
  })

  test('about section shows version info', async ({ page }) => {
    await loginAsAdmin(page)
    await page.goto('/settings')
    await page.waitForLoadState('networkidle')

    // The about section should show version information
    await expect(page.getByText(/version/i)).toBeVisible({ timeout: 10_000 })

    // Should show the app name somewhere
    await expect(page.getByRole('heading', { name: /agentim/i }).first()).toBeVisible()
  })
})
