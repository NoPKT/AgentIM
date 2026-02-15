import { useState, useRef, useEffect, useCallback, useMemo, KeyboardEvent, ChangeEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { parseMentions, MAX_FILE_SIZE, ALLOWED_MIME_TYPES } from '@agentim/shared'
import type { MessageAttachment } from '@agentim/shared'
import { toast } from '../stores/toast.js'
import { useChatStore } from '../stores/chat.js'
import { useAgentStore } from '../stores/agents.js'
import { useConnectionStatus } from '../hooks/useConnectionStatus.js'
import { wsClient } from '../lib/ws.js'
import { api } from '../lib/api.js'

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

  const handleFileSelect = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return

    for (const file of Array.from(files)) {
      if (file.size > MAX_FILE_SIZE) {
        toast.error(`${file.name}: ${t('chat.fileTooLarge')} (${Math.round(MAX_FILE_SIZE / 1024 / 1024)}MB max)`)
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
        const res = await api.upload<{ id: string; filename: string; mimeType: string; size: number; url: string }>(
          '/upload',
          file,
          {
            onProgress: (percent) => {
              setPendingAttachments((prev) =>
                prev.map((a) => (a.id === tempId ? { ...a, progress: percent } : a)),
              )
            },
          },
        )
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
            a.id === tempId
              ? { ...a, uploading: false, error: t('chat.uploadFailed') }
              : a,
          ),
        )
      }
    }
  }, [t])

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
        setSelectedMentionIndex((prev) =>
          prev < filteredAgents.length - 1 ? prev + 1 : prev
        )
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
  const hasContent = content.trim().length > 0 || readyAttachments.length > 0

  const handleSend = () => {
    if (!currentRoomId || !hasContent || isUploading) return

    const mentions = parseMentions(content)
    const attachmentIds = readyAttachments.map((a) => a.id)
    sendMessage(currentRoomId, content.trim() || ' ', mentions, attachmentIds.length > 0 ? attachmentIds : undefined)
    setContent('')
    setPendingAttachments([])
    localStorage.removeItem(`draft:${currentRoomId}`)
  }

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    handleFileSelect(e.dataTransfer.files)
  }, [handleFileSelect])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
  }, [])

  if (!currentRoomId) {
    return null
  }

  return (
    <div className="bg-white dark:bg-gray-800 px-4 pb-4 pt-2">
      {/* Disconnected warning */}
      {isDisconnected && (
        <div className={`mb-2 px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 ${
          connectionStatus === 'reconnecting'
            ? 'bg-yellow-50 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300 border border-yellow-200 dark:border-yellow-800'
            : 'bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800'
        }`}>
          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
            connectionStatus === 'reconnecting' ? 'bg-yellow-500 animate-pulse' : 'bg-red-500'
          }`} />
          {connectionStatus === 'reconnecting' ? t('reconnecting') : t('disconnected')}
        </div>
      )}

      {/* Reply preview */}
      {replyTo && (
        <div className="mb-2 px-4 py-2 bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-700 rounded-xl flex items-center justify-between">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <svg className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
              </svg>
              <span className="text-xs font-medium text-blue-600 dark:text-blue-400">{replyTo.senderName}</span>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5">{replyTo.content.slice(0, 80)}</p>
          </div>
          <button
            onClick={() => setReplyTo(null)}
            aria-label={t('close')}
            className="p-1 rounded-md text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 flex-shrink-0 ml-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      <div
        className="relative border border-gray-200 dark:border-gray-600 rounded-2xl shadow-sm focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-transparent transition-shadow"
        onDrop={handleDrop}
        onDragOver={handleDragOver}
      >
        {/* Mention menu */}
        {showMentionMenu && filteredAgents.length > 0 && (
          <div className="absolute bottom-full mb-2 left-4 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-xl shadow-xl max-h-48 overflow-y-auto z-10 w-64">
            <div className="p-2.5 border-b border-gray-100 dark:border-gray-700">
              <p className="text-xs text-gray-500 dark:text-gray-400">{t('mentionHint')}</p>
            </div>
            {filteredAgents.map((agent, index) => (
              <button
                key={agent.id}
                onClick={() => insertMention(agent.name)}
                className={`
                  w-full px-3 py-2.5 text-left hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors
                  ${index === selectedMentionIndex ? 'bg-blue-50 dark:bg-blue-900/30' : ''}
                `}
              >
                <div className="flex items-center space-x-2.5">
                  <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center">
                    <span className="text-xs font-medium text-white">
                      {agent.name.charAt(0).toUpperCase()}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{agent.name}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{agent.type}</p>
                  </div>
                  {agent.status === 'online' && (
                    <span className="w-2 h-2 bg-green-500 rounded-full"></span>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}

        {/* Pending attachments preview */}
        {pendingAttachments.length > 0 && (
          <div className="px-3 pt-2 flex flex-wrap gap-2">
            {pendingAttachments.map((att) => (
              <div
                key={att.id}
                className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs border ${
                  att.error
                    ? 'bg-red-50 dark:bg-red-900/30 border-red-200 dark:border-red-800 text-red-700 dark:text-red-300'
                    : att.uploading
                      ? 'bg-gray-50 dark:bg-gray-700/50 border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400'
                      : 'bg-blue-50 dark:bg-blue-900/30 border-blue-200 dark:border-blue-700 text-blue-700 dark:text-blue-300'
                }`}
              >
                {att.uploading && (
                  <>
                    <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    {att.progress != null && <span>{att.progress}%</span>}
                  </>
                )}
                {att.mimeType.startsWith('image/') && att.url && (
                  <img src={att.url} alt="" className="w-6 h-6 rounded object-cover" />
                )}
                <span className="truncate max-w-[120px]">{att.filename}</span>
                <button
                  onClick={() => removeAttachment(att.id)}
                  className="p-0.5 rounded hover:bg-black/10 flex-shrink-0"
                  aria-label={t('chat.removeAttachment')}
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
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
              className="w-10 h-10 flex items-center justify-center text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              aria-label={t('chat.attachFile')}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
              </svg>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              multiple
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
              placeholder={t('sendMessage')}
              aria-label={t('sendMessage')}
              className="w-full px-2 py-3 resize-none focus:outline-none rounded-2xl bg-transparent"
              rows={1}
              style={{ minHeight: '48px', maxHeight: '200px' }}
            />
          </div>

          {/* Send button */}
          <div className="px-2 pb-2">
            <button
              onClick={handleSend}
              disabled={!hasContent || isDisconnected || isUploading}
              className="w-10 h-10 flex items-center justify-center bg-blue-600 text-white rounded-full hover:bg-blue-700 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              aria-label={t('send')}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            </button>
          </div>
        </div>

        <div className="px-4 pb-2 hidden sm:block">
          <p className="text-[10px] text-gray-400 dark:text-gray-500">{t('sendWithCmd')}</p>
        </div>
      </div>
    </div>
  )
}
