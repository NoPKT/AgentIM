import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router'
import { wsClient } from '../lib/ws.js'
import { useChatStore } from '../stores/chat.js'
import { useAgentStore } from '../stores/agents.js'
import { useAuthStore } from '../stores/auth.js'
import { showNotification } from '../lib/notifications.js'
import type { ServerMessage } from '@agentim/shared'

export function useWebSocket() {
  const navigate = useNavigate()
  // Stable ref so the WS subscription effect never needs navigate in its deps.
  // useNavigate() may return a new function reference on every location change
  // under BrowserRouter; if navigate were in the effect dep list, the subscription
  // would teardown/re-register on every route transition, creating a window where
  // incoming WS frames (messages, reactions, read receipts) are silently dropped.
  const navigateRef = useRef(navigate)
  useEffect(() => { navigateRef.current = navigate })

  const addMessage = useChatStore((s) => s.addMessage)
  const addStreamChunk = useChatStore((s) => s.addStreamChunk)
  const completeStream = useChatStore((s) => s.completeStream)
  const addTypingUser = useChatStore((s) => s.addTypingUser)
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
      try {
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
        case 'server:room_removed': {
          // We've been evicted from a room (member removed by admin/owner).
          // Clean up all local state for the evicted room — this also removes it
          // from the rooms list and clears currentRoomId if we're viewing it.
          const wasCurrentRoom = useChatStore.getState().currentRoomId === msg.roomId
          useChatStore.getState().evictRoom(msg.roomId)
          // Re-fetch rooms to stay in sync with server (handles concurrent evictions).
          loadRooms()
          // Use React Router navigate so the router updates its internal state.
          // window.history.pushState alone would leave React Router still matching
          // /room/:id, causing ChatPage's route-sync effect to re-set currentRoomId.
          if (wasCurrentRoom) {
            navigateRef.current('/')
          }
          break
        }
        case 'server:read_receipt':
          updateReadReceipt(msg.roomId, msg.userId, msg.username, msg.lastReadAt)
          break
        case 'server:presence':
          setUserOnline(msg.userId, msg.online)
          break
        case 'server:reaction_update':
          updateReactions(msg.roomId, msg.messageId, msg.reactions)
          break
        case 'server:auth_result':
          if (!msg.ok) {
            console.warn('[WS] Auth failed:', msg.error)
            // Token rejected by server — force logout
            useAuthStore.getState().logout()
          }
          break
        case 'server:error':
          console.warn('[WS Server Error]', msg.code, msg.message)
          break
      }
      } catch (err) {
        console.error('[WS] Error handling message:', msg.type, err)
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
      const { currentRoomId, syncMissedMessages, loadRoomMembers } = useChatStore.getState()
      if (currentRoomId) {
        wsClient.send({ type: 'client:join_room', roomId: currentRoomId })
        // Incrementally sync messages missed during disconnect
        syncMissedMessages(currentRoomId)
        // Refresh room members (may have changed during disconnect)
        loadRoomMembers(currentRoomId)
      }
      // Reload rooms/unread counts to catch any updates during disconnect
      loadRooms()
    })
    return unsub
  }, [loadRooms])

  // Clear streaming state on disconnect (streams are interrupted)
  useEffect(() => {
    const unsub = wsClient.onStatusChange((status) => {
      if (status === 'disconnected') {
        useChatStore.getState().clearStreamingState()
      }
    })
    return unsub
  }, [])

  // Periodically clear expired typing indicators
  useEffect(() => {
    const timer = setInterval(() => {
      useChatStore.getState().clearExpiredTyping()
    }, 2000)
    return () => clearInterval(timer)
  }, [])
}
