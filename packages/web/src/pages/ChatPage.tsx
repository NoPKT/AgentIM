import { useEffect, useState, useMemo, useCallback, useRef } from 'react'
import { useParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/shallow'
import type { ServerMessage } from '@agentim/shared'
import { useChatStore, selectTypingNames } from '../stores/chat.js'
import { useAuthStore } from '../stores/auth.js'
import { useAgentStore } from '../stores/agents.js'
import { wsClient } from '../lib/ws.js'
import { MessageList } from '../components/MessageList.js'
import { MessageInput } from '../components/MessageInput.js'
import { RoomSettingsDrawer } from '../components/RoomSettingsDrawer.js'
import { SearchDialog } from '../components/SearchDialog.js'
import { TerminalViewer } from '../components/TerminalViewer.js'
import { PermissionCard, type PermissionRequestData } from '../components/PermissionCard.js'
import { CachedDataBanner } from '../components/CachedDataBanner.js'
import { useConnectionStatus } from '../hooks/useConnectionStatus.js'
import { ImageLightbox } from '../components/ImageLightbox.js'
import { useLightbox } from '../hooks/useLightbox.js'
import { ErrorBoundary } from '../components/ErrorBoundary.js'
import { MemberListPanel } from '../components/MemberListPanel.js'
import { AddAgentDialog } from '../components/AddAgentDialog.js'
import { toast } from '../stores/toast.js'
import {
  TerminalIcon,
  SearchIcon,
  SettingsIcon,
  ChatBubbleIcon,
  UsersIcon,
} from '../components/icons.js'

export default function ChatPage() {
  const { t } = useTranslation()
  const { roomId: routeRoomId } = useParams()
  const currentRoomId = useChatStore((state) => state.currentRoomId)
  const setCurrentRoom = useChatStore((state) => state.setCurrentRoom)
  const rooms = useChatStore((state) => state.rooms)
  const roomMembers = useChatStore((state) => state.roomMembers)
  const loadRoomMembers = useChatStore((state) => state.loadRoomMembers)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [membersOpen, setMembersOpen] = useState(false)
  const [addAgentOpen, setAddAgentOpen] = useState(false)
  const [terminalAgentId, setTerminalAgentId] = useState<string | null>(null)
  const [permissionRequests, setPermissionRequests] = useState<Map<string, PermissionRequestData>>(
    () => new Map(),
  )
  const loadAgents = useAgentStore((s) => s.loadAgents)
  const removeRoomMember = useChatStore((s) => s.removeRoomMember)
  const lightbox = useLightbox(currentRoomId)
  const terminalBuffers = useChatStore((s) => s.terminalBuffers)
  const showingCachedMessages = useChatStore((s) => s.showingCachedMessages)
  const flushPendingMessages = useChatStore((s) => s.flushPendingMessages)
  const currentUser = useAuthStore((s) => s.user)

  const typingNames = useChatStore(
    useShallow((s) => selectTypingNames(s, currentRoomId, currentUser?.id)),
  )
  const connectionStatus = useConnectionStatus()

  const currentRoom = rooms.find((r) => r.id === currentRoomId)
  const members = currentRoomId ? (roomMembers.get(currentRoomId) ?? []) : []
  const agentMembers = useMemo(() => members.filter((m) => m.memberType === 'agent'), [members])

  // Routing indicator for broadcast mode
  const [showRouting, setShowRouting] = useState(false)
  const routingTimerRef = useRef<ReturnType<typeof setTimeout>>(null)
  const streaming = useChatStore((s) => s.streaming)

  // Get the terminal agent name from buffer
  const terminalAgent = terminalAgentId ? terminalBuffers.get(terminalAgentId) : null

  // Keyboard shortcut: Cmd+K to open search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setSearchOpen((prev) => !prev)
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])

  // Ensure agents are loaded for @ mention popup (may not have visited AgentsPage)
  useEffect(() => {
    loadAgents()
  }, [loadAgents])

  // Sync route param -> store
  useEffect(() => {
    if (routeRoomId && routeRoomId !== currentRoomId) {
      setCurrentRoom(routeRoomId)
    }
  }, [routeRoomId, currentRoomId, setCurrentRoom])

  // Load members on room change; stale-check prevents updating state for a
  // room that is no longer current after a rapid room switch.
  useEffect(() => {
    if (!currentRoomId) return
    let stale = false
    loadRoomMembers(currentRoomId).catch(() => {
      if (!stale) console.warn('Failed to load room members')
    })
    return () => {
      stale = true
    }
  }, [currentRoomId, loadRoomMembers])

  // Hide routing indicator once any streaming response starts for the current room
  useEffect(() => {
    if (!showRouting || !currentRoomId) return
    const hasStreamForRoom = Array.from(streaming.keys()).some((k) =>
      k.startsWith(`${currentRoomId}:`),
    )
    if (hasStreamForRoom) {
      setShowRouting(false)
      if (routingTimerRef.current) {
        clearTimeout(routingTimerRef.current)
        routingTimerRef.current = null
      }
    }
  }, [streaming, showRouting, currentRoomId])

  // Clean up routing timer on unmount or room change
  useEffect(() => {
    return () => {
      if (routingTimerRef.current) {
        clearTimeout(routingTimerRef.current)
        routingTimerRef.current = null
      }
      setShowRouting(false)
    }
  }, [currentRoomId])

  // Flush offline pending messages on reconnect
  useEffect(() => {
    const unsub = wsClient.onReconnect(() => {
      flushPendingMessages()
    })
    return unsub
  }, [flushPendingMessages])

  // Show routing indicator when the current user sends a message in broadcast mode
  useEffect(() => {
    const unsub = wsClient.onMessage((msg: ServerMessage) => {
      if (
        msg.type === 'server:new_message' &&
        msg.message.roomId === useChatStore.getState().currentRoomId &&
        msg.message.senderId === useAuthStore.getState().user?.id
      ) {
        const room = useChatStore.getState().rooms.find((r) => r.id === msg.message.roomId)
        if (room?.broadcastMode) {
          if (routingTimerRef.current) clearTimeout(routingTimerRef.current)
          routingTimerRef.current = setTimeout(() => {
            // Only show if no streaming has started for this room
            const st = useChatStore.getState().streaming
            const hasStream = Array.from(st.keys()).some((k) =>
              k.startsWith(`${msg.message.roomId}:`),
            )
            if (!hasStream) setShowRouting(true)
            routingTimerRef.current = null
          }, 2000)
        }
      }
    })
    return unsub
  }, [])

  // Handle permission request WS messages
  useEffect(() => {
    const unsub = wsClient.onMessage((msg: ServerMessage) => {
      if (msg.type === 'server:permission_request') {
        setPermissionRequests((prev) => {
          const next = new Map(prev)
          next.set(msg.requestId, {
            requestId: msg.requestId,
            agentId: msg.agentId,
            agentName: msg.agentName,
            roomId: msg.roomId,
            toolName: msg.toolName,
            toolInput: msg.toolInput,
            expiresAt: msg.expiresAt,
          })
          return next
        })
      } else if (msg.type === 'server:permission_request_expired') {
        setPermissionRequests((prev) => {
          const existing = prev.get(msg.requestId)
          if (!existing || existing.resolved) return prev
          const next = new Map(prev)
          next.set(msg.requestId, { ...existing, resolved: 'timedOut' })
          return next
        })
      }
    })
    return unsub
  }, [])

  // Handle user decision on a permission request
  const handlePermissionResolved = useCallback(
    (requestId: string, decision: 'allowed' | 'denied') => {
      setPermissionRequests((prev) => {
        const existing = prev.get(requestId)
        if (!existing) return prev
        const next = new Map(prev)
        next.set(requestId, { ...existing, resolved: decision })
        return next
      })
    },
    [],
  )

  // Filter permission requests for the current room
  const activePermissionRequests = useMemo(() => {
    if (!currentRoomId) return []
    return Array.from(permissionRequests.values()).filter((r) => r.roomId === currentRoomId)
  }, [currentRoomId, permissionRequests])

  const existingMemberIds = useMemo(() => new Set(members.map((m) => m.memberId)), [members])

  const handleRemoveMember = useCallback(
    async (memberId: string) => {
      if (!currentRoomId) return
      try {
        await removeRoomMember(currentRoomId, memberId)
        toast.success(t('chat.agentRemoved'))
      } catch {
        toast.error(t('common.error'))
      }
    },
    [currentRoomId, removeRoomMember, t],
  )

  if (!currentRoomId) {
    return (
      <div className="flex-1 flex items-center justify-center bg-surface-secondary">
        <div className="text-center">
          <ChatBubbleIcon className="mx-auto h-12 w-12 text-text-muted" />
          <h3 className="mt-4 text-lg font-medium text-text-primary">
            {t('chat.selectRoomToChat')}
          </h3>
          <p className="mt-2 text-sm text-text-secondary">{t('chat.chooseRoomFromSidebar')}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col bg-surface">
      {/* Room Header */}
      <div className="border-b border-border px-4 sm:px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <h2 className="text-base sm:text-lg font-semibold text-text-primary truncate">
            {currentRoom?.name || 'Chat'}
          </h2>
          {currentRoom?.broadcastMode && (
            <span className="hidden sm:inline px-2 py-0.5 text-xs font-medium bg-warning-subtle text-warning-text rounded-md flex-shrink-0">
              {t('chat.broadcastMode')}
            </span>
          )}
          <span className="hidden sm:inline text-xs text-text-muted flex-shrink-0">
            {t('chat.memberCount', { count: members.length })}
          </span>
          {connectionStatus !== 'connected' && (
            <span
              className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium rounded-full flex-shrink-0 ${
                connectionStatus === 'reconnecting'
                  ? 'bg-warning-subtle text-warning-text'
                  : 'bg-danger-subtle text-danger-text'
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  connectionStatus === 'reconnecting'
                    ? 'bg-warning-text animate-pulse'
                    : 'bg-danger-text'
                }`}
              />
              {connectionStatus === 'reconnecting'
                ? t('chat.reconnecting')
                : t('chat.disconnected')}
              {connectionStatus === 'disconnected' && (
                <button
                  type="button"
                  onClick={() => wsClient.reconnect()}
                  className="ml-1 underline hover:no-underline"
                >
                  {t('chat.reconnect')}
                </button>
              )}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {agentMembers.length > 0 && (
            <div className="relative">
              <button
                onClick={() => {
                  if (terminalAgentId) {
                    setTerminalAgentId(null)
                  } else if (agentMembers.length === 1) {
                    setTerminalAgentId(agentMembers[0].memberId)
                  } else {
                    // Toggle first agent with terminal data, or first agent
                    const withData = agentMembers.find((m) => terminalBuffers.has(m.memberId))
                    setTerminalAgentId(withData?.memberId ?? agentMembers[0].memberId)
                  }
                }}
                className={`p-2 rounded-lg transition-colors flex-shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                  terminalAgentId
                    ? 'bg-surface-hover text-text-primary'
                    : 'hover:bg-surface-hover text-text-muted hover:text-text-secondary'
                }`}
                title={t('common.terminal')}
              >
                <TerminalIcon className="w-5 h-5" />
              </button>
            </div>
          )}
          <button
            onClick={() => setSearchOpen(true)}
            className="p-2 rounded-lg hover:bg-surface-hover transition-colors text-text-muted hover:text-text-secondary flex-shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            title={`${t('common.search')} (${t('chat.searchShortcutHint', { modifier: navigator.platform.includes('Mac') ? '⌘' : 'Ctrl' })})`}
          >
            <SearchIcon className="w-5 h-5" />
          </button>
          <button
            onClick={() => setMembersOpen((prev) => !prev)}
            className={`p-2 rounded-lg transition-colors flex-shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
              membersOpen
                ? 'bg-surface-hover text-text-primary'
                : 'hover:bg-surface-hover text-text-muted hover:text-text-secondary'
            }`}
            title={t('chat.members')}
          >
            <UsersIcon className="w-5 h-5" />
          </button>
          <button
            onClick={() => setSettingsOpen(true)}
            className="p-2 rounded-lg hover:bg-surface-hover transition-colors text-text-muted hover:text-text-secondary flex-shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            title={t('chat.roomSettings')}
          >
            <SettingsIcon className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Content area: chat + optional member panel */}
      <div className="flex flex-1 overflow-hidden">
        {/* Chat content */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          {/* Cached data banner */}
          {showingCachedMessages && <CachedDataBanner type="messages" />}

          {/* Messages */}
          <MessageList onImageClick={lightbox.openLightbox} />

          {/* Permission request cards */}
          {activePermissionRequests.length > 0 && (
            <div className="border-t border-border">
              {activePermissionRequests.map((req) => (
                <PermissionCard
                  key={req.requestId}
                  request={req}
                  onResolved={handlePermissionResolved}
                />
              ))}
            </div>
          )}

          {/* Routing indicator (broadcast mode) */}
          {showRouting && (
            <div
              className="px-6 py-1.5 text-xs text-info-text bg-info-subtle flex items-center gap-1.5"
              role="status"
              aria-live="polite"
            >
              <div className="flex space-x-0.5">
                <span
                  className="w-1.5 h-1.5 bg-info-text rounded-full animate-bounce"
                  style={{ animationDelay: '0ms' }}
                />
                <span
                  className="w-1.5 h-1.5 bg-info-text rounded-full animate-bounce"
                  style={{ animationDelay: '150ms' }}
                />
                <span
                  className="w-1.5 h-1.5 bg-info-text rounded-full animate-bounce"
                  style={{ animationDelay: '300ms' }}
                />
              </div>
              <span>{t('chat.routingToAgents')}</span>
            </div>
          )}

          {/* Typing indicator */}
          {typingNames.length > 0 && (
            <div
              className="px-6 py-1.5 text-xs text-text-muted flex items-center gap-1.5"
              role="status"
              aria-live="polite"
            >
              <div className="flex space-x-0.5">
                <span
                  className="w-1.5 h-1.5 bg-text-muted rounded-full animate-bounce"
                  style={{ animationDelay: '0ms' }}
                />
                <span
                  className="w-1.5 h-1.5 bg-text-muted rounded-full animate-bounce"
                  style={{ animationDelay: '150ms' }}
                />
                <span
                  className="w-1.5 h-1.5 bg-text-muted rounded-full animate-bounce"
                  style={{ animationDelay: '300ms' }}
                />
              </div>
              <span>
                {typingNames.length === 1
                  ? t('chat.typing', { name: typingNames[0] })
                  : t('chat.typingMultiple', { names: typingNames.join(', ') })}
              </span>
            </div>
          )}

          {/* Terminal Viewer */}
          {terminalAgentId && (
            <ErrorBoundary
              fallback={(_err, retry) => (
                <div className="border-t border-border bg-surface-secondary px-4 py-3 flex items-center justify-between">
                  <p className="text-sm text-text-secondary">{t('chat.terminalUnavailable')}</p>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={retry}
                      className="text-xs text-accent hover:text-accent-hover font-medium"
                    >
                      {t('common.retry')}
                    </button>
                    <button
                      onClick={() => setTerminalAgentId(null)}
                      className="text-xs text-text-muted hover:text-text-primary"
                    >
                      {t('common.close')}
                    </button>
                  </div>
                </div>
              )}
            >
              <TerminalViewer
                agentId={terminalAgentId}
                agentName={terminalAgent?.agentName ?? terminalAgentId}
                onClose={() => setTerminalAgentId(null)}
              />
            </ErrorBoundary>
          )}

          {/* Input */}
          <MessageInput />
        </div>

        {/* Member list side panel */}
        {membersOpen && (
          <MemberListPanel
            roomId={currentRoomId}
            members={members}
            onClose={() => setMembersOpen(false)}
            onAddAgent={() => setAddAgentOpen(true)}
            onRemoveMember={handleRemoveMember}
          />
        )}
      </div>

      {/* Room Settings Drawer */}
      <RoomSettingsDrawer
        roomId={currentRoomId}
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />

      {/* Search Dialog */}
      <SearchDialog isOpen={searchOpen} onClose={() => setSearchOpen(false)} />

      {/* Add Agent Dialog */}
      <AddAgentDialog
        roomId={currentRoomId}
        existingMemberIds={existingMemberIds}
        isOpen={addAgentOpen}
        onClose={() => setAddAgentOpen(false)}
        onAdded={() => loadRoomMembers(currentRoomId)}
      />

      {/* Image Lightbox */}
      {lightbox.isOpen && (
        <ImageLightbox
          images={lightbox.images}
          currentIndex={lightbox.currentIndex}
          onClose={lightbox.closeLightbox}
          onNavigate={lightbox.navigateTo}
        />
      )}
    </div>
  )
}
