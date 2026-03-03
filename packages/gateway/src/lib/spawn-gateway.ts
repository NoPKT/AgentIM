import { spawn as cpSpawn } from 'node:child_process'
import { closeSync, mkdirSync, openSync, renameSync, statSync, unlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { loadConfig } from '../config.js'
import { readDaemonInfo, writeDaemonInfo, removeDaemonInfo } from './daemon-manager.js'

const LOG_MAX_SIZE = 10 * 1024 * 1024 // 10 MB

/** Rotate a log file if it exceeds LOG_MAX_SIZE. */
function rotateLogIfNeeded(logFile: string) {
  try {
    const stats = statSync(logFile)
    if (stats.size < LOG_MAX_SIZE) return
  } catch {
    return
  }

  const lockFile = logFile + '.lock'

  try {
    const lockStats = statSync(lockFile)
    if (Date.now() - lockStats.mtimeMs > 60_000) {
      unlinkSync(lockFile)
    }
  } catch {
    // Lock file doesn't exist
  }

  let lockFd: number | undefined
  try {
    lockFd = openSync(lockFile, 'wx')
    try {
      const stats = statSync(logFile)
      if (stats.size < LOG_MAX_SIZE) return
    } catch {
      return
    }
    const rotated = logFile + '.1'
    try {
      unlinkSync(rotated)
    } catch {
      // Previous rotated file may not exist
    }
    renameSync(logFile, rotated)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') {
      console.error(`Log rotation failed: ${(err as Error).message}`)
    }
  } finally {
    if (lockFd !== undefined) {
      closeSync(lockFd)
      try {
        unlinkSync(lockFile)
      } catch {
        /* already cleaned up */
      }
    }
  }
}

/** Get the entry point arguments for re-spawning ourselves. */
function getEntryArgs(): string[] {
  const entry = process.argv[1]
  if (!entry) return []
  return [entry]
}

export interface SpawnGatewayResult {
  ok: boolean
  error?: string
  pid?: number
}

/**
 * Spawn a detached gateway daemon process.
 * Returns a result object instead of calling process.exit().
 * Suitable for use from both CLI and TUI.
 */
export async function spawnGatewayDaemon(opts?: {
  agent?: string[]
  yes?: boolean
}): Promise<SpawnGatewayResult> {
  const config = loadConfig()
  if (!config) {
    return { ok: false, error: 'Not logged in. Run `agentim login` first.' }
  }

  const daemonName = 'gateway'

  // Check for existing gateway daemon
  const existing = readDaemonInfo(daemonName)
  if (existing) {
    try {
      process.kill(existing.pid, 0)
      return {
        ok: false,
        error: `Gateway daemon is already running (PID ${existing.pid}).`,
      }
    } catch {
      // Process is dead, clean up stale PID file
    }
  }

  const logDir = join(homedir(), '.agentim', 'logs')
  mkdirSync(logDir, { recursive: true })
  const logFile = join(logDir, `${daemonName}.log`)
  rotateLogIfNeeded(logFile)
  const logFd = openSync(logFile, 'a')

  // Build args: re-run ourselves as `gateway` command in foreground mode (no -d flag)
  const daemonArgs = [...process.execArgv, ...getEntryArgs(), 'gateway']
  if (opts?.agent?.length) {
    for (const spec of opts.agent) {
      daemonArgs.push('--agent', spec)
    }
  }
  if (opts?.yes) {
    daemonArgs.push('--yes')
  }
  daemonArgs.push('--no-security-warning')

  const reservationInfo = {
    pid: process.pid,
    name: daemonName,
    type: 'gateway',
    workDir: process.cwd(),
    startedAt: new Date().toISOString(),
    gatewayId: config.gatewayId,
  }
  try {
    writeDaemonInfo(reservationInfo, true)
  } catch (err) {
    closeSync(logFd)
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
      return { ok: false, error: 'Gateway daemon is already being started by another process.' }
    }
    return { ok: false, error: `Failed to reserve daemon: ${(err as Error).message}` }
  }

  const child = cpSpawn(process.execPath, daemonArgs, {
    detached: true,
    stdio: ['ignore', logFd, logFd],
    cwd: process.cwd(),
    env: { ...process.env },
  })

  child.unref()
  closeSync(logFd)

  if (!child.pid) {
    removeDaemonInfo(daemonName)
    return { ok: false, error: 'Failed to start gateway daemon process.' }
  }

  writeDaemonInfo({ ...reservationInfo, pid: child.pid })

  // Wait briefly to catch immediate startup failures
  const exitedImmediately = await new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      child.removeAllListeners('exit')
      resolve(false)
    }, 500)
    timer.unref()
    child.once('exit', (code) => {
      clearTimeout(timer)
      removeDaemonInfo(daemonName)
      resolve(true)
      // Store exit code for error message
      ;(child as { _exitCode?: number | null })._exitCode = code
    })
  })

  if (exitedImmediately) {
    return {
      ok: false,
      error: `Gateway daemon exited immediately with code ${child.exitCode ?? 'unknown'}.`,
    }
  }

  return { ok: true, pid: child.pid }
}
