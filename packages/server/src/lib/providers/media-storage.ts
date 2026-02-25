import { nanoid } from 'nanoid'
import { MAX_SERVICE_AGENT_FILE_SIZE } from '@agentim/shared'
import { getStorage } from '../../storage/index.js'
import { db } from '../../db/index.js'
import { messageAttachments } from '../../db/schema.js'
import { createLogger } from '../logger.js'

const log = createLogger('MediaStorage')

/** Check if a URL points to a private/internal IP range (SSRF prevention). */
export function isPrivateUrl(urlStr: string): boolean {
  try {
    const parsed = new URL(urlStr)
    const hostname = parsed.hostname
    // Block private IP ranges, localhost, and link-local addresses
    if (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '::1' ||
      hostname === '0.0.0.0' ||
      hostname.endsWith('.local') ||
      hostname.endsWith('.internal')
    ) {
      return true
    }
    // IPv4 private ranges
    const ipv4Match = hostname.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/)
    if (ipv4Match) {
      const [, a, b] = ipv4Match.map(Number)
      if (a === 10) return true // 10.0.0.0/8
      if (a === 172 && b >= 16 && b <= 31) return true // 172.16.0.0/12
      if (a === 192 && b === 168) return true // 192.168.0.0/16
      if (a === 169 && b === 254) return true // 169.254.0.0/16 (link-local)
      if (a === 100 && b >= 64 && b <= 127) return true // 100.64.0.0/10 (CGNAT)
      if (a >= 224) return true // multicast + reserved
    }
    return false
  } catch {
    return true // Invalid URL → block
  }
}

export interface StoredMedia {
  url: string
  size: number
  key: string
}

/**
 * Download media from an external URL (or data URI) and store it via the storage adapter.
 * Returns an internal URL path that can be served from /uploads/.
 */
export async function downloadAndStoreMedia(
  url: string,
  filename: string,
  mimeType: string,
): Promise<StoredMedia> {
  let buffer: Buffer

  if (url.startsWith('data:')) {
    // Handle data URIs (e.g. base64 audio from ElevenLabs)
    const base64Match = url.match(/^data:[^;]+;base64,(.+)$/)
    if (!base64Match) {
      throw new Error('Invalid data URI')
    }
    buffer = Buffer.from(base64Match[1], 'base64')
  } else {
    // SSRF prevention: block requests to private/internal networks
    if (isPrivateUrl(url)) {
      throw new Error('URL points to a private/internal network (blocked for security)')
    }

    // Fetch external URL with streaming size enforcement
    const response = await fetch(url, {
      signal: AbortSignal.timeout(120_000),
    })

    if (!response.ok) {
      throw new Error(`Failed to download media (${response.status})`)
    }

    // Stream response body with size enforcement to prevent memory exhaustion
    const chunks: Buffer[] = []
    let totalSize = 0
    const reader = response.body?.getReader()
    if (!reader) {
      throw new Error('Response body is not readable')
    }
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        totalSize += value.byteLength
        if (totalSize > MAX_SERVICE_AGENT_FILE_SIZE) {
          throw new Error(
            `Media file too large: exceeds ${MAX_SERVICE_AGENT_FILE_SIZE / 1024 / 1024}MB limit (download aborted)`,
          )
        }
        chunks.push(Buffer.from(value))
      }
    } finally {
      reader.releaseLock()
    }
    buffer = Buffer.concat(chunks)
  }

  // Store using the storage adapter
  const ext = filename.split('.').pop() ?? 'bin'
  const key = `service-agents/${nanoid()}.${ext}`
  const storage = getStorage()

  await storage.write(key, buffer, mimeType)

  log.info(`Stored media: ${key} (${(buffer.length / 1024).toFixed(1)}KB)`)

  return {
    url: `/uploads/${key}`,
    size: buffer.length,
    key,
  }
}

/**
 * Create a message attachment record in the database.
 */
export async function createMediaAttachment(
  messageId: string,
  media: StoredMedia,
  filename: string,
  mimeType: string,
): Promise<string> {
  const id = nanoid()
  const now = new Date().toISOString()

  await db.insert(messageAttachments).values({
    id,
    messageId,
    filename,
    mimeType,
    size: media.size,
    url: media.url,
    createdAt: now,
  })

  return id
}
