import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  renameSync,
} from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { homedir, platform } from 'node:os'
import { execSync } from 'node:child_process'
import { createLogger } from './logger.js'

const log = createLogger('DaemonManager')

const DAEMONS_DIR = process.env.AGENTIM_DAEMONS_DIR || join(homedir(), '.agentim', 'daemons')

export interface DaemonInfo {
  pid: number
  name: string
  type: string
  workDir: string
  startedAt: string
  gatewayId: string
  agentId?: string
}

export interface DaemonStatus {
  agentId?: string
  model?: string
  costUSD: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  thinkingMode?: string
  effortLevel?: string
  planMode?: boolean
  running: boolean
  updatedAt: string
}

function ensureDir() {
  if (!existsSync(DAEMONS_DIR)) {
    mkdirSync(DAEMONS_DIR, { recursive: true, mode: 0o700 })
  }
}

function pidFilePath(name: string): string {
  return join(DAEMONS_DIR, `${name}.json`)
}

function statusFilePath(name: string): string {
  return join(DAEMONS_DIR, `${name}.status.json`)
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

/**
 * Verify that the process with the given PID is actually an agentim process.
 * Prevents acting on a recycled PID that now belongs to an unrelated process.
 * Uses argv-based matching to avoid false positives from unrelated processes
 * that happen to have "agentim" in their path (e.g. /opt/agentim-tools/other).
 *
 * @param pid - The process ID to check.
 * @param strict - When true (default), returns false if the process cannot be
 *   positively identified as agentim. Safe for destructive operations like
 *   stopDaemon (won't kill unverified processes). When false, returns true if
 *   the process is alive even when identity cannot be confirmed. Safe for
 *   read-only operations like listDaemons (won't delete daemon files for
 *   processes that are alive but unverifiable).
 */
function isAgentimProcess(pid: number, strict = true): boolean {
  try {
    let matched = false
    if (platform() === 'linux') {
      // /proc/PID/cmdline uses NUL as argv separator
      const cmdline = readFileSync(`/proc/${pid}/cmdline`, 'utf-8')
      const args = cmdline.split('\0')
      // Check if any argv element ends with 'agentim' (the CLI entry point)
      // or contains '/agentim/' (the dist path) or the argv includes 'daemon'
      matched = args.some(
        (arg) =>
          arg.endsWith('/agentim') ||
          arg.endsWith('/cli.js') ||
          arg.endsWith('/cli.ts') ||
          (arg.includes('agentim') && (arg.includes('daemon') || arg.includes('--foreground'))),
      )
    } else if (platform() === 'win32') {
      // Windows: use WMIC to query process command line by PID
      const output = execSync(
        `wmic process where "ProcessId=${pid}" get CommandLine /format:list`,
        {
          encoding: 'utf-8',
          timeout: 5000,
        },
      ).trim()
      matched = /\bagentim\b/i.test(output) || /cli\.[jt]s\b/i.test(output)
    } else {
      // macOS / other Unix: use ps with full argument list
      const output = execSync(`ps -p ${pid} -o args=`, {
        encoding: 'utf-8',
        timeout: 3000,
      }).trim()
      // Match the agentim CLI binary or daemon subcommand
      matched = /\bagentim\b/.test(output) || /cli\.[jt]s\b/.test(output)
    }
    if (matched) return true
    // Process is alive but identity not confirmed via pattern matching.
    // In lenient mode, assume it's ours to avoid incorrectly deleting
    // daemon files (e.g. when the process was started in an unusual way).
    if (!strict) return isProcessAlive(pid)
    return false
  } catch {
    // Verification failed (timeout, permission denied, etc.).
    // In lenient mode, assume the process is agentim if it's still alive.
    if (!strict) return isProcessAlive(pid)
    // In strict mode, assume NOT an agentim process to avoid killing
    // an unrelated process that recycled this PID.
    return false
  }
}

/** Write daemon info to a PID file.
 * @param exclusive - If true, uses 'wx' flag (exclusive create) to fail if file already exists.
 *                    Used for reservation writes to prevent TOCTOU races.
 */
export function writeDaemonInfo(info: DaemonInfo, exclusive = false): void {
  ensureDir()
  writeFileSync(pidFilePath(info.name), JSON.stringify(info, null, 2), {
    encoding: 'utf-8',
    mode: 0o600,
    flag: exclusive ? 'wx' : 'w',
  })
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

/** Remove a daemon PID file and its status file. */
export function removeDaemonInfo(name: string): void {
  const filePath = pidFilePath(name)
  try {
    unlinkSync(filePath)
  } catch {
    // File may not exist
  }
  removeDaemonStatus(name)
}

/** Write daemon runtime status atomically (temp file + rename). */
export function writeDaemonStatus(name: string, status: DaemonStatus): void {
  ensureDir()
  const filePath = statusFilePath(name)
  const tmpPath = filePath + '.' + randomBytes(4).toString('hex') + '.tmp'
  writeFileSync(tmpPath, JSON.stringify(status, null, 2), { encoding: 'utf-8', mode: 0o600 })
  renameSync(tmpPath, filePath)
}

/** Read daemon runtime status. Returns null if not found or malformed. */
export function readDaemonStatus(name: string): DaemonStatus | null {
  const filePath = statusFilePath(name)
  if (!existsSync(filePath)) return null
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8')) as DaemonStatus
  } catch {
    return null
  }
}

/** Remove a daemon status file. */
export function removeDaemonStatus(name: string): void {
  const filePath = statusFilePath(name)
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
    if (!file.endsWith('.json') || file.endsWith('.status.json')) continue
    const filePath = join(DAEMONS_DIR, file)
    try {
      const info = JSON.parse(readFileSync(filePath, 'utf-8')) as DaemonInfo
      result.push({
        ...info,
        alive: isProcessAlive(info.pid) && isAgentimProcess(info.pid, false),
      })
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

  if (!isProcessAlive(info.pid) || !isAgentimProcess(info.pid)) {
    log.warn(`Daemon "${name}" (PID ${info.pid}) is not a live agentim process, cleaning up`)
    removeDaemonInfo(name)
    return false
  }

  try {
    process.kill(info.pid, 'SIGTERM')
    log.info(`Sent SIGTERM to daemon "${name}" (PID ${info.pid})`)
    // Remove PID file immediately so status checks reflect the stop
    removeDaemonInfo(name)
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
