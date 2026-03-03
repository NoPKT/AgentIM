import { useState, useEffect, useCallback, useRef } from 'react'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const LOG_DIR = join(homedir(), '.agentim', 'logs')
const TAIL_LINES = 50
const POLL_INTERVAL_MS = 3_000
const MAX_ACCUMULATED = 5000

/** Read the last N lines of a daemon log file. */
function tailFile(filePath: string, lines: number): string[] {
  if (!existsSync(filePath)) return []
  try {
    const content = readFileSync(filePath, 'utf-8')
    const allLines = content.split('\n')
    return allLines.slice(-lines).filter((l) => l.length > 0)
  } catch {
    return []
  }
}

export interface LogEntry {
  line: string
}

/**
 * Poll a daemon's log file and accumulate log entries.
 * Unlike a simple tail, this preserves history so that scroll offsets
 * remain stable when auto-follow is paused.
 */
export function useLogs(daemonName: string | null): LogEntry[] {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const prevTailRef = useRef<string[]>([])
  const activeDaemonRef = useRef<string | null>(null)

  const refresh = useCallback(() => {
    if (!daemonName) {
      setLogs([])
      prevTailRef.current = []
      activeDaemonRef.current = null
      return
    }

    // Reset accumulated state when switching daemons
    if (daemonName !== activeDaemonRef.current) {
      prevTailRef.current = []
      activeDaemonRef.current = daemonName
    }

    const logFile = join(LOG_DIR, `${daemonName}.log`)
    const tail = tailFile(logFile, TAIL_LINES)
    const prev = prevTailRef.current
    prevTailRef.current = tail

    // First load or daemon just switched
    if (prev.length === 0) {
      setLogs(tail.map((line) => ({ line })))
      return
    }

    // Log file cleared or deleted
    if (tail.length === 0) {
      if (prev.length > 0) {
        setLogs([])
      }
      return
    }

    // Find the boundary between old and new lines.
    // Search for the last previously-seen line in the new tail (reverse search
    // handles the unlikely case of duplicate lines correctly).
    const lastPrev = prev[prev.length - 1]
    let foundIdx = -1
    for (let i = tail.length - 1; i >= 0; i--) {
      if (tail[i] === lastPrev) {
        foundIdx = i
        break
      }
    }

    if (foundIdx === -1) {
      // Last known line not found — file was rotated/truncated; full reset
      setLogs(tail.map((line) => ({ line })))
      return
    }

    const newStart = foundIdx + 1
    if (newStart >= tail.length) return // No new lines

    const newEntries = tail.slice(newStart).map((line) => ({ line }))
    setLogs((accumulated) => {
      const combined = [...accumulated, ...newEntries]
      return combined.length > MAX_ACCUMULATED
        ? combined.slice(combined.length - MAX_ACCUMULATED)
        : combined
    })
  }, [daemonName])

  useEffect(() => {
    refresh()
    const timer = setInterval(refresh, POLL_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [refresh])

  return logs
}
