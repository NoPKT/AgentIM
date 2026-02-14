import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import { useChatStore } from '../stores/chat.js'

function timeAgo(dateStr: string, locale: string): string {
  const now = Date.now()
  const then = new Date(dateStr).getTime()
  const diff = now - then
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return locale.startsWith('zh') ? '刚刚' : locale.startsWith('ja') ? 'たった今' : locale.startsWith('ko') ? '방금' : 'now'
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  return `${days}d`
}

export function RoomList() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const { rooms, currentRoomId, loadRooms, setCurrentRoom, createRoom, lastMessages } = useChatStore()
  const [showNewRoomDialog, setShowNewRoomDialog] = useState(false)
  const [newRoomName, setNewRoomName] = useState('')
  const [isCreating, setIsCreating] = useState(false)

  useEffect(() => {
    loadRooms()
  }, [loadRooms])

  const handleRoomClick = (roomId: string) => {
    setCurrentRoom(roomId)
    navigate(`/room/${roomId}`)
  }

  const handleCreateRoom = async () => {
    if (!newRoomName.trim() || isCreating) return

    setIsCreating(true)
    try {
      const room = await createRoom(newRoomName.trim(), false)
      setShowNewRoomDialog(false)
      setNewRoomName('')
      handleRoomClick(room.id)
    } catch (error) {
      console.error('Failed to create room:', error)
    } finally {
      setIsCreating(false)
    }
  }

  return (
    <div className="p-4">
      {/* New Room Button */}
      <button
        onClick={() => setShowNewRoomDialog(true)}
        className="w-full mb-4 px-4 py-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors flex items-center justify-center space-x-2 shadow-sm"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
        <span>{t('newRoom')}</span>
      </button>

      {/* Room List */}
      <div className="space-y-1">
        <h3 className="px-2 text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
          {t('rooms')}
        </h3>
        {rooms.length === 0 ? (
          <p className="px-2 py-4 text-sm text-gray-500">{t('noResults')}</p>
        ) : (
          [...rooms]
            .sort((a, b) => {
              const la = lastMessages.get(a.id)
              const lb = lastMessages.get(b.id)
              if (la && lb) return lb.createdAt.localeCompare(la.createdAt)
              if (lb) return 1
              if (la) return -1
              return b.updatedAt.localeCompare(a.updatedAt)
            })
            .map((room) => {
              const lastMsg = lastMessages.get(room.id)
              return (
                <button
                  key={room.id}
                  onClick={() => handleRoomClick(room.id)}
                  className={`
                    w-full px-3 py-2.5 text-left rounded-lg transition-all relative
                    ${
                      room.id === currentRoomId
                        ? 'bg-blue-50 text-blue-700 font-medium'
                        : 'text-gray-700 hover:bg-gray-50'
                    }
                  `}
                >
                  {/* Active indicator */}
                  {room.id === currentRoomId && (
                    <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-blue-600 rounded-r-full" />
                  )}
                  <div className="flex items-center space-x-2.5">
                    <svg className="w-4.5 h-4.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
                      />
                    </svg>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className="truncate text-sm">{room.name}</span>
                        <div className="flex items-center space-x-1 flex-shrink-0 ml-2">
                          {room.broadcastMode && (
                            <span className="px-1.5 py-0.5 text-[10px] font-medium bg-amber-100 text-amber-700 rounded">
                              BC
                            </span>
                          )}
                          {lastMsg && (
                            <span className="text-[10px] text-gray-400">
                              {timeAgo(lastMsg.createdAt, i18n.language)}
                            </span>
                          )}
                        </div>
                      </div>
                      {lastMsg && (
                        <p className="text-xs text-gray-400 truncate mt-0.5">
                          <span className="text-gray-500">{lastMsg.senderName}: </span>
                          {lastMsg.content.slice(0, 50)}
                        </p>
                      )}
                    </div>
                  </div>
                </button>
              )
            })
        )}
      </div>

      {/* New Room Dialog */}
      {showNewRoomDialog && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6">
            <h2 className="text-xl font-semibold mb-4">{t('newRoom')}</h2>

            <div className="space-y-4">
              {/* Room Name */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t('roomName')}
                </label>
                <input
                  type="text"
                  value={newRoomName}
                  onChange={(e) => setNewRoomName(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder={t('enterRoomName')}
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCreateRoom()
                  }}
                />
              </div>

            </div>

            {/* Buttons */}
            <div className="mt-6 flex justify-end space-x-3">
              <button
                onClick={() => {
                  setShowNewRoomDialog(false)
                  setNewRoomName('')
                }}
                disabled={isCreating}
                className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50"
              >
                {t('cancel')}
              </button>
              <button
                onClick={handleCreateRoom}
                disabled={!newRoomName.trim() || isCreating}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isCreating ? t('loading') : t('create')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
