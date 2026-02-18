import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import { useChatStore } from '../stores/chat.js'
import { useAuthStore } from '../stores/auth.js'
import { useAgentStore } from '../stores/agents.js'
import { useRouterStore } from '../stores/routers.js'
import { getStatusConfig, getTypeConfig } from '../lib/agentConfig.js'
import { AddAgentDialog } from './AddAgentDialog.js'
import { toast } from '../stores/toast.js'
import { Button, Input, Textarea, Select } from './ui.js'
import { CloseIcon, PencilIcon, PlusIcon } from './icons.js'

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
  const routers = useRouterStore((s) => s.routers)
  const loadRouters = useRouterStore((s) => s.loadRouters)

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
      loadRouters()
    }
  }, [isOpen, roomId, loadRoomMembers, loadRouters])

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

  const agentMap = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents])

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
      case 'owner':
        return t('roleOwner')
      case 'admin':
        return t('roleAdmin')
      default:
        return t('roleMember')
    }
  }

  return (
    <>
      {/* Backdrop */}
      {isOpen && (
        <div className="fixed inset-0 bg-black/20 backdrop-blur-sm z-overlay" onClick={onClose} />
      )}

      {/* Drawer */}
      <div
        role="dialog"
        aria-modal={isOpen}
        aria-label={t('roomSettingsTitle')}
        className={`
          fixed top-0 right-0 h-full w-full sm:w-80 bg-surface shadow-xl z-modal
          transform transition-transform duration-300 ease-in-out
          ${isOpen ? 'translate-x-0' : 'translate-x-full'}
        `}
      >
        <div className="flex flex-col h-full">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <h2 className="text-lg font-semibold text-text-primary">
              {t('roomSettingsTitle')}
            </h2>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-surface-hover transition-colors"
              aria-label={t('close')}
            >
              <CloseIcon className="w-5 h-5 text-text-secondary" aria-hidden="true" />
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto scrollbar-thin">
            {/* Room Name */}
            <div className="px-5 py-4 border-b border-border">
              <label className="block text-xs font-medium text-text-secondary uppercase tracking-wider mb-2">
                {t('roomName')}
              </label>
              {editingName ? (
                <div className="flex gap-2">
                  <Input
                    inputSize="sm"
                    type="text"
                    value={nameValue}
                    onChange={(e) => setNameValue(e.target.value)}
                    className="flex-1"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSaveName()
                      if (e.key === 'Escape') setEditingName(false)
                    }}
                  />
                  <Button size="sm" onClick={handleSaveName} disabled={updating}>
                    {t('save')}
                  </Button>
                </div>
              ) : (
                <button
                  onClick={() => setEditingName(true)}
                  className="w-full text-left px-3 py-1.5 text-sm text-text-primary hover:bg-surface-hover rounded-lg transition-colors flex items-center justify-between group"
                >
                  <span>{room?.name}</span>
                  <PencilIcon
                    className="w-4 h-4 text-text-muted opacity-0 group-hover:opacity-100 transition-opacity"
                    aria-hidden="true"
                  />
                </button>
              )}
            </div>

            {/* Broadcast Mode Toggle */}
            <div className="px-5 py-4 border-b border-border">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-text-primary">
                    {t('broadcastMode')}
                  </p>
                  <p className="text-xs text-text-secondary mt-0.5">
                    {t('broadcastModeDesc')}
                  </p>
                </div>
                <button
                  role="switch"
                  aria-checked={!!room?.broadcastMode}
                  aria-label={t('broadcastMode')}
                  onClick={handleToggleBroadcast}
                  disabled={updating}
                  className={`
                    relative inline-flex h-6 w-11 items-center rounded-full transition-colors
                    ${room?.broadcastMode ? 'bg-accent' : 'bg-gray-200 dark:bg-gray-600'}
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
            <div className="px-5 py-4 border-b border-border">
              <label className="block text-xs font-medium text-text-secondary uppercase tracking-wider mb-2">
                {t('systemPrompt')}
              </label>
              {editingPrompt ? (
                <div className="space-y-2">
                  <Textarea
                    inputSize="sm"
                    value={promptValue}
                    onChange={(e) => setPromptValue(e.target.value)}
                    rows={4}
                    maxLength={10000}
                    autoFocus
                    placeholder={t('systemPromptPlaceholder') || ''}
                  />
                  <div className="flex gap-2 justify-end">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        setPromptValue(room?.systemPrompt ?? '')
                        setEditingPrompt(false)
                      }}
                    >
                      {t('cancel')}
                    </Button>
                    <Button size="sm" onClick={handleSavePrompt} disabled={updating}>
                      {t('save')}
                    </Button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setEditingPrompt(true)}
                  className="w-full text-left px-3 py-1.5 text-sm hover:bg-surface-hover rounded-lg transition-colors flex items-center justify-between group"
                >
                  <span
                    className={
                      room?.systemPrompt ? 'text-text-primary' : 'text-text-muted italic'
                    }
                  >
                    {room?.systemPrompt
                      ? room.systemPrompt.length > 80
                        ? room.systemPrompt.slice(0, 80) + '...'
                        : room.systemPrompt
                      : t('noSystemPrompt')}
                  </span>
                  <PencilIcon
                    className="w-4 h-4 text-text-muted opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 ml-2"
                    aria-hidden="true"
                  />
                </button>
              )}
              <p className="text-xs text-text-secondary mt-1">
                {t('systemPromptDesc')}
              </p>
            </div>

            {/* Router Selector */}
            <div className="px-5 py-4 border-b border-border">
              <label className="block text-xs font-medium text-text-secondary uppercase tracking-wider mb-2">
                {t('router.roomRouter')}
              </label>
              <Select
                value={
                  room?.routerId && !routers.some((r) => r.id === room.routerId)
                    ? '__unknown__'
                    : (room?.routerId ?? '')
                }
                onChange={async (e) => {
                  if (e.target.value === '__unknown__') return
                  const routerId = e.target.value || null
                  setUpdating(true)
                  try {
                    await updateRoom(roomId, { routerId })
                    toast.success(t('roomUpdated'))
                  } catch {
                    toast.error(t('error'))
                  } finally {
                    setUpdating(false)
                  }
                }}
                disabled={updating}
              >
                <option value="">{t('router.noRouter')}</option>
                {room?.routerId && !routers.some((r) => r.id === room.routerId) && (
                  <option value="__unknown__" disabled>
                    ({t('router.noRouterSelected')})
                  </option>
                )}
                {routers.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} ({r.llmModel})
                  </option>
                ))}
              </Select>
              <p className="text-xs text-text-secondary mt-1">
                {t('router.routerDesc')}
              </p>
            </div>

            {/* Notification Preference */}
            <div className="px-5 py-4 border-b border-border">
              <label className="block text-xs font-medium text-text-secondary uppercase tracking-wider mb-2">
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
                        ? 'bg-accent text-white'
                        : 'bg-surface-hover text-text-secondary hover:bg-gray-200 dark:hover:bg-gray-600'
                    }`}
                  >
                    {pref === 'all'
                      ? t('settings.notifAll')
                      : pref === 'mentions'
                        ? t('settings.notifMentions')
                        : t('settings.notifNone')}
                  </button>
                ))}
              </div>
            </div>

            {/* Members */}
            <div className="px-5 py-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-medium text-text-secondary uppercase tracking-wider">
                  {t('members')} ({members.length})
                </h3>
                <button
                  onClick={() => setShowAddAgent(true)}
                  className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-accent bg-blue-50 dark:bg-blue-900/30 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors"
                >
                  <PlusIcon className="w-3.5 h-3.5" aria-hidden="true" />
                  {t('addAgent')}
                </button>
              </div>

              <div className="space-y-1">
                {members.map((member) => {
                  const agent = member.memberType === 'agent' ? agentMap.get(member.memberId) : null
                  const status = agent
                    ? statusConfig[agent.status as keyof typeof statusConfig] ||
                      statusConfig.offline
                    : null
                  const type = agent ? typeConfig[agent.type] || typeConfig.generic : null
                  const displayName = agent ? agent.name : member.memberId

                  return (
                    <div
                      key={member.memberId}
                      className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-surface-hover transition-colors group"
                    >
                      {/* Avatar */}
                      <div className="relative flex-shrink-0">
                        <div
                          className={`
                          w-8 h-8 rounded-full flex items-center justify-center
                          ${
                            member.memberType === 'agent'
                              ? 'bg-gradient-to-br from-blue-500 to-indigo-600'
                              : 'bg-gradient-to-br from-gray-400 to-gray-500'
                          }
                        `}
                        >
                          <span className="text-xs font-medium text-white">
                            {displayName.charAt(0).toUpperCase()}
                          </span>
                        </div>
                        {member.memberType === 'user' && onlineUsers.has(member.memberId) && (
                          <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-green-500 border-2 border-surface rounded-full" />
                        )}
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-medium text-text-primary truncate">
                            {displayName}
                          </span>
                          {status && (
                            <span
                              className={`w-1.5 h-1.5 rounded-full ${status.color} flex-shrink-0`}
                            />
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          {type && (
                            <span
                              className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium ${type.color}`}
                            >
                              {type.label}
                            </span>
                          )}
                          <span className="text-[10px] text-text-muted">
                            {roleLabel(member.role)}
                          </span>
                        </div>
                      </div>

                      {/* Remove Button (not for owner) */}
                      {member.role !== 'owner' && (
                        <button
                          onClick={() => handleRemoveMember(member.memberId)}
                          className="p-1 rounded-md text-text-muted hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 opacity-0 group-hover:opacity-100 transition-all flex-shrink-0"
                          title={t('removeMember')}
                          aria-label={t('removeMember')}
                        >
                          <CloseIcon className="w-4 h-4" aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          </div>

          {/* Footer: Pin / Archive / Delete */}
          <div className="px-5 py-4 border-t border-border space-y-2">
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
                    : 'text-text-secondary bg-surface-hover hover:bg-gray-200 dark:hover:bg-gray-600'
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
                    : 'text-text-secondary bg-surface-hover hover:bg-gray-200 dark:hover:bg-gray-600'
                }`}
              >
                {myMember?.archivedAt ? t('unarchiveRoom') : t('archiveRoom')}
              </button>
            </div>
            {showDeleteConfirm ? (
              <div className="space-y-3">
                <p className="text-sm text-text-secondary">{t('confirmDeleteRoom')}</p>
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setShowDeleteConfirm(false)}
                    className="flex-1"
                  >
                    {t('cancel')}
                  </Button>
                  <Button variant="danger" size="sm" onClick={handleDeleteRoom} className="flex-1">
                    {t('delete')}
                  </Button>
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
