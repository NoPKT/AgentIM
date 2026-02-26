import { nanoid } from 'nanoid'
import type { Context } from 'hono'
import { getConnInfo } from '@hono/node-server/conninfo'
import { db } from '../db/index.js'
import { auditLogs } from '../db/schema.js'
import { config, getConfigSync } from '../config.js'
import { createLogger } from './logger.js'

const log = createLogger('Audit')

export type AuditAction =
  | 'login'
  | 'login_failed'
  | 'logout'
  | 'password_change'
  | 'user_create'
  | 'user_update'
  | 'user_delete'
  | 'router_create'
  | 'router_update'
  | 'router_delete'
  | 'room_create'
  | 'room_update'
  | 'room_delete'
  | 'member_add'
  | 'member_remove'
  | 'file_upload'
  | 'file_delete'
  | 'message_edit'
  | 'message_delete'
  | 'setting_update'

interface AuditOptions {
  userId?: string | null
  action: AuditAction
  targetId?: string
  targetType?: 'user' | 'router' | 'room' | 'file' | 'member' | 'message' | 'setting'
  metadata?: Record<string, unknown>
  ipAddress?: string
}

/**
 * Compute which fields changed between two objects. Returns a map of
 * field names to `{ from, to }` pairs. Only includes fields where the
 * serialized value actually differs. Useful for enriching audit logs with
 * field-level change details.
 */
export function diffFields(
  prev: Record<string, unknown>,
  next: Record<string, unknown>,
  fieldsToTrack?: string[],
): Record<string, { from: unknown; to: unknown }> | null {
  const keys = fieldsToTrack ?? [...new Set([...Object.keys(prev), ...Object.keys(next)])]
  const changes: Record<string, { from: unknown; to: unknown }> = {}
  for (const key of keys) {
    const a = JSON.stringify(prev[key] ?? null)
    const b = JSON.stringify(next[key] ?? null)
    if (a !== b) {
      changes[key] = { from: prev[key] ?? null, to: next[key] ?? null }
    }
  }
  return Object.keys(changes).length > 0 ? changes : null
}

const MAX_METADATA_SIZE = 4096 // 4KB limit for metadata JSON

export async function logAudit(opts: AuditOptions): Promise<void> {
  try {
    // Truncate oversized metadata to prevent DB row bloat
    let metadata = opts.metadata ?? null
    if (metadata) {
      const json = JSON.stringify(metadata)
      if (json.length > MAX_METADATA_SIZE) {
        metadata = { _truncated: true, _originalSize: json.length }
        log.warn(`Audit metadata truncated for action=${opts.action} (${json.length} bytes)`)
      }
    }

    await db.insert(auditLogs).values({
      id: nanoid(),
      userId: opts.userId ?? null,
      action: opts.action,
      targetId: opts.targetId,
      targetType: opts.targetType,
      metadata,
      ipAddress: opts.ipAddress,
      createdAt: new Date().toISOString(),
    })
  } catch (err) {
    // Audit logging must never break the main flow, but log the failure
    log.warn(`Audit write failed for action=${opts.action}: ${(err as Error).message}`)
  }
}

export function getClientIp(c: Context): string {
  const trustProxy = getConfigSync<boolean>('trust.proxy') || config.trustProxy
  if (trustProxy) {
    return (
      c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
      c.req.header('x-real-ip') ||
      'unknown'
    )
  }
  // Fall back to socket remote address for direct deployments
  try {
    const info = getConnInfo(c)
    return info.remote?.address || 'unknown'
  } catch {
    return 'unknown'
  }
}
