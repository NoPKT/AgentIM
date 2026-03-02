import { useState, useCallback } from 'react'
import { readDaemonInfo, stopDaemon } from '../../lib/daemon-manager.js'

export interface GatewayState {
  running: boolean
  pid: number | null
}

/** Check if a gateway daemon is running and provide start/stop controls. */
export function useGateway(): {
  gateway: GatewayState
  refresh: () => void
  stop: () => boolean
} {
  const check = (): GatewayState => {
    const info = readDaemonInfo('gateway')
    if (!info) return { running: false, pid: null }
    try {
      process.kill(info.pid, 0)
      return { running: true, pid: info.pid }
    } catch {
      return { running: false, pid: null }
    }
  }

  const [gateway, setGateway] = useState<GatewayState>(check)

  const refresh = useCallback(() => {
    setGateway(check())
  }, [])

  const stop = useCallback((): boolean => {
    const ok = stopDaemon('gateway')
    setGateway(check())
    return ok
  }, [])

  return { gateway, refresh, stop }
}
