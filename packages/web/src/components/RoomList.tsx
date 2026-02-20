import { useEffect, useState, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import { useChatStore } from '../stores/chat.js'
import { toast } from '../stores/toast.js'
import { api } from '../lib/api.js'
import { PlusIcon, GroupIcon, StarIcon, ChatBubbleIcon } from './icons.js'
import { Button, Input, Modal } from './ui.js'

function timeAgo(dateStr: string, t: (key: string) => string): string {
  const now = Date.now()
  const then = new Date(dateStr).getTime()
  const diff = now - then
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return t('common.justNow')
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  return `${days}d`
}

export function RoomList({ onRoomSelect }: { onRoomSelect?: () => void }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const {
    rooms,
    currentRoomId,
    loadRooms,
    setCurrentRoom,
    createRoom,
    lastMessages,
    unreadCounts,
  } = useChatStore()
  const [showNewRoomDialog, setShowNewRoomDialog] = useState(false)
  const [newRoomName, setNewRoomName] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const [showArchived, setShowArchived] = useState(false)

  useEffect(() => {
    loadRooms()
  }, [loadRooms])

  // Cmd/Ctrl+N shortcut to create new room
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
      e.preventDefault()
      setShowNewRoomDialog(true)
    }
  }, [])

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  const handleRoomClick = (roomId: string) => {
    setCurrentRoom(roomId)
    navigate(`/room/${roomId}`)
    onRoomSelect?.()
  }

  const handleCreateRoom = async () => {
    if (!newRoomName.trim() || isCreating) return

    setIsCreating(true)
    try {
      const room = await createRoom(newRoomName.trim(), 'group', false)
      setShowNewRoomDialog(false)
      setNewRoomName('')
      handleRoomClick(room.id)
    } catch {
      toast.error(t('common.error'))
    } finally {
      setIsCreating(false)
    }
  }

  const sortedRooms = useMemo(
    () =>
      [...rooms]
        .filter((r) => (showArchived ? !!r.archivedAt : !r.archivedAt))
        .sort((a, b) => {
          if (a.pinnedAt && !b.pinnedAt) return -1
          if (!a.pinnedAt && b.pinnedAt) return 1
          const la = lastMessages.get(a.id)
          const lb = lastMessages.get(b.id)
          if (la && lb) return lb.createdAt.localeCompare(la.createdAt)
          if (lb) return 1
          if (la) return -1
          return b.updatedAt.localeCompare(a.updatedAt)
        }),
    [rooms, showArchived, lastMessages],
  )

  return (
    <div className="p-4">
      {/* New Room Button */}
      <button
        onClick={() => setShowNewRoomDialog(true)}
        className="w-full mb-4 px-4 py-2.5 bg-accent text-white rounded-xl hover:bg-accent-hover transition-colors flex items-center justify-center space-x-2 shadow-sm"
      >
        <PlusIcon className="w-5 h-5" />
        <span>{t('chat.newRoom')}</span>
      </button>

      {/* Room List */}
      <nav className="space-y-1" aria-label={t('chat.rooms')}>
        <div className="flex items-center justify-between px-2 mb-2">
          <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wider">
            {showArchived ? t('chat.archivedRooms') : t('chat.rooms')}
          </h3>
          <div className="flex items-center gap-1">
            {!showArchived && unreadCounts.size > 0 && (
              <button
                onClick={async () => {
                  try {
                    const res = await api.post('/messages/mark-all-read')
                    if (res.ok) {
                      useChatStore.setState({ unreadCounts: new Map() })
                    }
                  } catch {
                    toast.error(t('common.error'))
                  }
                }}
                className="text-[10px] px-1.5 py-0.5 rounded text-text-muted hover:text-info-text transition-colors"
                title={t('chat.markAllRead')}
              >
                {t('chat.markAllRead')}
              </button>
            )}
            <button
              onClick={() => setShowArchived(!showArchived)}
              className={`text-[10px] px-1.5 py-0.5 rounded transition-colors ${
                showArchived
                  ? 'bg-info-muted text-info-text'
                  : 'text-text-muted hover:text-text-secondary'
              }`}
            >
              {showArchived ? t('chat.rooms') : t('chat.archivedRooms')}
            </button>
          </div>
        </div>
        {rooms.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-4 py-10 text-center">
            <ChatBubbleIcon className="w-10 h-10 text-text-muted mb-3" />
            <p className="text-sm font-medium text-text-secondary mb-1">
              {t('common.noResults')}
            </p>
            <p className="text-xs text-text-muted">
              {t('common.createFirstRoom')}
            </p>
          </div>
        ) : (
          sortedRooms.map((room) => {
            const lastMsg = lastMessages.get(room.id)
            const unread = unreadCounts.get(room.id) || 0
            return (
              <button
                key={room.id}
                onClick={() => handleRoomClick(room.id)}
                aria-current={room.id === currentRoomId ? 'page' : undefined}
                className={`
                    w-full px-3 py-2.5 text-left rounded-lg transition-all relative
                    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent
                    ${
                      room.id === currentRoomId
                        ? 'bg-info-subtle text-info-text font-medium'
                        : 'text-text-primary hover:bg-surface-hover'
                    }
                  `}
              >
                {/* Active indicator */}
                {room.id === currentRoomId && (
                  <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-accent rounded-r-full" />
                )}
                <div className="flex items-center space-x-2.5">
                  <GroupIcon className="w-4.5 h-4.5 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className="truncate text-sm flex items-center gap-1">
                        {room.pinnedAt && (
                          <StarIcon className="w-3 h-3 text-amber-500 flex-shrink-0" />
                        )}
                        {room.name}
                      </span>
                      <div className="flex items-center space-x-1 flex-shrink-0 ml-2">
                        {room.broadcastMode && (
                          <span className="px-1.5 py-0.5 text-[10px] font-medium bg-warning-subtle text-warning-text rounded">
                            BC
                          </span>
                        )}
                        {lastMsg && (
                          <span className="text-[10px] text-text-muted">
                            {timeAgo(lastMsg.createdAt, t)}
                          </span>
                        )}
                        {unread > 0 && room.id !== currentRoomId && (
                          <span className="min-w-[18px] h-[18px] px-1 flex items-center justify-center text-[10px] font-bold text-white bg-accent rounded-full">
                            {unread > 99 ? '99+' : unread}
                          </span>
                        )}
                      </div>
                    </div>
                    {lastMsg && (
                      <p className="text-xs text-text-muted truncate mt-0.5">
                        <span className="text-text-secondary">
                          {lastMsg.senderName}:{' '}
                        </span>
                        {lastMsg.content.slice(0, 50)}
                      </p>
                    )}
                  </div>
                </div>
              </button>
            )
          })
        )}
      </nav>

      {/* New Room Dialog */}
      <Modal
        isOpen={showNewRoomDialog}
        onClose={() => { setShowNewRoomDialog(false); setNewRoomName('') }}
        aria-labelledby="new-room-title"
      >
        <div className="bg-surface rounded-xl shadow-xl max-w-md w-full p-6">
            <h2 id="new-room-title" className="text-xl font-semibold mb-4 text-text-primary">
              {t('chat.newRoom')}
            </h2>

            <div className="space-y-4">
              {/* Room Name */}
              <div>
                <label className="block text-sm font-medium text-text-primary mb-1">
                  {t('chat.roomName')}
                </label>
                <Input
                  type="text"
                  value={newRoomName}
                  onChange={(e) => setNewRoomName(e.target.value)}
                  placeholder={t('chat.enterRoomName')}
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCreateRoom()
                  }}
                />
              </div>
            </div>

            {/* Buttons */}
            <div className="mt-6 flex justify-end space-x-3">
              <Button
                variant="secondary"
                onClick={() => {
                  setShowNewRoomDialog(false)
                  setNewRoomName('')
                }}
                disabled={isCreating}
              >
                {t('common.cancel')}
              </Button>
              <Button
                onClick={handleCreateRoom}
                disabled={!newRoomName.trim() || isCreating}
              >
                {isCreating ? t('common.loading') : t('common.create')}
              </Button>
            </div>
          </div>
      </Modal>
    </div>
  )
}
