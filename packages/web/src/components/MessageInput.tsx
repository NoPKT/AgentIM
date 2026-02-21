import {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
  KeyboardEvent,
  ChangeEvent,
} from 'react'
import { useTranslation } from 'react-i18next'
import {
  parseMentions,
  MAX_FILE_SIZE,
  MAX_MESSAGE_LENGTH,
  ALLOWED_MIME_TYPES,
} from '@agentim/shared'
import type { MessageAttachment } from '@agentim/shared'
import { toast } from '../stores/toast.js'
import { useChatStore } from '../stores/chat.js'
import { useAgentStore } from '../stores/agents.js'
import { useConnectionStatus } from '../hooks/useConnectionStatus.js'
import { wsClient } from '../lib/ws.js'
import { api } from '../lib/api.js'
import { ReplyIcon, CloseIcon, PaperClipIcon } from './icons.js'
import { useUploadUrls } from '../hooks/useUploadUrl.js'

interface PendingAttachment {
  id: string
  filename: string
  mimeType: string
  size: number
  url: string
  uploading?: boolean
  progress?: number
  error?: string
}

export function MessageInput() {
  const { t } = useTranslation()
  const { currentRoomId, sendMessage, replyTo, setReplyTo } = useChatStore()
  const { agents } = useAgentStore()
  const connectionStatus = useConnectionStatus()
  const isDisconnected = connectionStatus !== 'connected'
  const [content, setContent] = useState('')
  const draftTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const [showMentionMenu, setShowMentionMenu] = useState(false)
  const [mentionSearch, setMentionSearch] = useState('')
  const [mentionPosition, setMentionPosition] = useState(0)
  const [selectedMentionIndex, setSelectedMentionIndex] = useState(0)
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([])
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const lastTypingSentRef = useRef(0)

  const sendTypingEvent = useCallback(() => {
    if (!currentRoomId) return
    const now = Date.now()
    if (now - lastTypingSentRef.current > 2000) {
      lastTypingSentRef.current = now
      wsClient.send({ type: 'client:typing', roomId: currentRoomId })
    }
  }, [currentRoomId])

  // Restore draft when room changes
  useEffect(() => {
    if (!currentRoomId) return
    const saved = localStorage.getItem(`draft:${currentRoomId}`)
    setContent(saved ?? '')
  }, [currentRoomId])

  // Auto-save draft (debounced)
  useEffect(() => {
    if (!currentRoomId) return
    clearTimeout(draftTimerRef.current)
    draftTimerRef.current = setTimeout(() => {
      if (content) {
        localStorage.setItem(`draft:${currentRoomId}`, content)
      } else {
        localStorage.removeItem(`draft:${currentRoomId}`)
      }
    }, 300)
    return () => clearTimeout(draftTimerRef.current)
  }, [content, currentRoomId])

  const filteredAgents = useMemo(
    () => agents.filter((agent) => agent.name.toLowerCase().includes(mentionSearch.toLowerCase())),
    [agents, mentionSearch],
  )

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`
    }
  }, [content])

  const handleFileSelect = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return

      for (const file of Array.from(files)) {
        if (file.size > MAX_FILE_SIZE) {
          toast.error(
            `${file.name}: ${t('chat.fileTooLarge')} (${Math.round(MAX_FILE_SIZE / 1024 / 1024)}MB max)`,
          )
          continue
        }
        if (!(ALLOWED_MIME_TYPES as readonly string[]).includes(file.type)) {
          toast.error(`${file.name}: ${t('chat.fileTypeNotAllowed')} (${file.type || 'unknown'})`)
          continue
        }

        const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2)}`
        const pending: PendingAttachment = {
          id: tempId,
          filename: file.name,
          mimeType: file.type,
          size: file.size,
          url: '',
          uploading: true,
        }

        setPendingAttachments((prev) => [...prev, pending])

        try {
          const res = await api.upload<{
            id: string
            filename: string
            mimeType: string
            size: number
            url: string
          }>('/upload', file, {
            onProgress: (percent) => {
              setPendingAttachments((prev) =>
                prev.map((a) => (a.id === tempId ? { ...a, progress: percent } : a)),
              )
            },
          })
          if (res.ok && res.data) {
            setPendingAttachments((prev) =>
              prev.map((a) =>
                a.id === tempId
                  ? { ...a, id: res.data!.id, url: res.data!.url, uploading: false }
                  : a,
              ),
            )
          } else {
            setPendingAttachments((prev) =>
              prev.map((a) =>
                a.id === tempId
                  ? { ...a, uploading: false, error: res.error || t('chat.uploadFailed') }
                  : a,
              ),
            )
          }
        } catch {
          setPendingAttachments((prev) =>
            prev.map((a) =>
              a.id === tempId ? { ...a, uploading: false, error: t('chat.uploadFailed') } : a,
            ),
          )
        }
      }
    },
    [t],
  )

  const removeAttachment = useCallback((id: string) => {
    setPendingAttachments((prev) => prev.filter((a) => a.id !== id))
  }, [])

  const handleInputChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    const newContent = e.target.value
    setContent(newContent)
    sendTypingEvent()

    const cursorPos = e.target.selectionStart
    const textBeforeCursor = newContent.slice(0, cursorPos)
    const lastAtIndex = textBeforeCursor.lastIndexOf('@')

    if (lastAtIndex !== -1) {
      const textAfterAt = textBeforeCursor.slice(lastAtIndex + 1)
      if (!textAfterAt.includes(' ')) {
        setMentionSearch(textAfterAt)
        setMentionPosition(lastAtIndex)
        setShowMentionMenu(true)
        setSelectedMentionIndex(0)
        return
      }
    }

    setShowMentionMenu(false)
  }

  const insertMention = (agentName: string) => {
    const before = content.slice(0, mentionPosition)
    const after = content.slice(textareaRef.current?.selectionStart ?? content.length)
    const newContent = `${before}@${agentName} ${after}`
    setContent(newContent)
    setShowMentionMenu(false)

    setTimeout(() => {
      if (textareaRef.current) {
        const newPos = mentionPosition + agentName.length + 2
        textareaRef.current.focus()
        textareaRef.current.setSelectionRange(newPos, newPos)
      }
    }, 0)
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (showMentionMenu && filteredAgents.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedMentionIndex((prev) => (prev < filteredAgents.length - 1 ? prev + 1 : prev))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedMentionIndex((prev) => (prev > 0 ? prev - 1 : prev))
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        insertMention(filteredAgents[selectedMentionIndex].name)
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setShowMentionMenu(false)
        return
      }
    }

    if (e.key === 'Enter') {
      // Cmd/Ctrl+Enter always sends
      if (e.metaKey || e.ctrlKey) {
        e.preventDefault()
        handleSend()
        return
      }
      // Plain Enter sends on non-mobile (mobile needs Enter for newlines via Shift+Enter)
      if (!e.shiftKey && !('ontouchstart' in window)) {
        e.preventDefault()
        handleSend()
      }
    }
  }

  const isUploading = pendingAttachments.some((a) => a.uploading)
  const readyAttachments = pendingAttachments.filter((a) => !a.uploading && !a.error)
  // Auth-gated thumbnail URLs for the pending-attachment preview strip
  const attachmentAuthUrls = useUploadUrls(pendingAttachments.map((a) => a.url ?? ''))
  const hasContent = content.trim().length > 0 || readyAttachments.length > 0

  const handleSend = () => {
    if (!currentRoomId || !hasContent || isUploading) return
    if (content.length > MAX_MESSAGE_LENGTH) {
      toast.error(t('chat.messageTooLong'))
      return
    }

    const mentions = parseMentions(content)
    const attachmentIds = readyAttachments.map((a) => a.id)
    sendMessage(
      currentRoomId,
      content.trim() || ' ',
      mentions,
      attachmentIds.length > 0 ? attachmentIds : undefined,
    )
    setContent('')
    setPendingAttachments([])
    localStorage.removeItem(`draft:${currentRoomId}`)
  }

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      handleFileSelect(e.dataTransfer.files)
    },
    [handleFileSelect],
  )

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
  }, [])

  if (!currentRoomId) {
    return null
  }

  return (
    <div className="bg-surface px-4 pb-4 pt-2">
      {/* Disconnected warning */}
      {isDisconnected && (
        <div
          className={`mb-2 px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 border ${
            connectionStatus === 'reconnecting'
              ? 'bg-warning-subtle text-warning-text border-warning-text/20'
              : 'bg-danger-subtle text-danger-text border-danger/20'
          }`}
        >
          <span
            className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
              connectionStatus === 'reconnecting' ? 'bg-warning-text animate-pulse' : 'bg-danger'
            }`}
          />
          {connectionStatus === 'reconnecting' ? t('chat.reconnecting') : t('chat.disconnected')}
        </div>
      )}

      {/* Reply preview */}
      {replyTo && (
        <div className="mb-2 px-4 py-2 bg-info-subtle border border-info-border rounded-xl flex items-center justify-between">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <ReplyIcon className="w-3.5 h-3.5 text-info-text flex-shrink-0" />
              <span className="text-xs font-medium text-info-text">{replyTo.senderName}</span>
            </div>
            <p className="text-xs text-text-muted truncate mt-0.5">
              {replyTo.content.slice(0, 80)}
            </p>
          </div>
          <button
            onClick={() => setReplyTo(null)}
            aria-label={t('common.close')}
            className="p-1 rounded-md text-text-muted hover:text-text-secondary hover:bg-surface-hover flex-shrink-0 ml-2"
          >
            <CloseIcon className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      )}

      <div
        className="relative border border-border rounded-2xl shadow-sm focus-within:ring-2 focus-within:ring-accent focus-within:border-transparent transition-shadow"
        onDrop={handleDrop}
        onDragOver={handleDragOver}
      >
        {/* Mention menu */}
        {showMentionMenu && filteredAgents.length > 0 && (
          <div
            id="mention-listbox"
            role="listbox"
            aria-label={t('chat.mentionHint')}
            className="absolute bottom-full mb-2 left-4 bg-surface border border-border rounded-xl shadow-xl max-h-48 overflow-y-auto z-dropdown w-64"
          >
            <div className="p-2.5 border-b border-border">
              <p className="text-xs text-text-muted">{t('chat.mentionHint')}</p>
            </div>
            {filteredAgents.map((agent, index) => (
              <button
                key={agent.id}
                role="option"
                aria-selected={index === selectedMentionIndex}
                onClick={() => insertMention(agent.name)}
                className={`
                  w-full px-3 py-2.5 text-left hover:bg-surface-hover transition-colors
                  ${index === selectedMentionIndex ? 'bg-info-subtle' : ''}
                `}
              >
                <div className="flex items-center space-x-2.5">
                  <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center">
                    <span className="text-xs font-medium text-white">
                      {agent.name.charAt(0).toUpperCase()}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-text-primary truncate">{agent.name}</p>
                    <p className="text-xs text-text-muted">{agent.type}</p>
                  </div>
                  {agent.status === 'online' && (
                    <span className="w-2 h-2 bg-success-text rounded-full" aria-hidden="true" />
                  )}
                </div>
              </button>
            ))}
          </div>
        )}

        {/* Pending attachments preview */}
        {pendingAttachments.length > 0 && (
          <div className="px-3 pt-2 flex flex-wrap gap-2">
            {pendingAttachments.map((att, i) => (
              <div
                key={att.id}
                className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs border ${
                  att.error
                    ? 'bg-danger-subtle border-danger/20 text-danger-text'
                    : att.uploading
                      ? 'bg-surface-secondary border-border text-text-muted'
                      : 'bg-info-subtle border-info-border text-info-text'
                }`}
              >
                {att.uploading && (
                  <>
                    <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                      />
                    </svg>
                    {att.progress != null && <span>{att.progress}%</span>}
                  </>
                )}
                {att.mimeType.startsWith('image/') && att.url && (
                  <img
                    src={attachmentAuthUrls[i]}
                    alt=""
                    className="w-6 h-6 rounded object-cover"
                  />
                )}
                <span className="truncate max-w-[120px]">{att.filename}</span>
                <button
                  onClick={() => removeAttachment(att.id)}
                  className="p-0.5 rounded hover:bg-black/10 flex-shrink-0"
                  aria-label={t('chat.removeAttachment')}
                >
                  <CloseIcon className="w-3 h-3" aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Input area */}
        <div className="flex items-end">
          {/* Attach button */}
          <div className="pl-2 pb-2">
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isDisconnected}
              className="w-10 h-10 flex items-center justify-center text-text-muted hover:text-text-secondary rounded-full hover:bg-surface-hover transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              aria-label={t('chat.attachFile')}
            >
              <PaperClipIcon className="w-5 h-5" />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              multiple
              accept={(ALLOWED_MIME_TYPES as readonly string[]).join(',')}
              aria-hidden="true"
              tabIndex={-1}
              onChange={(e) => {
                handleFileSelect(e.target.files)
                e.target.value = ''
              }}
            />
          </div>

          <div className="flex-1 relative">
            <textarea
              ref={textareaRef}
              value={content}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder={t('chat.sendMessage')}
              aria-label={t('chat.sendMessage')}
              aria-autocomplete="list"
              aria-haspopup="listbox"
              aria-expanded={showMentionMenu && filteredAgents.length > 0}
              aria-controls={
                showMentionMenu && filteredAgents.length > 0 ? 'mention-listbox' : undefined
              }
              className="w-full px-2 py-3 resize-none focus:outline-none rounded-2xl bg-transparent min-h-12 max-h-[200px]"
              rows={1}
            />
          </div>

          {/* Send button */}
          <div className="px-2 pb-2">
            <button
              onClick={handleSend}
              disabled={!hasContent || isDisconnected || isUploading}
              className="w-10 h-10 flex items-center justify-center bg-accent text-white rounded-full hover:bg-accent-hover transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              aria-label={t('common.send')}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
                />
              </svg>
            </button>
          </div>
        </div>

        <div className="px-4 pb-2 hidden sm:block">
          <p className="text-[10px] text-text-muted">{t('chat.sendWithCmd')}</p>
        </div>
      </div>
    </div>
  )
}
