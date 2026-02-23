import { PERMISSION_TIMEOUT_MS } from '@agentim/shared'
import { createLogger } from './logger.js'

const log = createLogger('PermissionStore')

interface PendingPermission {
  agentId: string
  roomId: string
  timer: ReturnType<typeof setTimeout>
}

const pending = new Map<string, PendingPermission>()

export function addPendingPermission(
  requestId: string,
  opts: { agentId: string; roomId: string; timer: ReturnType<typeof setTimeout> },
) {
  pending.set(requestId, opts)
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
