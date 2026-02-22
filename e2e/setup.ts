import { test as setup, expect } from '@playwright/test'

const ADMIN_USER = process.env.E2E_ADMIN_USERNAME || 'admin'
const ADMIN_PASS = process.env.E2E_ADMIN_PASSWORD || 'AdminPass123'

/**
 * Global auth setup: log in once and save the session state (cookies).
 *
 * Other test projects configured with `storageState` will load this saved
 * state, restoring the session via the httpOnly refresh-token cookie without
 * making additional /auth/login calls. This prevents rate-limit exhaustion
 * when many tests need an authenticated context.
 *
 * auth.spec.ts opts out via `test.use({ storageState: { cookies: [], origins: [] } })`
 * because it specifically tests the login/logout flow.
 */
setup('authenticate', async ({ page }) => {
  await page.goto('/login')
  await page.getByRole('textbox', { name: /username/i }).fill(ADMIN_USER)
  await page.getByRole('textbox', { name: /password/i }).fill(ADMIN_PASS)
  await page.getByRole('button', { name: /log\s*in|sign\s*in/i }).click()
  await expect(page).not.toHaveURL(/\/login/, { timeout: 10_000 })
  await page.context().storageState({ path: 'e2e/.auth/user.json' })
})
