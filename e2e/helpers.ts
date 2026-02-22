import type { Page } from '@playwright/test'

const ADMIN_USER = process.env.E2E_ADMIN_USERNAME || 'admin'
const ADMIN_PASS = process.env.E2E_ADMIN_PASSWORD || 'AdminPass123'

/**
 * Login as admin via API request.
 *
 * Uses page.request which shares cookie storage with the browser context.
 * Each call creates a fresh, independent refresh token so tests don't
 * interfere with each other through token rotation.
 */
export async function loginAsAdmin(page: Page) {
  const res = await page.request.post('/api/auth/login', {
    data: { username: ADMIN_USER, password: ADMIN_PASS },
  })
  if (!res.ok()) {
    throw new Error(`Login failed: ${res.status()} ${await res.text()}`)
  }
}
