import { defineConfig, devices } from '@playwright/test'

/**
 * E2E test configuration.
 *
 * Prerequisites for running locally:
 *   1. Start a server: pnpm --filter @agentim/server dev
 *   2. Alternatively use `webServer` config below to auto-start
 *
 * CI: runs against a pre-built app served on port 3000.
 * Local: runs against the dev server (PLAYWRIGHT_BASE_URL or http://localhost:3000).
 */

const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000'

/** Saved auth state – httpOnly refresh-token cookie captured by the setup project. */
const AUTH_FILE = 'e2e/.auth/user.json'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  timeout: 30_000,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    /**
     * Setup project: logs in once and writes the auth state to AUTH_FILE.
     * Runs before any browser project that declares it as a dependency.
     * Only a single /auth/login call is made for all subsequent tests.
     */
    {
      name: 'setup',
      testMatch: /setup\.ts/,
    },

    // Browser projects – depend on setup and load the saved auth cookies.
    // auth.spec.ts opts out via test.use({ storageState: { cookies: [], origins: [] } }).
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], storageState: AUTH_FILE },
      dependencies: ['setup'],
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'], storageState: AUTH_FILE },
      dependencies: ['setup'],
    },
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 5'], storageState: AUTH_FILE },
      dependencies: ['setup'],
    },
  ],
})
