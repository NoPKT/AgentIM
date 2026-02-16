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
  const addTerminalData = useChatStore((s) => s.addTerminalData)
  const updateMessage = useChatStore((s) => s.updateMessage)
  const removeMessage = useChatStore((s) => s.removeMessage)
  const updateAgent = useAgentStore((s) => s.updateAgent)
  const loadRooms = useChatStore((s) => s.loadRooms)
  const loadRoomMembers = useChatStore((s) => s.loadRoomMembers)
  const setUserOnline = useChatStore((s) => s.setUserOnline)
  const updateReadReceipt = useChatStore((s) => s.updateReadReceipt)
  const updateReactions = useChatStore((s) => s.updateReactions)

  useEffect(() => {
    const unsub = wsClient.onMessage((msg: ServerMessage) => {
      switch (msg.type) {
        case 'server:new_message': {
          addMessage(msg.message)
          // Desktop notifications for messages from other users
          const user = useAuthStore.getState().user
          if (user && msg.message.senderId !== user.id) {
            const currentRoomId = useChatStore.getState().currentRoomId
            const rooms = useChatStore.getState().rooms
            const room = rooms.find((r) => r.id === msg.message.roomId)
            const roomName = room?.name ?? msg.message.roomId
            const navigateToRoom = () => {
              useChatStore.getState().setCurrentRoom(msg.message.roomId)
              window.location.hash = ''
              window.history.pushState(null, '', `/room/${msg.message.roomId}`)
            }

            const isMentioned =
              msg.message.mentions.includes(user.username) ||
              msg.message.mentions.includes(user.displayName)

            if (isMentioned) {
              // @mention notification — always show (high priority)
              showNotification(
                `@${msg.message.senderName} · ${roomName}`,
                msg.message.content.slice(0, 120),
                navigateToRoom,
                'agentim-mention',
              )
            } else if (msg.message.roomId !== currentRoomId) {
              // General notification — only for non-current rooms
              showNotification(
                `${msg.message.senderName} · ${roomName}`,
                msg.message.content.slice(0, 120),
                navigateToRoom,
              )
            }
          }
          break
        }
        case 'server:message_chunk':
          addStreamChunk(msg.roomId, msg.agentId, msg.agentName, msg.messageId, msg.chunk)
          break
        case 'server:message_complete': {
          completeStream(msg.message)
          // Notify for completed agent messages in non-current rooms
          const currentRoomId = useChatStore.getState().currentRoomId
          if (msg.message.roomId !== currentRoomId) {
            const rooms = useChatStore.getState().rooms
            const room = rooms.find((r) => r.id === msg.message.roomId)
            const roomName = room?.name ?? msg.message.roomId
            showNotification(
              `${msg.message.senderName} · ${roomName}`,
              msg.message.content.slice(0, 120),
              () => {
                useChatStore.getState().setCurrentRoom(msg.message.roomId)
                window.location.hash = ''
                window.history.pushState(null, '', `/room/${msg.message.roomId}`)
              },
            )
          }
          break
        }
        case 'server:typing':
          addTypingUser(msg.roomId, msg.userId, msg.username)
          break
        case 'server:agent_status':
          updateAgent(msg.agent)
          break
        case 'server:terminal_data':
          addTerminalData(msg.agentId, msg.agentName, msg.data)
          break
        case 'server:task_update':
          window.dispatchEvent(new CustomEvent('agentim:task_update', { detail: msg.task }))
          break
        case 'server:message_edited':
          updateMessage(msg.message)
          break
        case 'server:message_deleted':
          removeMessage(msg.roomId, msg.messageId)
          break
        case 'server:room_update':
          loadRooms()
          if (msg.room?.id) loadRoomMembers(msg.room.id)
          break
        case 'server:read_receipt':
          updateReadReceipt(msg.roomId, msg.userId, msg.username, msg.lastReadAt)
          break
        case 'server:presence':
          setUserOnline(msg.userId, msg.online)
          break
        case 'server:reaction_update':
          updateReactions(msg.roomId, msg.messageId, msg.reactions)
          break
      }
    })

    return unsub
  }, [
    addMessage,
    addStreamChunk,
    completeStream,
    addTypingUser,
    addTerminalData,
    updateMessage,
    removeMessage,
    updateAgent,
    loadRooms,
    loadRoomMembers,
    setUserOnline,
    updateReadReceipt,
    updateReactions,
  ])

  // On reconnect, re-join current room and sync missed messages
  useEffect(() => {
    const unsub = wsClient.onReconnect(() => {
      const { currentRoomId, syncMissedMessages } = useChatStore.getState()
      if (currentRoomId) {
        wsClient.send({ type: 'client:join_room', roomId: currentRoomId })
        // Incrementally sync messages missed during disconnect
        syncMissedMessages(currentRoomId)
      }
      // Reload rooms/unread counts to catch any updates during disconnect
      loadRooms()
    })
    return unsub
  }, [loadRooms])

  // Periodically clear expired typing indicators
  useEffect(() => {
    const timer = setInterval(clearExpiredTyping, 2000)
    return () => clearInterval(timer)
  }, [clearExpiredTyping])
}
