import { test, expect } from '@playwright/test'
import { loginAsAdmin, authHeaders, ensureSidebarOpen } from './helpers'

/**
 * File upload E2E tests.
 *
 * Each test authenticates independently via API login so that
 * strict token rotation / logout in other tests cannot interfere.
 *
 * Tests exercise the file upload functionality in the chat message input,
 * as well as the /api/upload endpoint directly for validation scenarios.
 */

// Start with a clean cookie jar — loginAsAdmin provides fresh auth per test.
test.use({ storageState: { cookies: [], origins: [] } })

/** Helper: create a room via API and return its id + name. */
async function createTestRoom(page: import('@playwright/test').Page, token: string) {
  const roomName = `e2e-upload-room-${Date.now()}`
  const res = await page.request.post('/api/rooms', {
    data: { name: roomName },
    headers: authHeaders(token),
  })
  expect(res.ok()).toBeTruthy()
  const body = (await res.json()) as { ok: boolean; data: { id: string; name: string } }
  expect(body.ok).toBe(true)
  return body.data
}

/** Helper: delete a room via API (cleanup). */
async function deleteRoom(page: import('@playwright/test').Page, token: string, roomId: string) {
  await page.request.delete(`/api/rooms/${roomId}`, {
    headers: authHeaders(token),
  })
}

test.describe('File upload in chat', () => {
  test('file attach button is present in message input', async ({ page }) => {
    const token = await loginAsAdmin(page)
    const room = await createTestRoom(page, token)

    try {
      await page.goto('/')
      await ensureSidebarOpen(page)
      await expect(page.getByRole('navigation', { name: /rooms/i })).toBeVisible({
        timeout: 15_000,
      })

      // Click on the room we just created
      const roomNav = page.getByRole('navigation', { name: /rooms/i })
      await expect(roomNav.getByText(room.name)).toBeVisible({ timeout: 10_000 })
      await roomNav.getByText(room.name).click()

      // Wait for message input to load
      const messageInput = page.getByRole('textbox', { name: /message input|send a message/i })
      await expect(messageInput).toBeVisible({ timeout: 10_000 })

      // The attach/paperclip button should be visible
      const attachButton = page.getByRole('button', { name: /attach/i })
      await expect(attachButton).toBeVisible()
    } finally {
      await deleteRoom(page, token, room.id)
    }
  })

  test('hidden file input accepts files', async ({ page }) => {
    const token = await loginAsAdmin(page)
    const room = await createTestRoom(page, token)

    try {
      await page.goto('/')
      await ensureSidebarOpen(page)
      await expect(page.getByRole('navigation', { name: /rooms/i })).toBeVisible({
        timeout: 15_000,
      })

      const roomNav = page.getByRole('navigation', { name: /rooms/i })
      await expect(roomNav.getByText(room.name)).toBeVisible({ timeout: 10_000 })
      await roomNav.getByText(room.name).click()

      await expect(
        page.getByRole('textbox', { name: /message input|send a message/i }),
      ).toBeVisible({ timeout: 10_000 })

      // The hidden file input should exist and accept the allowed MIME types
      const fileInput = page.locator('input[type="file"]')
      await expect(fileInput).toBeAttached()

      const accept = await fileInput.getAttribute('accept')
      expect(accept).toBeTruthy()
      // Should include at least image/jpeg and text/plain
      expect(accept).toContain('image/jpeg')
      expect(accept).toContain('text/plain')
    } finally {
      await deleteRoom(page, token, room.id)
    }
  })

  test('can upload a small text file via API', async ({ page }) => {
    const token = await loginAsAdmin(page)

    // Upload a small text file directly via the API
    const content = 'Hello, this is an E2E test file.'
    const boundary = '----E2ETestBoundary' + Date.now()
    const filename = `e2e-test-${Date.now()}.txt`

    const multipartBody = [
      `--${boundary}`,
      `Content-Disposition: form-data; name="file"; filename="${filename}"`,
      'Content-Type: text/plain',
      '',
      content,
      `--${boundary}--`,
    ].join('\r\n')

    const res = await page.request.post('/api/upload', {
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        ...authHeaders(token),
      },
      data: Buffer.from(multipartBody),
    })

    expect(res.ok()).toBeTruthy()
    const body = (await res.json()) as {
      ok: boolean
      data: { id: string; filename: string; mimeType: string; size: number; url: string }
    }
    expect(body.ok).toBe(true)
    expect(body.data.filename).toBe(filename)
    expect(body.data.mimeType).toBe('text/plain')
    expect(body.data.url).toContain('/uploads/')
    expect(body.data.size).toBeGreaterThan(0)
  })

  test('rejects disallowed MIME types via API', async ({ page }) => {
    const token = await loginAsAdmin(page)

    // Try to upload a file with a disallowed MIME type (application/x-executable)
    const boundary = '----E2ETestBoundary' + Date.now()
    const multipartBody = [
      `--${boundary}`,
      `Content-Disposition: form-data; name="file"; filename="malicious.exe"`,
      'Content-Type: application/x-executable',
      '',
      'fake-binary-content',
      `--${boundary}--`,
    ].join('\r\n')

    const res = await page.request.post('/api/upload', {
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        ...authHeaders(token),
      },
      data: Buffer.from(multipartBody),
    })

    expect(res.ok()).toBeFalsy()
    expect(res.status()).toBe(400)
    const body = (await res.json()) as { ok: boolean; error: string }
    expect(body.ok).toBe(false)
    expect(body.error).toContain('not allowed')
  })

  test('rejects files that exceed max size via API', async ({ page }) => {
    const token = await loginAsAdmin(page)

    // Try to upload a file that is too large (send the request with a body that
    // declares a large size). Since we cannot send a 10MB+ payload efficiently
    // in E2E tests, we test the server's error response for the file-too-large case.
    // Note: The actual limit is enforced on the File.size property server-side.
    // We can create a moderately large payload to trigger the body limit or
    // verify the API contract indirectly.
    const boundary = '----E2ETestBoundary' + Date.now()

    // Create a ~12MB text payload to exceed the 10MB MAX_FILE_SIZE
    const largeContent = 'x'.repeat(12 * 1024 * 1024)

    const multipartBody = [
      `--${boundary}`,
      `Content-Disposition: form-data; name="file"; filename="large-file.txt"`,
      'Content-Type: text/plain',
      '',
      largeContent,
      `--${boundary}--`,
    ].join('\r\n')

    const res = await page.request.post('/api/upload', {
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        ...authHeaders(token),
      },
      data: Buffer.from(multipartBody),
      timeout: 30_000,
    })

    // Should be rejected — either 400 (file too large) or 413 (body limit)
    expect(res.ok()).toBeFalsy()
    expect([400, 413]).toContain(res.status())
  })

  test('upload requires authentication', async ({ page }) => {
    // Do NOT log in — send request without auth cookies
    await page.goto('/')

    const boundary = '----E2ETestBoundary' + Date.now()
    const multipartBody = [
      `--${boundary}`,
      `Content-Disposition: form-data; name="file"; filename="test.txt"`,
      'Content-Type: text/plain',
      '',
      'test content',
      `--${boundary}--`,
    ].join('\r\n')

    const res = await page.request.post('/api/upload', {
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      data: Buffer.from(multipartBody),
    })

    // Should be rejected — 401 Unauthorized
    expect(res.ok()).toBeFalsy()
    expect(res.status()).toBe(401)
  })
})
