import { useEffect, useState, useMemo, useCallback } from 'react'
import { useParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/shallow'
import type { ServerMessage } from '@agentim/shared'
import { useChatStore, selectTypingNames } from '../stores/chat.js'
import { useAuthStore } from '../stores/auth.js'
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
import { TerminalIcon, SearchIcon, SettingsIcon, ChatBubbleIcon } from '../components/icons.js'

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
  const [terminalAgentId, setTerminalAgentId] = useState<string | null>(null)
  const [permissionRequests, setPermissionRequests] = useState<Map<string, PermissionRequestData>>(
    () => new Map(),
  )
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

  // Sync route param -> store
  useEffect(() => {
    if (routeRoomId && routeRoomId !== currentRoomId) {
      setCurrentRoom(routeRoomId)
    }
  }, [routeRoomId, currentRoomId, setCurrentRoom])

  // Load members on room change
  useEffect(() => {
    if (currentRoomId) {
      loadRoomMembers(currentRoomId)
    }
  }, [currentRoomId, loadRoomMembers])

  // Flush offline pending messages on reconnect
  useEffect(() => {
    const unsub = wsClient.onReconnect(() => {
      flushPendingMessages()
    })
    return unsub
  }, [flushPendingMessages])

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
            title={`${t('common.search')} (${navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'}+K)`}
          >
            <SearchIcon className="w-5 h-5" />
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
        <TerminalViewer
          agentId={terminalAgentId}
          agentName={terminalAgent?.agentName ?? terminalAgentId}
          onClose={() => setTerminalAgentId(null)}
        />
      )}

      {/* Input */}
      <MessageInput />

      {/* Room Settings Drawer */}
      <RoomSettingsDrawer
        roomId={currentRoomId}
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />

      {/* Search Dialog */}
      <SearchDialog isOpen={searchOpen} onClose={() => setSearchOpen(false)} />

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
