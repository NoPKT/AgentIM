import { useEffect } from 'react'
import { wsClient } from '../lib/ws.js'
import { useChatStore } from '../stores/chat.js'
import { useAgentStore } from '../stores/agents.js'
import type { ServerMessage } from '@agentim/shared'

export function useWebSocket() {
  const addMessage = useChatStore((s) => s.addMessage)
  const addStreamChunk = useChatStore((s) => s.addStreamChunk)
  const completeStream = useChatStore((s) => s.completeStream)
  const updateAgent = useAgentStore((s) => s.updateAgent)

  useEffect(() => {
    const unsub = wsClient.onMessage((msg: ServerMessage) => {
      switch (msg.type) {
        case 'server:new_message':
          addMessage(msg.message)
          break
        case 'server:message_chunk':
          addStreamChunk(msg.roomId, msg.agentId, msg.agentName, msg.messageId, msg.chunk)
          break
        case 'server:message_complete':
          completeStream(msg.message)
          break
        case 'server:agent_status':
          updateAgent(msg.agent)
          break
      }
    })

    return unsub
  }, [addMessage, addStreamChunk, completeStream, updateAgent])
}
