import { useState, useEffect } from 'react'
import { wsClient, type ConnectionStatus } from '../lib/ws.js'

export function useConnectionStatus(): ConnectionStatus {
  const [status, setStatus] = useState<ConnectionStatus>(wsClient.status)

  useEffect(() => {
    return wsClient.onStatusChange(setStatus)
  }, [])

  return status
}
