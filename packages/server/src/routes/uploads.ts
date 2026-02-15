import { Hono } from 'hono'
import { nanoid } from 'nanoid'
import { eq, isNull, lt, and } from 'drizzle-orm'
import { resolve, extname } from 'node:path'
import { writeFile, unlink } from 'node:fs/promises'
import { db } from '../db/index.js'
import { messageAttachments, users } from '../db/schema.js'
import { authMiddleware, type AuthEnv } from '../middleware/auth.js'
import { config } from '../config.js'
import { createLogger } from '../lib/logger.js'

const log = createLogger('Uploads')

const AVATAR_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp'])
const MAX_AVATAR_SIZE = 2 * 1024 * 1024 // 2MB

// Magic byte signatures for content-based type validation
const MAGIC_BYTES: [string, number[], number?][] = [
  ['image/jpeg', [0xff, 0xd8, 0xff]],
  ['image/png', [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  ['image/gif', [0x47, 0x49, 0x46, 0x38]],
  ['image/webp', [0x52, 0x49, 0x46, 0x46]],  // RIFF header; also check 'WEBP' at offset 8
  ['application/pdf', [0x25, 0x50, 0x44, 0x46]],
  ['application/zip', [0x50, 0x4b, 0x03, 0x04]],
  ['application/gzip', [0x1f, 0x8b]],
]

function validateMagicBytes(buffer: Buffer, declaredType: string): boolean {
  // Only validate types we know the signature for
  const signature = MAGIC_BYTES.find(([type]) => declaredType === type || declaredType.startsWith(type.split('/')[0] + '/'))
  if (!signature) return true // Unknown type — allow (MIME check already passed)

  const matchesAny = MAGIC_BYTES
    .filter(([type]) => type === declaredType)
    .some(([, bytes]) => {
      if (buffer.length < bytes.length) return false
      return bytes.every((b, i) => buffer[i] === b)
    })

  if (!matchesAny) return false

  // Extra check for WebP: bytes 8-11 should be 'WEBP'
  if (declaredType === 'image/webp' && buffer.length >= 12) {
    return buffer.toString('ascii', 8, 12) === 'WEBP'
  }
  return true
}

export const uploadRoutes = new Hono<AuthEnv>()

uploadRoutes.use('*', authMiddleware)

// Upload a file (returns attachment record for later association with a message)
uploadRoutes.post('/', async (c) => {
  const userId = c.get('userId')
  const body = await c.req.parseBody()
  const file = body['file']

  if (!file || !(file instanceof File)) {
    return c.json({ ok: false, error: 'No file provided' }, 400)
  }

  if (file.size > config.maxFileSize) {
    return c.json(
      { ok: false, error: `File too large. Maximum size is ${Math.round(config.maxFileSize / 1024 / 1024)}MB` },
      400,
    )
  }

  if (!config.allowedMimeTypes.includes(file.type)) {
    return c.json({ ok: false, error: `File type "${file.type}" is not allowed` }, 400)
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  if (!validateMagicBytes(buffer, file.type)) {
    return c.json({ ok: false, error: 'File content does not match declared type' }, 400)
  }

  const id = nanoid()
  const ext = extname(file.name) || ''
  const storedFilename = `${id}${ext}`
  const filePath = resolve(config.uploadDir, storedFilename)
  await writeFile(filePath, buffer)

  const url = `/uploads/${storedFilename}`
  const now = new Date().toISOString()

  await db.insert(messageAttachments).values({
    id,
    messageId: null,
    filename: file.name,
    mimeType: file.type,
    size: file.size,
    url,
    uploadedBy: userId,
    createdAt: now,
  })

  return c.json({
    ok: true,
    data: {
      id,
      filename: file.name,
      mimeType: file.type,
      size: file.size,
      url,
    },
  })
})

// Upload user avatar
uploadRoutes.post('/avatar', async (c) => {
  const userId = c.get('userId')
  const body = await c.req.parseBody()
  const file = body['file']

  if (!file || !(file instanceof File)) {
    return c.json({ ok: false, error: 'No file provided' }, 400)
  }

  if (file.size > MAX_AVATAR_SIZE) {
    return c.json({ ok: false, error: 'Avatar too large. Maximum size is 2MB' }, 400)
  }

  if (!AVATAR_TYPES.has(file.type)) {
    return c.json({ ok: false, error: 'Only JPEG, PNG, GIF and WebP images are allowed' }, 400)
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  if (!validateMagicBytes(buffer, file.type)) {
    return c.json({ ok: false, error: 'File content does not match declared type' }, 400)
  }

  const ext = extname(file.name) || '.jpg'
  const storedFilename = `avatar_${userId}${ext}`
  const filePath = resolve(config.uploadDir, storedFilename)
  await writeFile(filePath, buffer)

  const avatarUrl = `/uploads/${storedFilename}`
  const now = new Date().toISOString()

  await db
    .update(users)
    .set({ avatarUrl, updatedAt: now })
    .where(eq(users.id, userId))

  return c.json({ ok: true, data: { avatarUrl } })
})

// ─── Orphan Attachment Cleanup ───

const ORPHAN_MAX_AGE_MS = 60 * 60 * 1000 // 1 hour
const CLEANUP_INTERVAL_MS = 30 * 60 * 1000 // every 30 minutes

/** Remove uploaded files that were never associated with a message */
export async function cleanupOrphanAttachments() {
  const cutoff = new Date(Date.now() - ORPHAN_MAX_AGE_MS).toISOString()
  const orphans = await db
    .select({ id: messageAttachments.id, url: messageAttachments.url })
    .from(messageAttachments)
    .where(and(isNull(messageAttachments.messageId), lt(messageAttachments.createdAt, cutoff)))

  if (orphans.length === 0) return

  for (const orphan of orphans) {
    const filePath = resolve(config.uploadDir, orphan.url.replace(/^\/uploads\//, ''))
    try {
      await unlink(filePath)
    } catch {
      // File may already be deleted
    }
  }

  const orphanIds = orphans.map((o) => o.id)
  const { inArray } = await import('drizzle-orm')
  await db.delete(messageAttachments).where(inArray(messageAttachments.id, orphanIds))

  log.info(`Cleaned up ${orphans.length} orphan attachment(s)`)
}

let cleanupTimer: ReturnType<typeof setInterval> | null = null

export function startOrphanCleanup() {
  cleanupTimer = setInterval(cleanupOrphanAttachments, CLEANUP_INTERVAL_MS)
  // Run once at startup after a short delay
  setTimeout(cleanupOrphanAttachments, 10_000)
}

export function stopOrphanCleanup() {
  if (cleanupTimer) {
    clearInterval(cleanupTimer)
    cleanupTimer = null
  }
}
