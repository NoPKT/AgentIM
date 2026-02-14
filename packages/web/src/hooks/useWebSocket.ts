import { useEffect } from 'react'
import { wsClient } from '../lib/ws.js'
import { useChatStore } from '../stores/chat.js'
import { useAgentStore } from '../stores/agents.js'
import { useAuthStore } from '../stores/auth.js'
import { showNotification } from '../lib/notifications.js'
import type { ServerMessage } from '@agentim/shared'

export function useWebSocket() {
  const addMessage = useChatStore((s) => s.addMessage)
  const addStreamChunk = useChatStore((s) => s.addStreamChunk)
  const completeStream = useChatStore((s) => s.completeStream)
  const addTypingUser = useChatStore((s) => s.addTypingUser)
  const clearExpiredTyping = useChatStore((s) => s.clearExpiredTyping)
  const updateAgent = useAgentStore((s) => s.updateAgent)

  useEffect(() => {
    const unsub = wsClient.onMessage((msg: ServerMessage) => {
      switch (msg.type) {
        case 'server:new_message': {
          addMessage(msg.message)
          // Check for @mention of current user
          const user = useAuthStore.getState().user
          if (user && msg.message.senderId !== user.id) {
            const isMentioned =
              msg.message.mentions.includes(user.username) ||
              msg.message.mentions.includes(user.displayName)
            if (isMentioned) {
              const rooms = useChatStore.getState().rooms
              const room = rooms.find((r) => r.id === msg.message.roomId)
              const roomName = room?.name ?? msg.message.roomId
              showNotification(
                `@${msg.message.senderName}`,
                msg.message.content.slice(0, 120),
                () => {
                  useChatStore.getState().setCurrentRoom(msg.message.roomId)
                  window.location.hash = ''
                  window.history.pushState(null, '', `/room/${msg.message.roomId}`)
                },
              )
            }
          }
          break
        }
        case 'server:message_chunk':
          addStreamChunk(msg.roomId, msg.agentId, msg.agentName, msg.messageId, msg.chunk)
          break
        case 'server:message_complete':
          completeStream(msg.message)
          break
        case 'server:typing':
          addTypingUser(msg.roomId, msg.userId, msg.username)
          break
        case 'server:agent_status':
          updateAgent(msg.agent)
          break
      }
    })

    return unsub
  }, [addMessage, addStreamChunk, completeStream, addTypingUser, updateAgent])

  // Periodically clear expired typing indicators
  useEffect(() => {
    const timer = setInterval(clearExpiredTyping, 2000)
    return () => clearInterval(timer)
  }, [clearExpiredTyping])
}
