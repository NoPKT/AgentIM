import { randomBytes } from 'node:crypto'
import { hostname } from 'node:os'
import { basename } from 'node:path'

/**
 * Generate a human-readable agent name based on context.
 * Format: {hostname}_{dirname}_{type}_{4-digit hex}
 */
export function generateAgentName(type: string, workDir?: string): string {
  const host = hostname()
    .replace(/\.local$/, '')
    .replace(/[^a-zA-Z0-9-]/g, '')
  const dir = workDir ? basename(workDir).replace(/[^a-zA-Z0-9-_]/g, '') : 'default'
  const hex = randomBytes(2).toString('hex')
  return `${host}_${dir}_${type}_${hex}`
}
