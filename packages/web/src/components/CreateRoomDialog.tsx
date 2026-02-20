import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useChatStore } from '../stores/chat.js'
import { useRouterStore } from '../stores/routers.js'
import { Button, Input, Modal, ModalPanel, Textarea, Select } from './ui.js'
import { CloseIcon, LockIcon, GroupIcon } from './icons.js'

interface CreateRoomDialogProps {
  isOpen: boolean
  onClose: () => void
}

export default function CreateRoomDialog({ isOpen, onClose }: CreateRoomDialogProps) {
  const { t } = useTranslation()
  const createRoom = useChatStore((state) => state.createRoom)
  const routers = useRouterStore((s) => s.routers)
  const loadRouters = useRouterStore((s) => s.loadRouters)
  const dialogRef = useRef<HTMLDivElement>(null)

  const [name, setName] = useState('')
  const [type, setType] = useState<'private' | 'group'>('private')
  const [broadcastMode, setBroadcastMode] = useState(false)
  const [systemPrompt, setSystemPrompt] = useState('')
  const [routerId, setRouterId] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!name.trim()) {
      setError(t('chat.pleaseEnterRoomName'))
      return
    }

    setIsCreating(true)
    try {
      await createRoom(name, type, broadcastMode, systemPrompt.trim() || undefined, routerId || undefined)
      handleClose()
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t('chat.failedToCreateRoom'),
      )
    } finally {
      setIsCreating(false)
    }
  }

  const handleClose = () => {
    setName('')
    setType('private')
    setBroadcastMode(false)
    setSystemPrompt('')
    setRouterId('')
    setError('')
    onClose()
  }

  useEffect(() => {
    if (isOpen) loadRouters()
  }, [isOpen, loadRouters])

  // Focus trap
  useEffect(() => {
    if (!isOpen) return
    const dialog = dialogRef.current
    if (!dialog) return

    const focusableSelectors =
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    const focusable = dialog.querySelectorAll<HTMLElement>(focusableSelectors)
    const first = focusable[0]
    const last = focusable[focusable.length - 1]

    const handleTab = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault()
          last.focus()
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }

    dialog.addEventListener('keydown', handleTab)
    return () => dialog.removeEventListener('keydown', handleTab)
  }, [isOpen])

  // Body scroll lock
  useEffect(() => {
    if (!isOpen) return
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = ''
    }
  }, [isOpen])

  return (
    <Modal isOpen={isOpen} onClose={handleClose} aria-labelledby="create-room-title">
      <ModalPanel ref={dialogRef} className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h2
            id="create-room-title"
            className="text-xl font-semibold text-text-primary"
          >
            {t('chat.newRoom')}
          </h2>
          <button
            onClick={handleClose}
            className="p-1 rounded-md text-text-muted hover:text-text-secondary hover:bg-surface-hover transition-colors"
            aria-label={t('common.close')}
          >
            <CloseIcon className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          {error && (
            <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 px-4 py-3 rounded-md text-sm">
              {error}
            </div>
          )}

          {/* Room Name */}
          <div>
            <label
              htmlFor="roomName"
              className="block text-sm font-medium text-text-secondary mb-2"
            >
              {t('chat.roomName')}
            </label>
            <Input
              id="roomName"
              type="text"
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                if (error) setError('')
              }}
              placeholder={t('chat.enterRoomName')}
              error={!!error && !name.trim()}
              autoFocus
              required
            />
          </div>

          {/* Room Type */}
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">
              {t('chat.roomType')}
            </label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setType('private')}
                className={`px-4 py-3 border-2 rounded-lg text-left transition-all focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 ${
                  type === 'private'
                    ? 'border-accent bg-blue-50 dark:bg-blue-900/30'
                    : 'border-border hover:border-border hover:bg-surface-hover'
                }`}
              >
                <div className="flex items-center gap-2">
                  <LockIcon
                    className={`w-5 h-5 ${type === 'private' ? 'text-accent' : 'text-text-muted'}`}
                    aria-hidden="true"
                  />
                  <span
                    className={`font-medium ${type === 'private' ? 'text-blue-900 dark:text-blue-200' : 'text-text-primary'}`}
                  >
                    {t('chat.privateRoom')}
                  </span>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setType('group')}
                className={`px-4 py-3 border-2 rounded-lg text-left transition-all focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 ${
                  type === 'group'
                    ? 'border-accent bg-blue-50 dark:bg-blue-900/30'
                    : 'border-border hover:border-border hover:bg-surface-hover'
                }`}
              >
                <div className="flex items-center gap-2">
                  <GroupIcon
                    className={`w-5 h-5 ${type === 'group' ? 'text-accent' : 'text-text-muted'}`}
                    aria-hidden="true"
                  />
                  <span
                    className={`font-medium ${type === 'group' ? 'text-blue-900 dark:text-blue-200' : 'text-text-primary'}`}
                  >
                    {t('chat.groupRoom')}
                  </span>
                </div>
              </button>
            </div>
          </div>

          {/* System Prompt */}
          <div>
            <label
              htmlFor="systemPrompt"
              className="block text-sm font-medium text-text-secondary mb-2"
            >
              {t('chat.systemPrompt')}
            </label>
            <Textarea
              id="systemPrompt"
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder={t('chat.systemPromptPlaceholder')}
              rows={3}
              maxLength={10000}
            />
            <p className="text-xs text-text-muted mt-1">{t('chat.systemPromptDesc')}</p>
          </div>

          {/* Router */}
          <div>
            <label
              htmlFor="routerId"
              className="block text-sm font-medium text-text-secondary mb-2"
            >
              {t('router.roomRouter')}
            </label>
            <Select
              id="routerId"
              value={routerId}
              onChange={(e) => setRouterId(e.target.value)}
            >
              <option value="">{t('router.noRouter')}</option>
              {routers.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} ({r.llmModel})
                </option>
              ))}
            </Select>
            <p className="text-xs text-text-muted mt-1">{t('router.routerDesc')}</p>
          </div>

          {/* Broadcast Mode */}
          <div className="bg-surface-secondary border border-border rounded-lg p-4">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={broadcastMode}
                onChange={(e) => setBroadcastMode(e.target.checked)}
                className="mt-1 w-4 h-4 text-accent bg-surface border-border rounded focus:ring-accent focus:ring-2"
              />
              <div className="flex-1">
                <div className="font-medium text-text-primary text-sm">
                  {t('chat.broadcastMode')}
                </div>
                <div className="text-xs text-text-secondary mt-1">
                  {t('chat.broadcastModeDesc')}
                </div>
              </div>
            </label>
          </div>

          {/* Actions */}
          <div className="flex gap-3 justify-end pt-2">
            <Button type="button" variant="secondary" onClick={handleClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={isCreating}>
              {isCreating ? t('common.creating') : t('common.create')}
            </Button>
          </div>
        </form>
      </ModalPanel>
    </Modal>
  )
}
