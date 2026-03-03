import { useState, useCallback, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import type { Message } from '@agentim/shared'
import { useAuthStore } from '../stores/auth.js'
import { useChatStore } from '../stores/chat.js'
import { toast } from '../stores/toast.js'

export interface MessageActions {
  currentUser: ReturnType<typeof useAuthStore.getState>['user']
  isOwnMessage: boolean

  // Actions panel
  showActions: boolean
  setShowActions: (value: boolean) => void
  actionsRef: React.RefObject<HTMLDivElement | null>

  // Rewind
  canRewind: boolean
  confirmingRewind: boolean
  setConfirmingRewind: (value: boolean) => void
  handleRewind: () => Promise<void>
}

export function useMessageActions(
  message: Message,
  opts?: { roomSupportsRewind?: boolean },
): MessageActions {
  const { t } = useTranslation()
  const currentUser = useAuthStore((s) => s.user)
  const rewindRoom = useChatStore((s) => s.rewindRoom)

  // Actions panel
  const [showActions, setShowActions] = useState(false)
  const actionsRef = useRef<HTMLDivElement>(null)

  // Rewind confirmation
  const [confirmingRewind, setConfirmingRewind] = useState(false)

  const isOwnMessage =
    !!currentUser && message.senderId === currentUser.id && message.senderType === 'user'

  const canRewind = isOwnMessage && (opts?.roomSupportsRewind ?? false)

  // Close actions on outside click/tap or Escape key
  useEffect(() => {
    if (!showActions) return
    const clickHandler = (e: Event) => {
      if (actionsRef.current && !actionsRef.current.contains(e.target as Node)) {
        setShowActions(false)
        setConfirmingRewind(false)
      }
    }
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (confirmingRewind) {
          setConfirmingRewind(false)
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
  }, [showActions, confirmingRewind])

  const handleRewind = useCallback(async () => {
    try {
      await rewindRoom(message.roomId, message.id, message.content)
    } catch {
      toast.error(t('chat.rewindFailed'))
    } finally {
      setConfirmingRewind(false)
      setShowActions(false)
    }
  }, [message.roomId, message.id, message.content, rewindRoom, t])

  return {
    currentUser,
    isOwnMessage,
    showActions,
    setShowActions,
    actionsRef,
    canRewind,
    confirmingRewind,
    setConfirmingRewind,
    handleRewind,
  }
}
