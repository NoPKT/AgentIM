import { useState, useCallback, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import type { Message } from '@agentim/shared'
import { useChatStore } from '../stores/chat.js'
import { useAuthStore } from '../stores/auth.js'
import { toast } from '../stores/toast.js'
import { api } from '../lib/api.js'

interface EditHistoryEntry {
  id: string
  previousContent: string
  editedAt: string
}

export interface MessageActions {
  // Auth
  currentUser: ReturnType<typeof useAuthStore.getState>['user']
  isOwnMessage: boolean

  // Editing
  isEditing: boolean
  editContent: string
  isSaving: boolean
  setEditContent: (value: string) => void
  handleEdit: () => void
  handleEditSave: () => Promise<void>
  handleEditCancel: () => void

  // Deleting
  confirmingDelete: boolean
  setConfirmingDelete: (value: boolean) => void
  handleDelete: () => Promise<void>

  // Actions panel
  showActions: boolean
  setShowActions: (value: boolean) => void
  actionsRef: React.RefObject<HTMLDivElement | null>

  // Emoji
  showEmojiPicker: boolean
  setShowEmojiPicker: (value: boolean) => void
  handleReaction: (emoji: string) => void

  // Reply
  handleReply: () => void

  // Edit history
  showEditHistory: boolean
  editHistory: EditHistoryEntry[]
  loadingHistory: boolean
  toggleEditHistory: () => void
}

export function useMessageActions(message: Message): MessageActions {
  const { t } = useTranslation()
  const setReplyTo = useChatStore((s) => s.setReplyTo)
  const editMessage = useChatStore((s) => s.editMessage)
  const deleteMessage = useChatStore((s) => s.deleteMessage)
  const toggleReaction = useChatStore((s) => s.toggleReaction)
  const currentUser = useAuthStore((s) => s.user)

  // Editing state
  const [isEditing, setIsEditing] = useState(false)
  const [editContent, setEditContent] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  // Delete confirmation
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  // Actions panel
  const [showActions, setShowActions] = useState(false)
  const actionsRef = useRef<HTMLDivElement>(null)

  // Emoji picker
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)

  // Edit history
  const [showEditHistory, setShowEditHistory] = useState(false)
  const [editHistory, setEditHistory] = useState<EditHistoryEntry[]>([])
  const [loadingHistory, setLoadingHistory] = useState(false)

  const isOwnMessage =
    !!currentUser && message.senderId === currentUser.id && message.senderType === 'user'

  // Close actions on outside click/tap or Escape key
  useEffect(() => {
    if (!showActions) return
    const clickHandler = (e: Event) => {
      if (actionsRef.current && !actionsRef.current.contains(e.target as Node)) {
        setShowActions(false)
        setShowEmojiPicker(false)
      }
    }
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showEmojiPicker) {
          setShowEmojiPicker(false)
        } else {
          setShowActions(false)
        }
      }
    }
    document.addEventListener('mousedown', clickHandler)
    document.addEventListener('touchstart', clickHandler)
    document.addEventListener('keydown', keyHandler)
    return () => {
      document.removeEventListener('mousedown', clickHandler)
      document.removeEventListener('touchstart', clickHandler)
      document.removeEventListener('keydown', keyHandler)
    }
  }, [showActions, showEmojiPicker])

  const handleEdit = useCallback(() => {
    setEditContent(message.content)
    setIsEditing(true)
  }, [message.content])

  const handleEditSave = useCallback(async () => {
    const trimmed = editContent.trim()
    if (!trimmed || trimmed === message.content) {
      setIsEditing(false)
      return
    }
    setIsSaving(true)
    try {
      await editMessage(message.id, trimmed)
      setIsEditing(false)
    } catch {
      toast.error(t('error.generic'))
    } finally {
      setIsSaving(false)
    }
  }, [editContent, message.content, message.id, editMessage, t])

  const handleEditCancel = useCallback(() => {
    setIsEditing(false)
  }, [])

  const handleDelete = useCallback(async () => {
    try {
      await deleteMessage(message.id)
    } catch {
      toast.error(t('error.generic'))
    } finally {
      setConfirmingDelete(false)
    }
  }, [message.id, deleteMessage, t])

  const handleReaction = useCallback(
    (emoji: string) => {
      toggleReaction(message.id, emoji).catch(() => toast.error(t('error.generic')))
      setShowEmojiPicker(false)
      setShowActions(false)
    },
    [message.id, toggleReaction, t],
  )

  const handleReply = useCallback(() => {
    setReplyTo(message)
    setShowActions(false)
  }, [message, setReplyTo])

  const toggleEditHistory = useCallback(async () => {
    if (showEditHistory) {
      setShowEditHistory(false)
      return
    }
    setLoadingHistory(true)
    setShowEditHistory(true)
    try {
      const res = await api.get<EditHistoryEntry[]>(`/messages/${message.id}/history`)
      if (res.ok && res.data) setEditHistory(res.data)
    } catch {
      /* ignore */
    }
    setLoadingHistory(false)
  }, [showEditHistory, message.id])

  return {
    currentUser,
    isOwnMessage,
    isEditing,
    editContent,
    isSaving,
    setEditContent,
    handleEdit,
    handleEditSave,
    handleEditCancel,
    confirmingDelete,
    setConfirmingDelete,
    handleDelete,
    showActions,
    setShowActions,
    actionsRef,
    showEmojiPicker,
    setShowEmojiPicker,
    handleReaction,
    handleReply,
    showEditHistory,
    editHistory,
    loadingHistory,
    toggleEditHistory,
  }
}
