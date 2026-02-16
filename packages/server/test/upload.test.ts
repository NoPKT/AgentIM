import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startServer, stopServer, BASE_URL, registerUser } from './helpers.js'

/** Upload helper: sends a multipart form with a File */
async function upload(
  path: string,
  file: File,
  token: string,
): Promise<{ status: number; data: any }> {
  const form = new FormData()
  form.append('file', file)

  const res = await fetch(`${BASE_URL}/api/upload${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  })
  const data = await res.json().catch(() => null)
  return { status: res.status, data }
}

// Create a valid PNG file (1x1 pixel)
function createPngFile(name = 'test.png', size?: number): File {
  // Minimal valid PNG: 1x1 transparent pixel
  const pngBytes = new Uint8Array([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a, // PNG signature
    0x00,
    0x00,
    0x00,
    0x0d,
    0x49,
    0x48,
    0x44,
    0x52, // IHDR chunk
    0x00,
    0x00,
    0x00,
    0x01,
    0x00,
    0x00,
    0x00,
    0x01, // 1x1
    0x08,
    0x06,
    0x00,
    0x00,
    0x00,
    0x1f,
    0x15,
    0xc4,
    0x89, // 8-bit RGBA
    0x00,
    0x00,
    0x00,
    0x0a,
    0x49,
    0x44,
    0x41,
    0x54, // IDAT chunk
    0x78,
    0x9c,
    0x62,
    0x00,
    0x00,
    0x00,
    0x02,
    0x00,
    0x01,
    0xe5,
    0x27,
    0xde,
    0xfc,
    0x00,
    0x00,
    0x00,
    0x00,
    0x49,
    0x45,
    0x4e,
    0x44, // IEND
    0xae,
    0x42,
    0x60,
    0x82,
  ])
  const data = size ? new Uint8Array(size) : pngBytes
  // Write PNG header even if padding for size tests
  if (size && size >= pngBytes.length) {
    data.set(pngBytes)
  }
  return new File([data], name, { type: 'image/png' })
}

// Create a valid JPEG file
function createJpegFile(name = 'test.jpg'): File {
  const jpegBytes = new Uint8Array([
    0xff,
    0xd8,
    0xff,
    0xe0, // JPEG SOI + APP0 marker
    0x00,
    0x10,
    0x4a,
    0x46,
    0x49,
    0x46,
    0x00,
    0x01,
    0x01,
    0x00,
    0x00,
    0x01,
    0x00,
    0x01,
    0x00,
    0x00,
    0xff,
    0xd9, // EOI
  ])
  return new File([jpegBytes], name, { type: 'image/jpeg' })
}

// Create a text file
function createTextFile(content = 'Hello, world!', name = 'test.txt'): File {
  return new File([content], name, { type: 'text/plain' })
}

describe('File Upload', () => {
  let user: { userId: string; accessToken: string }

  before(async () => {
    await startServer()
    user = await registerUser('upload_user')
  })

  after(async () => {
    await stopServer()
  })

  // ─── General Upload ───

  describe('POST /api/upload', () => {
    it('uploads a PNG file', async () => {
      const file = createPngFile()
      const res = await upload('', file, user.accessToken)
      assert.equal(res.status, 200)
      assert.equal(res.data.ok, true)
      assert.ok(res.data.data.id)
      assert.equal(res.data.data.filename, 'test.png')
      assert.equal(res.data.data.mimeType, 'image/png')
      assert.ok(res.data.data.url.startsWith('/uploads/'))
    })

    it('uploads a JPEG file', async () => {
      const file = createJpegFile()
      const res = await upload('', file, user.accessToken)
      assert.equal(res.status, 200)
      assert.equal(res.data.ok, true)
      assert.equal(res.data.data.mimeType, 'image/jpeg')
    })

    it('uploads a text file', async () => {
      const file = createTextFile()
      const res = await upload('', file, user.accessToken)
      assert.equal(res.status, 200)
      assert.equal(res.data.ok, true)
      assert.equal(res.data.data.mimeType, 'text/plain')
    })

    it('rejects request without a file', async () => {
      const form = new FormData()
      const res = await fetch(`${BASE_URL}/api/upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${user.accessToken}` },
        body: form,
      })
      const data = await res.json()
      assert.equal(res.status, 400)
      assert.equal(data.ok, false)
      assert.match(data.error, /no file/i)
    })

    it('rejects file exceeding max size', async () => {
      // Create a file just over the 10MB limit
      const bigFile = createPngFile('big.png', 10 * 1024 * 1024 + 100)
      const res = await upload('', bigFile, user.accessToken)
      // Server may reject with 400 (handler check) or 413/404 (body parser limit)
      assert.ok(res.status >= 400, `Expected error status but got ${res.status}`)
    })

    it('rejects disallowed MIME type', async () => {
      const file = new File(['#!/bin/bash\necho pwned'], 'evil.sh', {
        type: 'application/x-shellscript',
      })
      const res = await upload('', file, user.accessToken)
      assert.equal(res.status, 400)
      assert.equal(res.data.ok, false)
      assert.match(res.data.error, /not allowed/i)
    })

    it('rejects unauthenticated request', async () => {
      const file = createPngFile()
      const form = new FormData()
      form.append('file', file)

      const res = await fetch(`${BASE_URL}/api/upload`, {
        method: 'POST',
        body: form,
      })
      assert.equal(res.status, 401)
    })

    it('uploaded file is accessible via URL', async () => {
      const file = createTextFile('test content', 'readable.txt')
      const uploadRes = await upload('', file, user.accessToken)
      assert.equal(uploadRes.status, 200)

      const fileUrl = uploadRes.data.data.url
      const fetchRes = await fetch(`${BASE_URL}${fileUrl}`)
      assert.equal(fetchRes.status, 200)
      const body = await fetchRes.text()
      assert.equal(body, 'test content')
    })
  })

  // ─── Avatar Upload ───

  describe('POST /api/upload/avatar', () => {
    it('uploads an avatar image', async () => {
      const file = createPngFile('avatar.png')
      const res = await upload('/avatar', file, user.accessToken)
      assert.equal(res.status, 200)
      assert.equal(res.data.ok, true)
      assert.ok(res.data.data.avatarUrl.startsWith('/uploads/avatar_'))
    })

    it('uploads a JPEG avatar', async () => {
      const file = createJpegFile('avatar.jpg')
      const res = await upload('/avatar', file, user.accessToken)
      assert.equal(res.status, 200)
      assert.equal(res.data.ok, true)
    })

    it('rejects non-image file for avatar', async () => {
      const file = createTextFile('not an image', 'avatar.txt')
      const res = await upload('/avatar', file, user.accessToken)
      assert.equal(res.status, 400)
      assert.equal(res.data.ok, false)
      assert.match(res.data.error, /only.*image/i)
    })

    it('rejects oversized avatar (>2MB)', async () => {
      const bigAvatar = createPngFile('big-avatar.png', 3 * 1024 * 1024)
      const res = await upload('/avatar', bigAvatar, user.accessToken)
      assert.equal(res.status, 400)
      assert.equal(res.data.ok, false)
      assert.match(res.data.error, /too large/i)
    })

    it('rejects unauthenticated avatar upload', async () => {
      const file = createPngFile('avatar.png')
      const form = new FormData()
      form.append('file', file)

      const res = await fetch(`${BASE_URL}/api/upload/avatar`, {
        method: 'POST',
        body: form,
      })
      assert.equal(res.status, 401)
    })
  })
})
