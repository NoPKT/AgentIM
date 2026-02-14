import { useEffect, useState } from 'react'
import { useParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { useChatStore } from '../stores/chat.js'
import { MessageList } from '../components/MessageList.js'
import { MessageInput } from '../components/MessageInput.js'
import { RoomSettingsDrawer } from '../components/RoomSettingsDrawer.js'
import { SearchDialog } from '../components/SearchDialog.js'
import { useConnectionStatus } from '../hooks/useConnectionStatus.js'

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
  const connectionStatus = useConnectionStatus()

  const currentRoom = rooms.find((r) => r.id === currentRoomId)
  const members = currentRoomId ? roomMembers.get(currentRoomId) ?? [] : []

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

  if (!currentRoomId) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <svg
            className="mx-auto h-12 w-12 text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
            />
          </svg>
          <h3 className="mt-4 text-lg font-medium text-gray-900">
            {t('selectRoomToChat') || 'Select a room to start chatting'}
          </h3>
          <p className="mt-2 text-sm text-gray-600">
            {t('chooseRoomFromSidebar') || 'Choose a room from the sidebar or create a new one'}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col bg-white">
      {/* Room Header */}
      <div className="border-b border-gray-200 px-4 sm:px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <h2 className="text-base sm:text-lg font-semibold text-gray-900 truncate">
            {currentRoom?.name || 'Chat'}
          </h2>
          {currentRoom?.broadcastMode && (
            <span className="hidden sm:inline px-2 py-0.5 text-xs font-medium bg-amber-100 text-amber-700 rounded-md flex-shrink-0">
              {t('broadcastMode')}
            </span>
          )}
          <span className="hidden sm:inline text-xs text-gray-400 flex-shrink-0">
            {t('memberCount', { count: members.length })}
          </span>
          {connectionStatus !== 'connected' && (
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium rounded-full flex-shrink-0 ${
              connectionStatus === 'reconnecting'
                ? 'bg-yellow-100 text-yellow-700'
                : 'bg-red-100 text-red-700'
            }`}>
              <span className={`w-1.5 h-1.5 rounded-full ${
                connectionStatus === 'reconnecting' ? 'bg-yellow-500 animate-pulse' : 'bg-red-500'
              }`} />
              {connectionStatus === 'reconnecting' ? t('reconnecting') : t('disconnected')}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
        <button
          onClick={() => setSearchOpen(true)}
          className="p-2 rounded-lg hover:bg-gray-100 transition-colors text-gray-500 hover:text-gray-700 flex-shrink-0"
          title={`${t('search')} (${navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'}+K)`}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </button>
        <button
          onClick={() => setSettingsOpen(true)}
          className="p-2 rounded-lg hover:bg-gray-100 transition-colors text-gray-500 hover:text-gray-700 flex-shrink-0"
          title={t('roomSettings')}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
            />
          </svg>
        </button>
        </div>
      </div>

      {/* Messages */}
      <MessageList />

      {/* Input */}
      <MessageInput />

      {/* Room Settings Drawer */}
      <RoomSettingsDrawer
        roomId={currentRoomId}
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />

      {/* Search Dialog */}
      <SearchDialog
        isOpen={searchOpen}
        onClose={() => setSearchOpen(false)}
      />
    </div>
  )
}
