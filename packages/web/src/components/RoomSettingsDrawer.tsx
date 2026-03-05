import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import { useChatStore } from '../stores/chat.js'
import { useAuthStore } from '../stores/auth.js'
import { useRouterStore } from '../stores/routers.js'
import { toast } from '../stores/toast.js'
import { Button, Input, Textarea, Select } from './ui.js'
import { CloseIcon, PencilIcon } from './icons.js'
import type { Room, AgentCommandRole } from '@agentim/shared'
import { AGENT_COMMAND_ROLES } from '@agentim/shared'
import type { TFunction } from 'i18next'

interface RoomSettingsDrawerProps {
  roomId: string
  isOpen: boolean
  onClose: () => void
}

// ─── Internal sub-components ─────────────────────────────────────────────────

interface PromptSectionProps {
  room: Room | undefined
  editingPrompt: boolean
  promptValue: string
  updating: boolean
  t: TFunction
  onStartEdit: () => void
  onCancel: () => void
  onChange: (v: string) => void
  onSave: () => void
}

function PromptSection({
  room,
  editingPrompt,
  promptValue,
  updating,
  t,
  onStartEdit,
  onCancel,
  onChange,
  onSave,
}: PromptSectionProps) {
  return (
    <div className="px-5 py-4 border-b border-border">
      <label className="block text-xs font-medium text-text-secondary uppercase tracking-wider mb-2">
        {t('chat.systemPrompt')}
      </label>
      {editingPrompt ? (
        <div className="space-y-2">
          <Textarea
            inputSize="sm"
            value={promptValue}
            onChange={(e) => onChange(e.target.value)}
            rows={4}
            maxLength={10000}
            autoFocus
            placeholder={t('chat.systemPromptPlaceholder')}
          />
          <div className="flex gap-2 justify-end">
            <Button size="sm" variant="secondary" onClick={onCancel}>
              {t('common.cancel')}
            </Button>
            <Button size="sm" onClick={onSave} disabled={updating}>
              {t('common.save')}
            </Button>
          </div>
        </div>
      ) : (
        <button
          onClick={onStartEdit}
          className="w-full text-left px-3 py-1.5 text-sm hover:bg-surface-hover rounded-lg transition-colors flex items-center justify-between group"
        >
          <span className={room?.systemPrompt ? 'text-text-primary' : 'text-text-muted italic'}>
            {room?.systemPrompt
              ? room.systemPrompt.length > 80
                ? room.systemPrompt.slice(0, 80) + '...'
                : room.systemPrompt
              : t('chat.noSystemPrompt')}
          </span>
          <PencilIcon
            className="w-4 h-4 text-text-muted opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 ml-2"
            aria-hidden="true"
          />
        </button>
      )}
      <p className="text-xs text-text-secondary mt-1">{t('chat.systemPromptDesc')}</p>
    </div>
  )
}

interface NotificationSectionProps {
  currentNotifPref: 'all' | 'mentions' | 'none'
  roomId: string
  t: TFunction
  updateNotificationPref: (roomId: string, pref: 'all' | 'mentions' | 'none') => Promise<void>
}

function NotificationSection({
  currentNotifPref,
  roomId,
  t,
  updateNotificationPref,
}: NotificationSectionProps) {
  return (
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
                toast.error(t('common.error'))
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
  )
}

// ─── Main exported component ─────────────────────────────────────────────────

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
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [updating, setUpdating] = useState(false)
  const [pinLoading, setPinLoading] = useState(false)
  const [archiveLoading, setArchiveLoading] = useState(false)

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

  const handleSaveName = async () => {
    if (!nameValue.trim() || nameValue === room?.name) {
      setEditingName(false)
      return
    }
    setUpdating(true)
    try {
      await updateRoom(roomId, { name: nameValue.trim() })
      toast.success(t('chat.roomUpdated'))
    } catch {
      toast.error(t('common.error'))
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
      toast.success(t('chat.roomUpdated'))
    } catch {
      toast.error(t('common.error'))
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
      toast.success(t('chat.roomUpdated'))
    } catch {
      toast.error(t('common.error'))
    } finally {
      setUpdating(false)
      setEditingPrompt(false)
    }
  }

  const handleDeleteRoom = async () => {
    try {
      // Navigate away first to prevent ChatPage from re-syncing
      // the deleted roomId back into the store
      onClose()
      navigate('/')
      await deleteRoom(roomId)
      toast.success(t('chat.roomDeleted'))
    } catch {
      toast.error(t('common.error'))
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
        aria-label={t('chat.roomSettingsTitle')}
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
              {t('chat.roomSettingsTitle')}
            </h2>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-surface-hover transition-colors"
              aria-label={t('common.close')}
            >
              <CloseIcon className="w-5 h-5 text-text-secondary" aria-hidden="true" />
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto scrollbar-thin">
            {/* Room Name */}
            <div className="px-5 py-4 border-b border-border">
              <label className="block text-xs font-medium text-text-secondary uppercase tracking-wider mb-2">
                {t('chat.roomName')}
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
                    {t('common.save')}
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
                  <p className="text-sm font-medium text-text-primary">{t('chat.broadcastMode')}</p>
                  <p className="text-xs text-text-secondary mt-0.5">
                    {t('chat.broadcastModeDesc')}
                  </p>
                </div>
                <button
                  role="switch"
                  aria-checked={!!room?.broadcastMode}
                  aria-label={t('chat.broadcastMode')}
                  onClick={handleToggleBroadcast}
                  disabled={updating}
                  className={`
                    relative inline-flex h-6 w-12 flex-shrink-0 items-center rounded-full transition-colors
                    ${room?.broadcastMode ? 'bg-accent' : 'bg-surface-hover'}
                    disabled:opacity-50
                  `}
                >
                  <span
                    className={`
                      inline-block h-4 w-4 rounded-full bg-white shadow-sm transform transition-transform
                      ${room?.broadcastMode ? 'translate-x-7' : 'translate-x-1'}
                    `}
                  />
                </button>
              </div>
            </div>

            <PromptSection
              room={room}
              editingPrompt={editingPrompt}
              promptValue={promptValue}
              updating={updating}
              t={t}
              onStartEdit={() => setEditingPrompt(true)}
              onCancel={() => {
                setPromptValue(room?.systemPrompt ?? '')
                setEditingPrompt(false)
              }}
              onChange={setPromptValue}
              onSave={handleSavePrompt}
            />

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
                    toast.success(t('chat.roomUpdated'))
                  } catch {
                    toast.error(t('common.error'))
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
              <p className="text-xs text-text-secondary mt-1">{t('router.routerDesc')}</p>
            </div>

            {/* Agent Command Role Selector */}
            <div className="px-5 py-4 border-b border-border">
              <label className="block text-xs font-medium text-text-secondary uppercase tracking-wider mb-2">
                {t('chat.agentCommandRole')}
              </label>
              <Select
                value={room?.agentCommandRole ?? 'member'}
                onChange={async (e) => {
                  const agentCommandRole = e.target.value as AgentCommandRole
                  setUpdating(true)
                  try {
                    await updateRoom(roomId, { agentCommandRole })
                    toast.success(t('chat.roomUpdated'))
                  } catch {
                    toast.error(t('common.error'))
                  } finally {
                    setUpdating(false)
                  }
                }}
                disabled={updating}
              >
                {AGENT_COMMAND_ROLES.map((role) => (
                  <option key={role} value={role}>
                    {role === 'member'
                      ? t('chat.roleMember')
                      : role === 'admin'
                        ? t('chat.roleAdmin')
                        : t('chat.roleOwner')}
                  </option>
                ))}
              </Select>
              <p className="text-xs text-text-secondary mt-1">{t('chat.agentCommandRoleDesc')}</p>
            </div>

            <NotificationSection
              currentNotifPref={currentNotifPref}
              roomId={roomId}
              t={t}
              updateNotificationPref={updateNotificationPref}
            />
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
                    toast.error(t('common.error'))
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
                {myMember?.pinnedAt ? t('chat.unpinRoom') : t('chat.pinRoom')}
              </button>
              <button
                onClick={async () => {
                  if (archiveLoading) return
                  setArchiveLoading(true)
                  try {
                    await toggleArchive(roomId)
                  } catch {
                    toast.error(t('common.error'))
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
                {myMember?.archivedAt ? t('chat.unarchiveRoom') : t('chat.archiveRoom')}
              </button>
            </div>
            {showDeleteConfirm ? (
              <div className="space-y-3">
                <p className="text-sm text-text-secondary">{t('chat.confirmDeleteRoom')}</p>
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setShowDeleteConfirm(false)}
                    className="flex-1"
                  >
                    {t('common.cancel')}
                  </Button>
                  <Button variant="danger" size="sm" onClick={handleDeleteRoom} className="flex-1">
                    {t('common.delete')}
                  </Button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="w-full px-4 py-2 text-sm font-medium text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors"
              >
                {t('chat.deleteRoom')}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Members are now managed via MemberListPanel in ChatPage */}
    </>
  )
}
