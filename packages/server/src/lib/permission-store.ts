import { PERMISSION_TIMEOUT_MS } from '@agentim/shared'
import { createLogger } from './logger.js'

const log = createLogger('PermissionStore')

interface PendingPermission {
  agentId: string
  roomId: string
  timer: ReturnType<typeof setTimeout>
  createdAt: number
}

const pending = new Map<string, PendingPermission>()

/** Maximum number of pending permission requests to prevent memory exhaustion. */
const MAX_PENDING_PERMISSIONS = 1_000

export function addPendingPermission(
  requestId: string,
  opts: { agentId: string; roomId: string; timer: ReturnType<typeof setTimeout> },
): boolean {
  if (pending.size >= MAX_PENDING_PERMISSIONS && !pending.has(requestId)) {
    log.warn(
      `Permission queue at capacity (${MAX_PENDING_PERMISSIONS}), rejecting request ${requestId}`,
    )
    clearTimeout(opts.timer)
    return false
  }
  pending.set(requestId, { ...opts, createdAt: Date.now() })
  return true
}

export function getPendingPermission(requestId: string): PendingPermission | undefined {
  return pending.get(requestId)
}

export function clearPendingPermission(requestId: string) {
  const p = pending.get(requestId)
  if (p) {
    clearTimeout(p.timer)
    pending.delete(requestId)
  }
}

export function getPendingCount(): number {
  return pending.size
}

// Periodic cleanup of stale entries that were never resolved
const STALE_THRESHOLD = PERMISSION_TIMEOUT_MS * 2
const CLEANUP_INTERVAL = 60_000

const permissionCleanupTimer = setInterval(() => {
  const now = Date.now()
  let cleaned = 0
  for (const [requestId, entry] of pending) {
    if (now - entry.createdAt > STALE_THRESHOLD) {
      clearTimeout(entry.timer)
      pending.delete(requestId)
      cleaned++
    }
  }
  if (cleaned > 0) {
    log.info(`Cleaned up ${cleaned} stale pending permission(s)`)
  }
}, CLEANUP_INTERVAL)
permissionCleanupTimer.unref()

export function stopPermissionCleanup() {
  clearInterval(permissionCleanupTimer)
}
