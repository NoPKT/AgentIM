import { nanoid } from 'nanoid'
import { MAX_SERVICE_AGENT_FILE_SIZE } from '@agentim/shared'
import { getStorage } from '../../storage/index.js'
import { db } from '../../db/index.js'
import { messageAttachments } from '../../db/schema.js'
import { createLogger } from '../logger.js'

const log = createLogger('MediaStorage')

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
    // Fetch external URL
    const response = await fetch(url, {
      signal: AbortSignal.timeout(120_000),
    })

    if (!response.ok) {
      throw new Error(`Failed to download media (${response.status})`)
    }

    const arrayBuffer = await response.arrayBuffer()
    buffer = Buffer.from(arrayBuffer)
  }

  if (buffer.length > MAX_SERVICE_AGENT_FILE_SIZE) {
    throw new Error(
      `Media file too large: ${(buffer.length / 1024 / 1024).toFixed(1)}MB exceeds ${MAX_SERVICE_AGENT_FILE_SIZE / 1024 / 1024}MB limit`,
    )
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
