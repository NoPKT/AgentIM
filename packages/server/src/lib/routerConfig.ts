import { eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import { rooms, routers } from '../db/schema.js'
import { decryptSecret } from './crypto.js'
import { createLogger } from './logger.js'
import { getSetting } from './settings.js'

const log = createLogger('RouterConfig')

export function isRouterVisibleToUser(
  router: { scope: string; visibility: string; visibilityList: string[]; createdById: string },
  userId: string,
): boolean {
  if (router.scope === 'personal') {
    return router.createdById === userId
  }
  if (router.visibility === 'all') return true

  const list = router.visibilityList

  if (router.visibility === 'whitelist') return list.includes(userId)
  if (router.visibility === 'blacklist') return !list.includes(userId)
  return false
}

export interface RouterConfig {
  llmBaseUrl: string
  llmApiKey: string
  llmModel: string
  maxChainDepth: number
  rateLimitWindow: number
  rateLimitMax: number
}

/**
 * Fall back to system-level AI Router settings when a room has no router assigned.
 * Returns null if system settings are not configured (missing baseUrl or apiKey).
 */
async function getSystemRouterConfig(): Promise<RouterConfig | null> {
  const [llmBaseUrl, llmApiKey, llmModel, maxChainDepthStr] = await Promise.all([
    getSetting('router.llm.baseUrl'),
    getSetting('router.llm.apiKey'),
    getSetting('router.llm.model'),
    getSetting('router.maxChainDepth'),
  ])
  if (!llmBaseUrl || !llmApiKey) return null
  return {
    llmBaseUrl,
    llmApiKey,
    llmModel: llmModel || 'gpt-4o-mini',
    maxChainDepth: parseInt(maxChainDepthStr, 10) || 5,
    rateLimitWindow: 60,
    rateLimitMax: 20,
  }
}

export async function getRouterConfig(roomId: string): Promise<RouterConfig | null> {
  // Note: routerId is validated via checkRouterAccess() when assigned to the room.
  // The API key is used server-side only (LLM calls) and never exposed to clients.
  // We add a defensive check for personal routers below.
  const [room] = await db
    .select({ routerId: rooms.routerId, createdById: rooms.createdById })
    .from(rooms)
    .where(eq(rooms.id, roomId))
    .limit(1)
  if (!room) return null

  // If room has no router assigned, fall back to system-level AI Router settings
  if (!room.routerId) {
    return getSystemRouterConfig()
  }

  const [router] = await db
    .select({
      llmBaseUrl: routers.llmBaseUrl,
      llmApiKey: routers.llmApiKey,
      llmModel: routers.llmModel,
      maxChainDepth: routers.maxChainDepth,
      rateLimitWindow: routers.rateLimitWindow,
      rateLimitMax: routers.rateLimitMax,
      scope: routers.scope,
      createdById: routers.createdById,
    })
    .from(routers)
    .where(eq(routers.id, room.routerId))
    .limit(1)
  if (!router) return null

  // Defense-in-depth: personal routers should only be used by their creator's rooms
  if (router.scope === 'personal' && router.createdById !== room.createdById) {
    return null
  }

  const llmApiKey = decryptSecret(router.llmApiKey)
  if (!llmApiKey) {
    log.error(`Failed to decrypt API key for router in room ${roomId}. Check ENCRYPTION_KEY.`)
    return null
  }

  return {
    ...router,
    llmApiKey,
  }
}
