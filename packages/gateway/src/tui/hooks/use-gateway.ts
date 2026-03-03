import { useState, useCallback } from 'react'
import { readDaemonInfo, stopDaemon } from '../../lib/daemon-manager.js'
import { spawnGatewayDaemon, type SpawnGatewayResult } from '../../lib/spawn-gateway.js'

export interface GatewayState {
  running: boolean
  pid: number | null
}

/** Check if a gateway daemon is running and provide start/stop controls. */
export function useGateway(): {
  gateway: GatewayState
  refresh: () => void
  stop: () => boolean
  start: () => Promise<SpawnGatewayResult>
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

  const start = useCallback(async (): Promise<SpawnGatewayResult> => {
    const result = await spawnGatewayDaemon()
    setGateway(check())
    return result
  }, [])

  return { gateway, refresh, stop, start }
}
