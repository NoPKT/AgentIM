import type { Page } from '@playwright/test'

const ADMIN_USER = process.env.E2E_ADMIN_USERNAME || 'admin'
const ADMIN_PASS = process.env.E2E_ADMIN_PASSWORD || 'AdminPass123'

/**
 * Login as admin via API request.
 *
 * Uses page.request which shares cookie storage with the browser context.
 * Each call creates a fresh, independent refresh token so tests don't
 * interfere with each other through token rotation.
 *
 * Returns the access token so callers that make direct API calls via
 * page.request can pass it in the Authorization header.  Callers that
 * only use browser navigation can safely ignore the return value.
 */
export async function loginAsAdmin(page: Page): Promise<string> {
  const res = await page.request.post('/api/auth/login', {
    data: { username: ADMIN_USER, password: ADMIN_PASS },
  })
  if (!res.ok()) {
    throw new Error(`Login failed: ${res.status()} ${await res.text()}`)
  }
  const body = (await res.json()) as { data: { accessToken: string } }
  return body.data.accessToken
}

/** Build an Authorization header object for direct page.request API calls. */
export function authHeaders(token: string) {
  return { Authorization: `Bearer ${token}` }
}

/**
 * Get an access token by calling the login API directly.
 * Alias for loginAsAdmin — kept for backward compatibility.
 */
export const getAccessToken = loginAsAdmin

/**
 * On mobile viewports the sidebar is hidden behind a hamburger menu.
 * Call this helper before interacting with sidebar elements (room list,
 * nav links, logout button, etc.).  On desktop viewports the hamburger
 * button is not rendered (`lg:hidden`), so the waitFor times out
 * harmlessly and we skip the click.
 */
export async function ensureSidebarOpen(page: Page): Promise<void> {
  const menuButton = page.getByRole('button', { name: /rooms|menu/i })
  try {
    // Wait for the button to appear — covers the window where React is
    // still hydrating after page.goto().  On desktop the button has
    // `lg:hidden` so it never becomes visible and we fall into catch.
    await menuButton.waitFor({ state: 'visible', timeout: 3000 })
    await menuButton.click()
    // Wait for the sidebar slide-in animation (300ms CSS transition)
    await page.waitForTimeout(350)
  } catch {
    // Button not visible — desktop viewport, sidebar is always open
  }
}
