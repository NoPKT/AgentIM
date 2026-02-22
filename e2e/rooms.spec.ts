import { test, expect } from '@playwright/test'
import { loginAsAdmin } from './helpers'

/**
 * Room management E2E tests.
 *
 * Each test authenticates independently via API login so that
 * strict token rotation / logout in other tests cannot interfere.
 */

// Start with a clean cookie jar — loginAsAdmin provides fresh auth per test.
test.use({ storageState: { cookies: [], origins: [] } })

test.describe('Room management', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page)
    await page.goto('/')
    await expect(page.getByRole('navigation', { name: /rooms/i })).toBeVisible({ timeout: 15_000 })
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
    // Click on the first available room (rooms have role="listitem" in the nav)
    const roomNav = page.getByRole('navigation', { name: /rooms/i })
    const firstRoom = roomNav.getByRole('listitem').first()
    if (!(await firstRoom.isVisible())) {
      test.skip()
      return
    }
    await firstRoom.click()

    // Find the message input by its aria-label (t('chat.messageInputLabel') = "Message input")
    const messageInput = page.getByRole('textbox', { name: /message input|send a message/i })
    await expect(messageInput).toBeVisible({ timeout: 10_000 })
    const testMessage = `e2e-msg-${Date.now()}`
    await messageInput.fill(testMessage)
    await messageInput.press('Enter')

    // Message should appear in the message list (MessageList has role="log")
    await expect(page.getByRole('log')).toContainText(testMessage, { timeout: 10_000 })
  })
})
