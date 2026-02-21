import { test, expect } from '@playwright/test'

const ADMIN_USER = process.env.E2E_ADMIN_USERNAME || 'admin'
const ADMIN_PASS = process.env.E2E_ADMIN_PASSWORD || 'AdminPass123'

test.describe('Room management', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login')
    await page.getByRole('textbox', { name: /username/i }).fill(ADMIN_USER)
    await page.getByRole('textbox', { name: /password/i }).fill(ADMIN_PASS)
    await page.getByRole('button', { name: /log\s*in|sign\s*in/i }).click()
    await expect(page).not.toHaveURL(/\/login/, { timeout: 10_000 })
  })

  test('can create a new room', async ({ page }) => {
    const newRoomButton = page.getByRole('button', { name: /new room/i })
    await expect(newRoomButton).toBeVisible({ timeout: 10_000 })
    await newRoomButton.click()

    // Fill in the room name (dialog or inline form)
    const roomNameInput = page.getByRole('textbox', { name: /room name/i })
    await expect(roomNameInput).toBeVisible()
    const testRoomName = `e2e-room-${Date.now()}`
    await roomNameInput.fill(testRoomName)

    // Submit
    const createButton = page.getByRole('button', { name: /create/i })
    await createButton.click()

    // Room should appear in the nav
    await expect(page.getByRole('navigation', { name: /rooms/i })).toContainText(testRoomName, {
      timeout: 5_000,
    })
  })

  test('can send a message in a room', async ({ page }) => {
    // Click on the first available room
    const roomNav = page.getByRole('navigation', { name: /rooms/i })
    const firstRoom = roomNav.getByRole('button').first()
    if (!(await firstRoom.isVisible())) {
      test.skip()
      return
    }
    await firstRoom.click()

    // Find the message input
    const messageInput = page.getByRole('textbox', { name: /send message|type a message/i })
    await expect(messageInput).toBeVisible({ timeout: 5_000 })
    const testMessage = `e2e-msg-${Date.now()}`
    await messageInput.fill(testMessage)
    await messageInput.press('Enter')

    // Message should appear in the message list
    await expect(
      page.locator('[data-testid="message-list"]').or(page.locator('.message-list')),
    ).toContainText(testMessage, { timeout: 5_000 })
  })
})
