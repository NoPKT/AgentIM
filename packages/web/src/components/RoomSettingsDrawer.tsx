import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import { useChatStore } from '../stores/chat.js'
import { useAuthStore } from '../stores/auth.js'
import { useAgentStore } from '../stores/agents.js'
import { getStatusConfig, getTypeConfig } from '../lib/agentConfig.js'
import { AddAgentDialog } from './AddAgentDialog.js'
import { toast } from '../stores/toast.js'

interface RoomSettingsDrawerProps {
  roomId: string
  isOpen: boolean
  onClose: () => void
}

export function RoomSettingsDrawer({ roomId, isOpen, onClose }: RoomSettingsDrawerProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const rooms = useChatStore((s) => s.rooms)
  const roomMembers = useChatStore((s) => s.roomMembers)
  const loadRoomMembers = useChatStore((s) => s.loadRoomMembers)
  const updateRoom = useChatStore((s) => s.updateRoom)
  const updateNotificationPref = useChatStore((s) => s.updateNotificationPref)
  const togglePin = useChatStore((s) => s.togglePin)
  const toggleArchive = useChatStore((s) => s.toggleArchive)
  const deleteRoom = useChatStore((s) => s.deleteRoom)
  const removeRoomMember = useChatStore((s) => s.removeRoomMember)
  const agents = useAgentStore((s) => s.agents)
  const onlineUsers = useChatStore((s) => s.onlineUsers)

  const currentUser = useAuthStore((s) => s.user)
  const room = rooms.find((r) => r.id === roomId)
  const members = roomMembers.get(roomId) ?? []
  const myMember = members.find((m) => m.memberId === currentUser?.id)
  const currentNotifPref = myMember?.notificationPref ?? 'all'

  const [editingName, setEditingName] = useState(false)
  const [nameValue, setNameValue] = useState('')
  const [editingPrompt, setEditingPrompt] = useState(false)
  const [promptValue, setPromptValue] = useState('')
  const [showAddAgent, setShowAddAgent] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [updating, setUpdating] = useState(false)
  const [pinLoading, setPinLoading] = useState(false)
  const [archiveLoading, setArchiveLoading] = useState(false)

  const statusConfig = getStatusConfig(t)
  const typeConfig = getTypeConfig(t)

  useEffect(() => {
    if (isOpen && roomId) {
      loadRoomMembers(roomId)
    }
  }, [isOpen, roomId, loadRoomMembers])

  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  useEffect(() => {
    if (room) {
      setNameValue(room.name)
      setPromptValue(room.systemPrompt ?? '')
    }
  }, [room])

  const existingMemberIds = useMemo(
    () => new Set(members.filter((m) => m.memberType === 'agent').map((m) => m.memberId)),
    [members],
  )

  const agentMap = useMemo(
    () => new Map(agents.map((a) => [a.id, a])),
    [agents],
  )

  const handleSaveName = async () => {
    if (!nameValue.trim() || nameValue === room?.name) {
      setEditingName(false)
      return
    }
    setUpdating(true)
    try {
      await updateRoom(roomId, { name: nameValue.trim() })
      toast.success(t('roomUpdated'))
    } catch {
      toast.error(t('error'))
    } finally {
      setUpdating(false)
      setEditingName(false)
    }
  }

  const handleToggleBroadcast = async () => {
    if (!room) return
    setUpdating(true)
    try {
      await updateRoom(roomId, { broadcastMode: !room.broadcastMode })
      toast.success(t('roomUpdated'))
    } catch {
      toast.error(t('error'))
    } finally {
      setUpdating(false)
    }
  }

  const handleSavePrompt = async () => {
    const newValue = promptValue.trim()
    const currentValue = room?.systemPrompt ?? ''
    if (newValue === currentValue) {
      setEditingPrompt(false)
      return
    }
    setUpdating(true)
    try {
      await updateRoom(roomId, { systemPrompt: newValue || null })
      toast.success(t('roomUpdated'))
    } catch {
      toast.error(t('error'))
    } finally {
      setUpdating(false)
      setEditingPrompt(false)
    }
  }

  const handleRemoveMember = async (memberId: string) => {
    try {
      await removeRoomMember(roomId, memberId)
      toast.success(t('agentRemoved'))
    } catch {
      toast.error(t('error'))
    }
  }

  const handleDeleteRoom = async () => {
    try {
      await deleteRoom(roomId)
      toast.success(t('roomDeleted'))
      onClose()
      navigate('/')
    } catch {
      toast.error(t('error'))
    }
  }

  const roleLabel = (role: string) => {
    switch (role) {
      case 'owner': return t('roleOwner')
      case 'admin': return t('roleAdmin')
      default: return t('roleMember')
    }
  }

  return (
    <>
      {/* Backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/20 backdrop-blur-sm z-40"
          onClick={onClose}
        />
      )}

      {/* Drawer */}
      <div
        role="dialog"
        aria-modal={isOpen}
        aria-label={t('roomSettingsTitle')}
        className={`
          fixed top-0 right-0 h-full w-full sm:w-80 bg-white dark:bg-gray-800 shadow-xl z-50
          transform transition-transform duration-300 ease-in-out
          ${isOpen ? 'translate-x-0' : 'translate-x-full'}
        `}
      >
        <div className="flex flex-col h-full">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{t('roomSettingsTitle')}</h2>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              aria-label={t('close')}
            >
              <svg className="w-5 h-5 text-gray-500 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto">
            {/* Room Name */}
            <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700">
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
                {t('roomName')}
              </label>
              {editingName ? (
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={nameValue}
                    onChange={(e) => setNameValue(e.target.value)}
                    className="flex-1 px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSaveName()
                      if (e.key === 'Escape') setEditingName(false)
                    }}
                  />
                  <button
                    onClick={handleSaveName}
                    disabled={updating}
                    className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
                  >
                    {t('save')}
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setEditingName(true)}
                  className="w-full text-left px-3 py-1.5 text-sm text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-700/50 rounded-lg transition-colors flex items-center justify-between group"
                >
                  <span>{room?.name}</span>
                  <svg className="w-4 h-4 text-gray-400 dark:text-gray-500 opacity-0 group-hover:opacity-100 transition-opacity" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                  </svg>
                </button>
              )}
            </div>

            {/* Broadcast Mode Toggle */}
            <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{t('broadcastMode')}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{t('broadcastModeDesc')}</p>
                </div>
                <button
                  role="switch"
                  aria-checked={!!room?.broadcastMode}
                  aria-label={t('broadcastMode')}
                  onClick={handleToggleBroadcast}
                  disabled={updating}
                  className={`
                    relative inline-flex h-6 w-11 items-center rounded-full transition-colors
                    ${room?.broadcastMode ? 'bg-blue-600' : 'bg-gray-200 dark:bg-gray-600'}
                    disabled:opacity-50
                  `}
                >
                  <span
                    className={`
                      inline-block h-4 w-4 rounded-full bg-white shadow-sm transform transition-transform
                      ${room?.broadcastMode ? 'translate-x-6' : 'translate-x-1'}
                    `}
                  />
                </button>
              </div>
            </div>

            {/* System Prompt */}
            <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700">
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
                {t('systemPrompt')}
              </label>
              {editingPrompt ? (
                <div className="space-y-2">
                  <textarea
                    value={promptValue}
                    onChange={(e) => setPromptValue(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                    rows={4}
                    maxLength={10000}
                    autoFocus
                    placeholder={t('systemPromptPlaceholder') || ''}
                  />
                  <div className="flex gap-2 justify-end">
                    <button
                      onClick={() => {
                        setPromptValue(room?.systemPrompt ?? '')
                        setEditingPrompt(false)
                      }}
                      className="px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600"
                    >
                      {t('cancel')}
                    </button>
                    <button
                      onClick={handleSavePrompt}
                      disabled={updating}
                      className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
                    >
                      {t('save')}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setEditingPrompt(true)}
                  className="w-full text-left px-3 py-1.5 text-sm hover:bg-gray-50 dark:hover:bg-gray-700/50 rounded-lg transition-colors flex items-center justify-between group"
                >
                  <span className={room?.systemPrompt ? 'text-gray-900 dark:text-gray-100' : 'text-gray-400 dark:text-gray-500 italic'}>
                    {room?.systemPrompt
                      ? (room.systemPrompt.length > 80
                          ? room.systemPrompt.slice(0, 80) + '...'
                          : room.systemPrompt)
                      : t('noSystemPrompt')}
                  </span>
                  <svg className="w-4 h-4 text-gray-400 dark:text-gray-500 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                  </svg>
                </button>
              )}
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{t('systemPromptDesc')}</p>
            </div>

            {/* Notification Preference */}
            <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700">
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
                {t('settings.notificationPref')}
              </label>
              <div className="flex gap-1">
                {(['all', 'mentions', 'none'] as const).map((pref) => (
                  <button
                    key={pref}
                    onClick={async () => {
                      if (pref === currentNotifPref) return
                      try {
                        await updateNotificationPref(roomId, pref)
                        toast.success(t('settings.notifPrefUpdated'))
                      } catch {
                        toast.error(t('error'))
                      }
                    }}
                    className={`flex-1 px-2 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                      currentNotifPref === pref
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600'
                    }`}
                  >
                    {pref === 'all' ? t('settings.notifAll') : pref === 'mentions' ? t('settings.notifMentions') : t('settings.notifNone')}
                  </button>
                ))}
              </div>
            </div>

            {/* Members */}
            <div className="px-5 py-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  {t('members')} ({members.length})
                </h3>
                <button
                  onClick={() => setShowAddAgent(true)}
                  className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  {t('addAgent')}
                </button>
              </div>

              <div className="space-y-1">
                {members.map((member) => {
                  const agent = member.memberType === 'agent' ? agentMap.get(member.memberId) : null
                  const status = agent
                    ? statusConfig[agent.status as keyof typeof statusConfig] || statusConfig.offline
                    : null
                  const type = agent ? typeConfig[agent.type] || typeConfig.generic : null
                  const displayName = agent ? agent.name : member.memberId

                  return (
                    <div
                      key={member.memberId}
                      className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors group"
                    >
                      {/* Avatar */}
                      <div className="relative flex-shrink-0">
                        <div className={`
                          w-8 h-8 rounded-full flex items-center justify-center
                          ${member.memberType === 'agent'
                            ? 'bg-gradient-to-br from-blue-500 to-indigo-600'
                            : 'bg-gradient-to-br from-gray-400 to-gray-500'
                          }
                        `}>
                          <span className="text-xs font-medium text-white">
                            {displayName.charAt(0).toUpperCase()}
                          </span>
                        </div>
                        {member.memberType === 'user' && onlineUsers.has(member.memberId) && (
                          <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-green-500 border-2 border-white dark:border-gray-800 rounded-full" />
                        )}
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{displayName}</span>
                          {status && (
                            <span className={`w-1.5 h-1.5 rounded-full ${status.color} flex-shrink-0`} />
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          {type && (
                            <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium ${type.color}`}>
                              {type.label}
                            </span>
                          )}
                          <span className="text-[10px] text-gray-400 dark:text-gray-500">
                            {roleLabel(member.role)}
                          </span>
                        </div>
                      </div>

                      {/* Remove Button (not for owner) */}
                      {member.role !== 'owner' && (
                        <button
                          onClick={() => handleRemoveMember(member.memberId)}
                          className="p-1 rounded-md text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 opacity-0 group-hover:opacity-100 transition-all flex-shrink-0"
                          title={t('removeMember')}
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          </div>

          {/* Footer: Pin / Archive / Delete */}
          <div className="px-5 py-4 border-t border-gray-100 dark:border-gray-700 space-y-2">
            <div className="flex gap-2">
              <button
                onClick={async () => {
                  if (pinLoading) return
                  setPinLoading(true)
                  try {
                    await togglePin(roomId)
                  } catch {
                    toast.error(t('error'))
                  } finally {
                    setPinLoading(false)
                  }
                }}
                disabled={pinLoading}
                className={`flex-1 px-3 py-2 text-sm font-medium rounded-lg transition-colors disabled:opacity-50 ${
                  myMember?.pinnedAt
                    ? 'text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 hover:bg-amber-100 dark:hover:bg-amber-900/40'
                    : 'text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600'
                }`}
              >
                {myMember?.pinnedAt ? t('unpinRoom') : t('pinRoom')}
              </button>
              <button
                onClick={async () => {
                  if (archiveLoading) return
                  setArchiveLoading(true)
                  try {
                    await toggleArchive(roomId)
                  } catch {
                    toast.error(t('error'))
                  } finally {
                    setArchiveLoading(false)
                  }
                }}
                disabled={archiveLoading}
                className={`flex-1 px-3 py-2 text-sm font-medium rounded-lg transition-colors disabled:opacity-50 ${
                  myMember?.archivedAt
                    ? 'text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-900/20 hover:bg-blue-100 dark:hover:bg-blue-900/40'
                    : 'text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600'
                }`}
              >
                {myMember?.archivedAt ? t('unarchiveRoom') : t('archiveRoom')}
              </button>
            </div>
            {showDeleteConfirm ? (
              <div className="space-y-3">
                <p className="text-sm text-gray-600 dark:text-gray-400">{t('confirmDeleteRoom')}</p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setShowDeleteConfirm(false)}
                    className="flex-1 px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                  >
                    {t('cancel')}
                  </button>
                  <button
                    onClick={handleDeleteRoom}
                    className="flex-1 px-3 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors"
                  >
                    {t('delete')}
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="w-full px-4 py-2 text-sm font-medium text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors"
              >
                {t('deleteRoom')}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Add Agent Dialog */}
      <AddAgentDialog
        roomId={roomId}
        existingMemberIds={existingMemberIds}
        isOpen={showAddAgent}
        onClose={() => setShowAddAgent(false)}
        onAdded={() => loadRoomMembers(roomId)}
      />
    </>
  )
}
