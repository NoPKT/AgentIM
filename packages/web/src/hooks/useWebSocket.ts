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

  // Single stable subscription — access store actions via getState() to avoid
  // depending on 13+ selector references that would cause frequent re-subscriptions.
  useEffect(() => {
    const unsub = wsClient.onMessage((msg: ServerMessage) => {
      try {
      const chat = useChatStore.getState()
      const agentStore = useAgentStore.getState()

      switch (msg.type) {
        case 'server:new_message': {
          chat.addMessage(msg.message)
          // Desktop notifications for messages from other users
          const user = useAuthStore.getState().user
          if (user && msg.message.senderId !== user.id) {
            const currentRoomId = chat.currentRoomId
            const rooms = chat.rooms
            const room = rooms.find((r) => r.id === msg.message.roomId)
            const roomName = room?.name ?? msg.message.roomId
            const navigateToRoom = () => {
              useChatStore.getState().setCurrentRoom(msg.message.roomId)
              navigateRef.current(`/room/${msg.message.roomId}`)
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
          chat.addStreamChunk(msg.roomId, msg.agentId, msg.agentName, msg.messageId, msg.chunk)
          break
        case 'server:message_complete': {
          chat.completeStream(msg.message)
          // Notify for completed agent messages in non-current rooms
          const currentRoomId = chat.currentRoomId
          if (msg.message.roomId !== currentRoomId) {
            const rooms = chat.rooms
            const room = rooms.find((r) => r.id === msg.message.roomId)
            const roomName = room?.name ?? msg.message.roomId
            showNotification(
              `${msg.message.senderName} · ${roomName}`,
              msg.message.content.slice(0, 120),
              () => {
                useChatStore.getState().setCurrentRoom(msg.message.roomId)
                navigateRef.current(`/room/${msg.message.roomId}`)
              },
            )
          }
          break
        }
        case 'server:typing':
          chat.addTypingUser(msg.roomId, msg.userId, msg.username)
          break
        case 'server:agent_status':
          agentStore.updateAgent(msg.agent)
          break
        case 'server:terminal_data':
          chat.addTerminalData(msg.agentId, msg.agentName, msg.data)
          break
        case 'server:task_update':
          window.dispatchEvent(new CustomEvent('agentim:task_update', { detail: msg.task }))
          break
        case 'server:message_edited':
          chat.updateMessage(msg.message)
          break
        case 'server:message_deleted':
          chat.removeMessage(msg.roomId, msg.messageId)
          break
        case 'server:room_update':
          chat.loadRooms()
          if (msg.room?.id) chat.loadRoomMembers(msg.room.id)
          break
        case 'server:room_removed': {
          // We've been evicted from a room (member removed by admin/owner).
          // Clean up all local state for the evicted room — this also removes it
          // from the rooms list and clears currentRoomId if we're viewing it.
          const wasCurrentRoom = chat.currentRoomId === msg.roomId
          chat.evictRoom(msg.roomId)
          // Re-fetch rooms to stay in sync with server (handles concurrent evictions).
          chat.loadRooms()
          // Use React Router navigate so the router updates its internal state.
          if (wasCurrentRoom) {
            navigateRef.current('/')
          }
          break
        }
        case 'server:read_receipt':
          chat.updateReadReceipt(msg.roomId, msg.userId, msg.username, msg.lastReadAt)
          break
        case 'server:presence':
          chat.setUserOnline(msg.userId, msg.online)
          break
        case 'server:reaction_update':
          chat.updateReactions(msg.roomId, msg.messageId, msg.reactions)
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
  }, [])

  // On reconnect, re-join all previously subscribed rooms and sync missed messages
  useEffect(() => {
    const unsub = wsClient.onReconnect(() => {
      const { currentRoomId, joinedRooms, syncMissedMessages, loadRoomMembers, loadRooms } = useChatStore.getState()

      // Server-side subscriptions are reset on reconnect, so re-join
      // ALL rooms that were subscribed (not just the current one) to
      // keep receiving real-time updates and notifications.
      for (const roomId of joinedRooms) {
        wsClient.send({ type: 'client:join_room', roomId })
      }

      if (currentRoomId) {
        // Incrementally sync messages missed during disconnect
        syncMissedMessages(currentRoomId)
        // Refresh room members (may have changed during disconnect)
        loadRoomMembers(currentRoomId)
      }
      // Reload rooms/unread counts to catch any updates during disconnect
      loadRooms()
    })
    return unsub
  }, [])

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

  // Periodically clean up stale streaming messages (e.g. agent crashed mid-stream)
  useEffect(() => {
    const timer = setInterval(() => {
      useChatStore.getState().cleanupStaleStreams()
    }, 30_000)
    return () => clearInterval(timer)
  }, [])
}
