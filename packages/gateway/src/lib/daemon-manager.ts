import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
} from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { createLogger } from './logger.js'

const log = createLogger('DaemonManager')

const DAEMONS_DIR = join(homedir(), '.agentim', 'daemons')

export interface DaemonInfo {
  pid: number
  name: string
  type: string
  workDir: string
  startedAt: string
  gatewayId: string
}

function ensureDir() {
  if (!existsSync(DAEMONS_DIR)) {
    mkdirSync(DAEMONS_DIR, { recursive: true })
  }
}

function pidFilePath(name: string): string {
  return join(DAEMONS_DIR, `${name}.json`)
}

/** Check if a process with the given PID is still running. */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** Write daemon info to a PID file. */
export function writeDaemonInfo(info: DaemonInfo): void {
  ensureDir()
  writeFileSync(pidFilePath(info.name), JSON.stringify(info, null, 2), 'utf-8')
}

/** Read daemon info from a PID file. Returns null if not found. */
export function readDaemonInfo(name: string): DaemonInfo | null {
  const filePath = pidFilePath(name)
  if (!existsSync(filePath)) return null
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8')) as DaemonInfo
  } catch {
    return null
  }
}

/** Remove a daemon PID file. */
export function removeDaemonInfo(name: string): void {
  const filePath = pidFilePath(name)
  try {
    unlinkSync(filePath)
  } catch {
    // File may not exist
  }
}

/** List all daemon entries, filtering out stale (dead) processes. */
export function listDaemons(): (DaemonInfo & { alive: boolean })[] {
  ensureDir()
  const result: (DaemonInfo & { alive: boolean })[] = []

  for (const file of readdirSync(DAEMONS_DIR)) {
    if (!file.endsWith('.json')) continue
    const filePath = join(DAEMONS_DIR, file)
    try {
      const info = JSON.parse(readFileSync(filePath, 'utf-8')) as DaemonInfo
      result.push({ ...info, alive: isProcessAlive(info.pid) })
    } catch {
      // Skip malformed files
    }
  }

  return result
}

/** Stop a daemon by name. Returns true if signal was sent. */
export function stopDaemon(name: string): boolean {
  const info = readDaemonInfo(name)
  if (!info) {
    log.warn(`Daemon "${name}" not found`)
    return false
  }

  if (!isProcessAlive(info.pid)) {
    log.warn(`Daemon "${name}" (PID ${info.pid}) is already dead, cleaning up`)
    removeDaemonInfo(name)
    return false
  }

  try {
    process.kill(info.pid, 'SIGTERM')
    log.info(`Sent SIGTERM to daemon "${name}" (PID ${info.pid})`)
    return true
  } catch (err) {
    log.error(`Failed to stop daemon "${name}": ${(err as Error).message}`)
    return false
  }
}

/** Stop and remove a daemon by name. */
export function removeDaemon(name: string): boolean {
  const stopped = stopDaemon(name)
  removeDaemonInfo(name)
  return stopped
}

/** Clean up stale PID files (dead processes). */
export function cleanStaleDaemons(): number {
  const daemons = listDaemons()
  let cleaned = 0
  for (const d of daemons) {
    if (!d.alive) {
      removeDaemonInfo(d.name)
      cleaned++
    }
  }
  if (cleaned > 0) {
    log.info(`Cleaned ${cleaned} stale daemon(s)`)
  }
  return cleaned
}
