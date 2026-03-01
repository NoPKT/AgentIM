import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import i18next from 'i18next'
import { wsClient } from '../lib/ws.js'
import { useChatStore } from '../stores/chat.js'
import { useAgentStore } from '../stores/agents.js'
import { useAuthStore } from '../stores/auth.js'
import { showNotification } from '../lib/notifications.js'
import { toast } from '../stores/toast.js'
import { useWorkspaceStore } from '../stores/workspace.js'
import { WS_ERROR_CODES } from '@agentim/shared'
import type { ServerMessage, WorkspaceStatus } from '@agentim/shared'

/** Track stream keys that have already shown a buffer-overflow toast. */
const truncationToasted = new Set<string>()

export function useWebSocket() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  // Stable ref so the WS subscription effect never needs navigate in its deps.
  // useNavigate() may return a new function reference on every location change
  // under BrowserRouter; if navigate were in the effect dep list, the subscription
  // would teardown/re-register on every route transition, creating a window where
  // incoming WS frames (messages, reactions, read receipts) are silently dropped.
  const navigateRef = useRef(navigate)
  useEffect(() => {
    navigateRef.current = navigate
  })

  // Single stable subscription — handler accesses stores via getState() and
  // navigate via navigateRef, so the closure has zero reactive deps.  Empty []
  // is intentional: the wsClient.handlers Set persists across reconnects, so
  // the subscription never goes stale and there is no message-loss window.
  useEffect(() => {
    const unsub = wsClient.onMessage((msg: ServerMessage) => {
      const chat = useChatStore.getState()
      const agentStore = useAgentStore.getState()

      // Each case has its own try-catch so that an error in one handler
      // doesn't interfere with processing of subsequent messages.
      switch (msg.type) {
        case 'server:new_message': {
          try {
            // Try to replace an optimistic message first (user's own message echo)
            const replaced = chat.replaceOptimisticMessage(msg.message)
            if (!replaced) chat.addMessage(msg.message)
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
          } catch (err) {
            console.error('[WS] Error handling message:', msg.type, err)
          }
          break
        }
        case 'server:message_chunk':
          try {
            // Intercept workspace_status chunks → store for panel
            if (msg.chunk.type === 'workspace_status') {
              try {
                const wsData = JSON.parse(msg.chunk.content) as WorkspaceStatus
                const workDir = (msg.chunk.metadata?.workingDirectory as string) || ''
                useWorkspaceStore.getState().setStatus(msg.agentId, wsData, workDir)
              } catch {
                // Ignore parse errors
              }
            }
            const { truncated } = chat.addStreamChunk(
              msg.roomId,
              msg.agentId,
              msg.agentName,
              msg.messageId,
              msg.chunk,
            )
            if (truncated) {
              const streamKey = `${msg.roomId}:${msg.agentId}`
              if (!truncationToasted.has(streamKey)) {
                truncationToasted.add(streamKey)
                toast.info(i18next.t('chat.streamBufferOverflow'))
              }
            }
          } catch (err) {
            console.error('[WS] Error handling message:', msg.type, err)
          }
          break
        case 'server:message_complete': {
          try {
            chat.completeStream(msg.message)
            // Clean up truncation toast tracking for this completed stream
            truncationToasted.delete(`${msg.message.roomId}:${msg.message.senderId}`)
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
          } catch (err) {
            console.error('[WS] Error handling message:', msg.type, err)
          }
          break
        }
        case 'server:typing':
          try {
            chat.addTypingUser(msg.roomId, msg.userId, msg.username)
          } catch (err) {
            console.error('[WS] Error handling message:', msg.type, err)
          }
          break
        case 'server:agent_status':
          try {
            agentStore.updateAgent(msg.agent)
          } catch (err) {
            console.error('[WS] Error handling message:', msg.type, err)
          }
          break
        case 'server:terminal_data':
          try {
            chat.addTerminalData(msg.agentId, msg.agentName, msg.data)
          } catch (err) {
            console.error('[WS] Error handling message:', msg.type, err)
          }
          break
        case 'server:task_update':
          try {
            window.dispatchEvent(new CustomEvent('agentim:task_update', { detail: msg.task }))
          } catch (err) {
            console.error('[WS] Error handling message:', msg.type, err)
          }
          break
        case 'server:message_edited':
          try {
            chat.updateMessage(msg.message)
          } catch (err) {
            console.error('[WS] Error handling message:', msg.type, err)
          }
          break
        case 'server:message_deleted':
          try {
            chat.removeMessage(msg.roomId, msg.messageId)
          } catch (err) {
            console.error('[WS] Error handling message:', msg.type, err)
          }
          break
        case 'server:room_update':
          try {
            chat.loadRooms()
            if (msg.room?.id) chat.loadRoomMembers(msg.room.id)
          } catch (err) {
            console.error('[WS] Error handling message:', msg.type, err)
          }
          break
        case 'server:room_removed': {
          try {
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
          } catch (err) {
            console.error('[WS] Error handling message:', msg.type, err)
          }
          break
        }
        case 'server:read_receipt':
          try {
            chat.updateReadReceipt(msg.roomId, msg.userId, msg.username, msg.lastReadAt)
          } catch (err) {
            console.error('[WS] Error handling message:', msg.type, err)
          }
          break
        case 'server:presence':
          try {
            chat.setUserOnline(msg.userId, msg.online)
          } catch (err) {
            console.error('[WS] Error handling message:', msg.type, err)
          }
          break
        case 'server:reaction_update':
          try {
            chat.updateReactions(msg.roomId, msg.messageId, msg.reactions)
          } catch (err) {
            console.error('[WS] Error handling message:', msg.type, err)
          }
          break
        case 'server:agent_command_result':
          try {
            if (msg.success) {
              if (msg.message) {
                toast.success(msg.message, 8000)
              } else {
                toast.success(i18next.t('slashCommand.commandSuccess', { command: msg.command }))
              }
            } else {
              toast.error(
                i18next.t('slashCommand.commandFailed', {
                  message: msg.message ?? msg.command,
                }),
              )
            }
          } catch (err) {
            console.error('[WS] Error handling message:', msg.type, err)
          }
          break
        case 'server:agent_info':
          try {
            agentStore.updateAgent(msg.agent)
          } catch (err) {
            console.error('[WS] Error handling message:', msg.type, err)
          }
          break
        case 'server:room_cleared':
          try {
            // Another device of this user cleared the room — sync local state
            const msgs = new Map(chat.messages)
            msgs.set(msg.roomId, [])
            useChatStore.setState({ messages: msgs })
            import('../lib/message-cache.js').then((mc) =>
              mc.clearRoomCache(msg.roomId).catch(() => {}),
            )
          } catch (err) {
            console.error('[WS] Error handling message:', msg.type, err)
          }
          break
        case 'server:spawn_result':
          try {
            if (msg.success) {
              toast.success(i18next.t('agent.spawnSuccess'))
              agentStore.loadAgents()
            } else {
              toast.error(msg.error ?? i18next.t('agent.spawnFailed'))
            }
          } catch (err) {
            console.error('[WS] Error handling message:', msg.type, err)
          }
          break
        case 'server:workspace_response':
          try {
            const ws = useWorkspaceStore.getState()
            const resp = msg.response as { kind: string; [key: string]: unknown }
            if (resp.kind === 'status') {
              ws.setStatus(msg.agentId, (resp.data as WorkspaceStatus | null) ?? null, '')
            } else if (resp.kind === 'tree') {
              ws.setTree(
                msg.agentId,
                resp.path as string,
                resp.entries as import('@agentim/shared').DirectoryEntry[],
              )
            } else if (resp.kind === 'file') {
              ws.setFileContent({
                agentId: msg.agentId,
                path: resp.path as string,
                content: resp.content as string,
                size: resp.size as number,
                truncated: resp.truncated as boolean,
              })
            } else if (resp.kind === 'error') {
              console.warn('[WS] Workspace error:', resp.message)
            }
            ws.setLoading(null)
          } catch (err) {
            console.error('[WS] Error handling message:', msg.type, err)
          }
          break
        case 'server:auth_result':
          try {
            if (!msg.ok) {
              console.warn('[WS] Auth failed:', msg.error)
              // Token rejected by server — force logout
              useAuthStore.getState().logout()
            }
          } catch (err) {
            console.error('[WS] Error handling message:', msg.type, err)
          }
          break
        case 'server:error':
          console.warn('[WS Server Error]', msg.code, msg.message)
          if (msg.code === WS_ERROR_CODES.PROTOCOL_VERSION_MISMATCH) {
            toast.error(t('error.wsProtocolMismatch'))
          }
          break
      }
    })

    return unsub
  }, [])

  // On reconnect, re-join all previously subscribed rooms and sync missed messages
  useEffect(() => {
    const unsub = wsClient.onReconnect(() => {
      const {
        currentRoomId,
        joinedRooms,
        syncMissedMessages,
        loadRoomMembers,
        loadRooms,
        clearStreamingState,
      } = useChatStore.getState()

      // Clear stale streaming state from the previous connection
      clearStreamingState()

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
    }, 1000)
    return () => clearInterval(timer)
  }, [])

  // Periodically clean up stale streaming messages (e.g. agent crashed mid-stream)
  useEffect(() => {
    const timer = setInterval(() => {
      useChatStore.getState().cleanupStaleStreams()
    }, 15_000)
    return () => clearInterval(timer)
  }, [])

  // Sync missed messages when the page becomes visible again (e.g. mobile tab switch)
  useEffect(() => {
    const handler = () => {
      if (document.visibilityState === 'visible') {
        const { currentRoomId, syncMissedMessages, loadRooms } = useChatStore.getState()
        if (currentRoomId) {
          syncMissedMessages(currentRoomId)
        }
        loadRooms()
      }
    }
    document.addEventListener('visibilitychange', handler)
    return () => document.removeEventListener('visibilitychange', handler)
  }, [])

  // Notify user when WebSocket send queue overflows
  useEffect(() => {
    const handler = () => {
      toast.error(t('error.wsQueueFull'))
    }
    window.addEventListener('ws:queue_full', handler)
    return () => window.removeEventListener('ws:queue_full', handler)
  }, [t])
}
