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
  | 'setting_update'

interface AuditOptions {
  userId?: string | null
  action: AuditAction
  targetId?: string
  targetType?: 'user' | 'router' | 'room' | 'file' | 'member'
  metadata?: Record<string, unknown>
  ipAddress?: string
}

export async function logAudit(opts: AuditOptions): Promise<void> {
  try {
    await db.insert(auditLogs).values({
      id: nanoid(),
      userId: opts.userId ?? null,
      action: opts.action,
      targetId: opts.targetId,
      targetType: opts.targetType,
      metadata: opts.metadata ? JSON.stringify(opts.metadata) : null,
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
