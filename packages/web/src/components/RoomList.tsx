import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import { useChatStore } from '../stores/chat.js'

export function RoomList() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { rooms, currentRoomId, loadRooms, setCurrentRoom, createRoom } = useChatStore()
  const [showNewRoomDialog, setShowNewRoomDialog] = useState(false)
  const [newRoomName, setNewRoomName] = useState('')
  const [roomType, setRoomType] = useState<'private' | 'group'>('group')
  const [broadcastMode, setBroadcastMode] = useState(false)
  const [isCreating, setIsCreating] = useState(false)

  useEffect(() => {
    loadRooms()
  }, [loadRooms])

  const handleRoomClick = (roomId: string) => {
    setCurrentRoom(roomId)
    navigate(`/chat/${roomId}`)
  }

  const handleCreateRoom = async () => {
    if (!newRoomName.trim() || isCreating) return

    setIsCreating(true)
    try {
      const room = await createRoom(newRoomName.trim(), roomType, broadcastMode)
      setShowNewRoomDialog(false)
      setNewRoomName('')
      setRoomType('group')
      setBroadcastMode(false)
      handleRoomClick(room.id)
    } catch (error) {
      console.error('创建房间失败:', error)
    } finally {
      setIsCreating(false)
    }
  }

  return (
    <div className="p-4">
      {/* 新建房间按钮 */}
      <button
        onClick={() => setShowNewRoomDialog(true)}
        className="w-full mb-4 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors flex items-center justify-center space-x-2"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
        <span>{t('chat.newRoom')}</span>
      </button>

      {/* 房间列表 */}
      <div className="space-y-1">
        <h3 className="px-2 text-xs font-semibold text-gray-500 uppercase tracking-wider">
          {t('chat.rooms')}
        </h3>
        {rooms.length === 0 ? (
          <p className="px-2 py-4 text-sm text-gray-500">{t('common.noResults')}</p>
        ) : (
          rooms.map((room) => (
            <button
              key={room.id}
              onClick={() => handleRoomClick(room.id)}
              className={`
                w-full px-3 py-2 text-left rounded-md transition-colors
                ${
                  room.id === currentRoomId
                    ? 'bg-blue-50 text-blue-600 font-medium'
                    : 'text-gray-700 hover:bg-gray-100'
                }
              `}
            >
              <div className="flex items-center space-x-2">
                <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d={room.type === 'private' ? 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z' : 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z'}
                  />
                </svg>
                <span className="truncate">{room.name}</span>
              </div>
            </button>
          ))
        )}
      </div>

      {/* 新建房间对话框 */}
      {showNewRoomDialog && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
            <h2 className="text-xl font-semibold mb-4">{t('chat.newRoom')}</h2>

            <div className="space-y-4">
              {/* 房间名称 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t('chat.roomName')}
                </label>
                <input
                  type="text"
                  value={newRoomName}
                  onChange={(e) => setNewRoomName(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder={t('chat.roomName')}
                  autoFocus
                />
              </div>

              {/* 房间类型 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  {t('chat.roomType')}
                </label>
                <div className="flex space-x-4">
                  <label className="flex items-center">
                    <input
                      type="radio"
                      value="private"
                      checked={roomType === 'private'}
                      onChange={(e) => setRoomType(e.target.value as 'private')}
                      className="mr-2"
                    />
                    <span className="text-sm">{t('chat.privateRoom')}</span>
                  </label>
                  <label className="flex items-center">
                    <input
                      type="radio"
                      value="group"
                      checked={roomType === 'group'}
                      onChange={(e) => setRoomType(e.target.value as 'group')}
                      className="mr-2"
                    />
                    <span className="text-sm">{t('chat.groupRoom')}</span>
                  </label>
                </div>
              </div>

              {/* 广播模式 */}
              <div>
                <label className="flex items-start">
                  <input
                    type="checkbox"
                    checked={broadcastMode}
                    onChange={(e) => setBroadcastMode(e.target.checked)}
                    className="mt-1 mr-2"
                  />
                  <div>
                    <span className="text-sm font-medium text-gray-700">{t('chat.broadcastMode')}</span>
                    <p className="text-xs text-gray-500 mt-1">{t('chat.broadcastModeDesc')}</p>
                  </div>
                </label>
              </div>
            </div>

            {/* 按钮 */}
            <div className="mt-6 flex justify-end space-x-3">
              <button
                onClick={() => {
                  setShowNewRoomDialog(false)
                  setNewRoomName('')
                  setRoomType('group')
                  setBroadcastMode(false)
                }}
                disabled={isCreating}
                className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-md transition-colors disabled:opacity-50"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={handleCreateRoom}
                disabled={!newRoomName.trim() || isCreating}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isCreating ? t('common.loading') : t('common.create')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
