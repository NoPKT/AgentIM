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
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 5'] },
    },
  ],
})
