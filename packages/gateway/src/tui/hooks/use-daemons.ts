import { useState, useEffect } from 'react'
import { listDaemons, readDaemonStatus, cleanStaleDaemons } from '../../lib/daemon-manager.js'
import type { DaemonInfo, DaemonStatus } from '../../lib/daemon-manager.js'

const POLL_INTERVAL_MS = 5_000
const STALE_THRESHOLD_MS = 120_000

export interface DaemonEntry {
  info: DaemonInfo & { alive: boolean }
  status: DaemonStatus | null
  /** Status file is older than 2 minutes */
  stale: boolean
}

/** Poll daemon info + status files every 5s. */
export function useDaemons(): DaemonEntry[] {
  const [daemons, setDaemons] = useState<DaemonEntry[]>([])

  useEffect(() => {
    const refresh = () => {
      cleanStaleDaemons()
      const list = listDaemons()
      const now = Date.now()
      const entries: DaemonEntry[] = list.map((info) => {
        const status = readDaemonStatus(info.name)
        const stale = status
          ? now - new Date(status.updatedAt).getTime() > STALE_THRESHOLD_MS
          : false
        return { info, status, stale }
      })
      setDaemons(entries)
    }

    refresh()
    const timer = setInterval(refresh, POLL_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [])

  return daemons
}
