import { Hono } from 'hono'
import { nanoid, customAlphabet } from 'nanoid'

// Safe alphabet for filenames: excludes '-' at start to avoid CLI tool issues
// and to satisfy avatar URL validation regex
const safeNanoid = customAlphabet(
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_',
  21,
)
import { eq, isNull, lt, and } from 'drizzle-orm'
import { extname } from 'node:path'
import { db } from '../db/index.js'
import { messageAttachments, users } from '../db/schema.js'
import { authMiddleware, type AuthEnv } from '../middleware/auth.js'
import { uploadRateLimit } from '../middleware/rateLimit.js'
import { config } from '../config.js'
import { getStorage } from '../storage/index.js'
import { createLogger } from '../lib/logger.js'
import { logAudit, getClientIp } from '../lib/audit.js'

const log = createLogger('Uploads')

const AVATAR_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp'])

/** Map validated MIME types to canonical file extensions */
const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'application/pdf': '.pdf',
  'application/zip': '.zip',
  'application/x-zip-compressed': '.zip',
  'application/gzip': '.gz',
  'text/plain': '.txt',
  'text/markdown': '.md',
  'text/csv': '.csv',
  'application/json': '.json',
}
const MAX_AVATAR_SIZE = 2 * 1024 * 1024 // 2MB

// Magic byte signatures for content-based type validation
const MAGIC_BYTES: [string, number[], number?][] = [
  ['image/jpeg', [0xff, 0xd8, 0xff]],
  ['image/png', [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  ['image/gif', [0x47, 0x49, 0x46, 0x38]],
  ['image/webp', [0x52, 0x49, 0x46, 0x46]], // RIFF header; also check 'WEBP' at offset 8
  ['application/pdf', [0x25, 0x50, 0x44, 0x46]],
  ['application/zip', [0x50, 0x4b, 0x03, 0x04]],
  ['application/x-zip-compressed', [0x50, 0x4b, 0x03, 0x04]],
  ['application/gzip', [0x1f, 0x8b]],
]

/** Text-based MIME types that should be validated as valid UTF-8 without null bytes */
const TEXT_MIME_TYPES = new Set(['text/plain', 'text/markdown', 'text/csv', 'application/json'])

function validateMagicBytes(buffer: Buffer, declaredType: string): boolean {
  // For text-based types, verify the content is valid UTF-8 and contains no null bytes
  if (TEXT_MIME_TYPES.has(declaredType)) {
    // Null bytes indicate binary data disguised as text
    if (buffer.includes(0x00)) return false
    // Validate UTF-8 by round-tripping through TextDecoder
    try {
      const decoder = new TextDecoder('utf-8', { fatal: true })
      decoder.decode(buffer)
    } catch {
      return false
    }
    return true
  }

  // Only validate types we have signatures for (exact match only)
  const signatures = MAGIC_BYTES.filter(([type]) => type === declaredType)
  if (signatures.length === 0) return true // No known signature — allow (MIME check already passed)

  const matchesAny = signatures.some(([, bytes]) => {
    if (buffer.length < bytes.length) return false
    return bytes.every((b, i) => buffer[i] === b)
  })

  if (!matchesAny) return false

  // Extra check for WebP: bytes 8-11 must be 'WEBP' and bytes 12-15 must be
  // a valid VP8 chunk identifier ('VP8 ', 'VP8L', or 'VP8X').
  if (declaredType === 'image/webp') {
    if (buffer.length < 16) return false
    if (buffer.toString('ascii', 8, 12) !== 'WEBP') return false
    const chunkId = buffer.toString('ascii', 12, 16)
    return chunkId === 'VP8 ' || chunkId === 'VP8L' || chunkId === 'VP8X'
  }
  return true
}

export const uploadRoutes = new Hono<AuthEnv>()

uploadRoutes.use('*', authMiddleware)
uploadRoutes.use('*', uploadRateLimit)

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
      {
        ok: false,
        error: `File too large. Maximum size is ${Math.round(config.maxFileSize / 1024 / 1024)}MB`,
      },
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
  const ext = MIME_TO_EXT[file.type] || ''
  // Use safe alphabet for filenames to ensure they always match avatarUrl validation regex
  const storedFilename = `${safeNanoid()}${ext}`
  await getStorage().write(storedFilename, buffer, file.type)

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

  logAudit({
    userId,
    action: 'file_upload',
    targetId: id,
    targetType: 'file',
    metadata: { filename: file.name, mimeType: file.type, size: file.size },
    ipAddress: getClientIp(c),
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

  const ext = MIME_TO_EXT[file.type] || extname(file.name) || '.jpg'
  const storedFilename = `avatar_${userId}_${Date.now()}${ext}`

  // Remove previous avatar files with different extensions to prevent storage leakage
  const prefix = `avatar_${userId}`
  try {
    const files = await getStorage().list(prefix)
    for (const f of files) {
      if (f !== storedFilename) {
        await getStorage()
          .delete(f)
          .catch((err: unknown) => {
            log.warn(
              `Failed to delete old avatar file ${f}: ${err instanceof Error ? err.message : err}`,
            )
          })
      }
    }
  } catch {
    // Storage may not be initialized yet; write below will create the file
  }

  await getStorage().write(storedFilename, buffer, file.type)

  const avatarUrl = `/uploads/${storedFilename}`
  const now = new Date().toISOString()

  await db.update(users).set({ avatarUrl, updatedAt: now }).where(eq(users.id, userId))

  return c.json({ ok: true, data: { avatarUrl } })
})

// ─── Orphan Attachment Cleanup ───

const ORPHAN_MAX_AGE_MS = 60 * 60 * 1000 // 1 hour

/** Remove uploaded files that were never associated with a message */
export async function cleanupOrphanAttachments() {
  const cutoff = new Date(Date.now() - ORPHAN_MAX_AGE_MS).toISOString()
  const orphans = await db
    .select({ id: messageAttachments.id, url: messageAttachments.url })
    .from(messageAttachments)
    .where(and(isNull(messageAttachments.messageId), lt(messageAttachments.createdAt, cutoff)))

  if (orphans.length === 0) return

  const unlinkedIds: string[] = []
  for (const orphan of orphans) {
    const filename = orphan.url.replace(/^\/uploads\//, '')
    try {
      await getStorage().delete(filename)
      unlinkedIds.push(orphan.id)
    } catch (err: unknown) {
      log.warn(
        `Failed to delete orphan file ${filename}: ${err instanceof Error ? err.message : err}`,
      )
    }
  }

  if (unlinkedIds.length > 0) {
    const { inArray } = await import('drizzle-orm')
    await db.delete(messageAttachments).where(inArray(messageAttachments.id, unlinkedIds))
  }

  log.info(`Cleaned up ${unlinkedIds.length} orphan attachment(s)`)
}

let cleanupTimer: ReturnType<typeof setInterval> | null = null

export function startOrphanCleanup() {
  cleanupTimer = setInterval(() => {
    cleanupOrphanAttachments().catch((err) => {
      log.error(`Orphan cleanup failed: ${(err as Error).message}`)
    })
  }, config.orphanFileCheckInterval)
  // Run once at startup after a short delay
  setTimeout(() => {
    cleanupOrphanAttachments().catch((err) => {
      log.error(`Initial orphan cleanup failed: ${(err as Error).message}`)
    })
  }, 10_000)
}

export function stopOrphanCleanup() {
  if (cleanupTimer) {
    clearInterval(cleanupTimer)
    cleanupTimer = null
  }
}
