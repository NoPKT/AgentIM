import { eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import { rooms, routers } from '../db/schema.js'
import { decryptSecret } from './crypto.js'

export function isRouterVisibleToUser(
  router: { scope: string; visibility: string; visibilityList: string; createdById: string },
  userId: string,
): boolean {
  if (router.scope === 'personal') {
    return router.createdById === userId
  }
  if (router.visibility === 'all') return true

  let list: string[] = []
  try {
    list = JSON.parse(router.visibilityList)
  } catch {
    /* ignore */
  }

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

export async function getRouterConfig(roomId: string): Promise<RouterConfig | null> {
  // Note: routerId is validated via checkRouterAccess() when assigned to the room.
  // The API key is used server-side only (LLM calls) and never exposed to clients.
  // We add a defensive check for personal routers below.
  const [room] = await db
    .select({ routerId: rooms.routerId, createdById: rooms.createdById })
    .from(rooms)
    .where(eq(rooms.id, roomId))
    .limit(1)
  if (!room?.routerId) return null

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
  if (!llmApiKey) return null

  return {
    ...router,
    llmApiKey,
  }
}
