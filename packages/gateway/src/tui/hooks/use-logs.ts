import { useState, useEffect, useCallback } from 'react'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const LOG_DIR = join(homedir(), '.agentim', 'logs')
const TAIL_LINES = 50
const POLL_INTERVAL_MS = 3_000

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

/** Poll a daemon's log file and return the last N lines. */
export function useLogs(daemonName: string | null): LogEntry[] {
  const [logs, setLogs] = useState<LogEntry[]>([])

  const refresh = useCallback(() => {
    if (!daemonName) {
      setLogs([])
      return
    }
    const logFile = join(LOG_DIR, `${daemonName}.log`)
    const lines = tailFile(logFile, TAIL_LINES)
    setLogs(lines.map((line) => ({ line })))
  }, [daemonName])

  useEffect(() => {
    refresh()
    const timer = setInterval(refresh, POLL_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [refresh])

  return logs
}
