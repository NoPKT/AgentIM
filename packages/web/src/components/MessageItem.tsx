import { useState, useCallback, useMemo, useRef, useEffect, memo } from 'react'
import { useTranslation } from 'react-i18next'
import type { Message } from '@agentim/shared'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import { useChatStore } from '../stores/chat.js'
import { useAuthStore } from '../stores/auth.js'
import { toast } from '../stores/toast.js'
import { api } from '../lib/api.js'
import { groupChunks, ChunkGroupRenderer } from './ChunkBlocks.js'
import 'highlight.js/styles/github.css'

interface MessageItemProps {
  message: Message
}

const REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🎉']

const agentAvatarGradients: Record<string, string> = {
  a: 'from-purple-500 to-violet-600',
  b: 'from-blue-500 to-indigo-600',
  c: 'from-cyan-500 to-teal-600',
  d: 'from-emerald-500 to-green-600',
  e: 'from-amber-500 to-orange-600',
  f: 'from-rose-500 to-pink-600',
}

function getAvatarGradient(name: string): string {
  const key = name.charAt(0).toLowerCase()
  return agentAvatarGradients[key] || 'from-blue-500 to-indigo-600'
}

function FileTypeIcon({ mimeType }: { mimeType: string }) {
  if (mimeType.startsWith('video/')) {
    return (
      <svg className="w-5 h-5 text-purple-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
      </svg>
    )
  }
  if (mimeType.startsWith('audio/')) {
    return (
      <svg className="w-5 h-5 text-green-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2z" />
      </svg>
    )
  }
  if (mimeType === 'application/pdf') {
    return (
      <svg className="w-5 h-5 text-red-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
      </svg>
    )
  }
  if (mimeType.includes('zip') || mimeType.includes('tar') || mimeType.includes('compress') || mimeType.includes('archive')) {
    return (
      <svg className="w-5 h-5 text-yellow-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
      </svg>
    )
  }
  return (
    <svg className="w-5 h-5 text-gray-400 dark:text-gray-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
    </svg>
  )
}

function CopyButton({ text }: { text: string }) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [text])

  return (
    <button
      onClick={handleCopy}
      className="px-2 py-1 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded transition-colors"
      title={t('copy')}
    >
      {copied ? t('copied') : t('copy')}
    </button>
  )
}

export const MessageItem = memo(function MessageItem({ message }: MessageItemProps) {
  const { t, i18n } = useTranslation()
  const setReplyTo = useChatStore((s) => s.setReplyTo)
  const editMessage = useChatStore((s) => s.editMessage)
  const deleteMessage = useChatStore((s) => s.deleteMessage)
  const messages = useChatStore((s) => s.messages)
  const currentUser = useAuthStore((s) => s.user)

  const toggleReaction = useChatStore((s) => s.toggleReaction)

  const [isEditing, setIsEditing] = useState(false)
  const [editContent, setEditContent] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  const [showActions, setShowActions] = useState(false)
  const [showEditHistory, setShowEditHistory] = useState(false)
  const [editHistory, setEditHistory] = useState<{ id: string; previousContent: string; editedAt: string }[]>([])
  const [loadingHistory, setLoadingHistory] = useState(false)
  const actionsRef = useRef<HTMLDivElement>(null)

  // Close actions on outside click/tap (mobile)
  useEffect(() => {
    if (!showActions) return
    const handler = (e: Event) => {
      if (actionsRef.current && !actionsRef.current.contains(e.target as Node)) {
        setShowActions(false)
        setShowEmojiPicker(false)
      }
    }
    document.addEventListener('mousedown', handler)
    document.addEventListener('touchstart', handler)
    return () => {
      document.removeEventListener('mousedown', handler)
      document.removeEventListener('touchstart', handler)
    }
  }, [showActions])

  const isOwnMessage = currentUser && message.senderId === currentUser.id && message.senderType === 'user'

  // Find the replied-to message
  const repliedMessage = message.replyToId
    ? (messages.get(message.roomId) ?? []).find((m) => m.id === message.replyToId)
    : null

  // Group chunks for agent messages that have structured data
  const chunkGroups = useMemo(
    () => (message.chunks?.length ? groupChunks(message.chunks) : null),
    [message.chunks],
  )

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
  }, [editContent, message.content, message.id, editMessage])

  const handleDelete = useCallback(async () => {
    try {
      await deleteMessage(message.id)
    } catch {
      toast.error(t('error.generic'))
    } finally {
      setConfirmingDelete(false)
    }
  }, [message.id, deleteMessage])

  // System messages
  if (message.senderType === 'system') {
    return (
      <div className="px-6 py-2">
        <div className="flex justify-center">
          <div className="px-4 py-1.5 bg-gray-100 dark:bg-gray-700 rounded-full">
            <p className="text-xs text-gray-500 dark:text-gray-400 text-center">{message.content}</p>
          </div>
        </div>
      </div>
    )
  }

  const isAgent = message.senderType === 'agent'

  return (
    <div className="px-6 py-3 hover:bg-gray-50/50 dark:hover:bg-gray-800/50 transition-colors group/msg relative">
      {/* Mobile action trigger */}
      {!showActions && (
        <button
          className="absolute right-2 top-3 p-1.5 rounded-md text-gray-400 dark:text-gray-500 active:bg-gray-100 dark:active:bg-gray-700 md:hidden"
          onClick={(e) => {
            e.stopPropagation()
            setShowActions(true)
          }}
          aria-label={t('chat.actions')}
        >
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
            <path d="M6 10a2 2 0 11-4 0 2 2 0 014 0zM12 10a2 2 0 11-4 0 2 2 0 014 0zM16 12a2 2 0 100-4 2 2 0 000 4z" />
          </svg>
        </button>
      )}
      {/* Action buttons */}
      <div
        ref={actionsRef}
        className={`absolute right-4 top-2 flex items-center gap-1 transition-all ${showActions ? 'opacity-100' : 'opacity-0 pointer-events-none md:group-hover/msg:opacity-100 md:group-hover/msg:pointer-events-auto'}`}
      >
        <div className="relative">
          <button
            onClick={() => setShowEmojiPicker(!showEmojiPicker)}
            className="p-1 rounded-md text-gray-400 dark:text-gray-500 hover:text-amber-500 dark:hover:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/30"
            title={t('chat.addReaction')}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </button>
          {showEmojiPicker && (
            <div className="absolute right-0 top-8 z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg p-1.5 flex gap-0.5">
              {REACTION_EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  onClick={() => {
                    toggleReaction(message.id, emoji).catch(() => toast.error(t('error.generic')))
                    setShowEmojiPicker(false)
                    setShowActions(false)
                  }}
                  className="w-8 h-8 flex items-center justify-center text-lg hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
                >
                  {emoji}
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          onClick={() => { setReplyTo(message); setShowActions(false) }}
          className="p-1 rounded-md text-gray-400 dark:text-gray-500 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30"
          title={t('chat.reply')}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
          </svg>
        </button>
        {isOwnMessage && !isEditing && (
          <>
            <button
              onClick={handleEdit}
              className="p-1 rounded-md text-gray-400 dark:text-gray-500 hover:text-green-600 dark:hover:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/30"
              title={t('chat.editMessage')}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </button>
            {confirmingDelete ? (
              <span className="flex items-center gap-1 bg-red-50 dark:bg-red-900/30 rounded-md px-1.5 py-0.5">
                <span className="text-xs text-red-600 dark:text-red-400 whitespace-nowrap">{t('chat.confirmDeleteMessage')}</span>
                <button
                  onClick={handleDelete}
                  className="px-1.5 py-0.5 text-xs font-medium text-white bg-red-600 hover:bg-red-700 rounded"
                >
                  {t('delete')}
                </button>
                <button
                  onClick={() => setConfirmingDelete(false)}
                  className="px-1.5 py-0.5 text-xs font-medium text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
                >
                  {t('cancel')}
                </button>
              </span>
            ) : (
              <button
                onClick={() => setConfirmingDelete(true)}
                className="p-1 rounded-md text-gray-400 dark:text-gray-500 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30"
                title={t('chat.deleteMessage')}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            )}
          </>
        )}
      </div>

      <div className="flex items-start space-x-3">
        {/* Avatar */}
        <div
          className={`
            flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center
            ${isAgent
              ? `bg-gradient-to-br ${getAvatarGradient(message.senderName)}`
              : 'bg-gradient-to-br from-gray-400 to-gray-500'
            }
          `}
        >
          <span className="text-sm font-medium text-white">
            {message.senderName.charAt(0).toUpperCase()}
          </span>
        </div>

        {/* Message content */}
        <div className="flex-1 min-w-0">
          {/* Sender and time */}
          <div className="flex items-center space-x-2 mb-1">
            <span className="font-semibold text-gray-900 dark:text-gray-100 text-sm">{message.senderName}</span>
            {isAgent && (
              <span className="px-1.5 py-0.5 text-[10px] font-medium bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 rounded">
                Agent
              </span>
            )}
            <span className="text-xs text-gray-400 dark:text-gray-500">
              {new Date(message.createdAt).toLocaleString(i18n.language, {
                month: 'numeric',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
            {message.updatedAt && (
              <button
                className="text-xs text-gray-400 dark:text-gray-500 italic hover:text-blue-500 dark:hover:text-blue-400 cursor-pointer"
                onClick={async () => {
                  if (showEditHistory) {
                    setShowEditHistory(false)
                    return
                  }
                  setLoadingHistory(true)
                  setShowEditHistory(true)
                  try {
                    const res = await api.get<{ id: string; previousContent: string; editedAt: string }[]>(`/messages/${message.id}/history`)
                    if (res.ok && res.data) setEditHistory(res.data)
                  } catch { /* ignore */ }
                  setLoadingHistory(false)
                }}
              >
                {t('chat.messageEdited')}
              </button>
            )}
          </div>

          {/* Replied message quote */}
          {repliedMessage && (
            <div className="mb-1.5 pl-3 border-l-2 border-blue-300 dark:border-blue-600 bg-blue-50/50 dark:bg-blue-900/20 rounded-r-md py-1 pr-2">
              <span className="text-xs font-medium text-blue-600 dark:text-blue-400">{repliedMessage.senderName}</span>
              <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{repliedMessage.content.slice(0, 100)}</p>
            </div>
          )}

          {/* Message content: edit mode or display */}
          {isEditing ? (
            <div className="mt-1">
              <textarea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleEditSave()
                  if (e.key === 'Escape') setIsEditing(false)
                }}
                className="w-full p-2 border border-blue-300 dark:border-blue-600 dark:bg-gray-700 dark:text-gray-100 rounded-md text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                rows={3}
                autoFocus
                disabled={isSaving}
              />
              <div className="flex items-center gap-2 mt-1">
                <button
                  onClick={handleEditSave}
                  disabled={isSaving || !editContent.trim()}
                  className="px-3 py-1 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded disabled:opacity-50"
                >
                  {isSaving ? t('settings.saving') : t('save')}
                </button>
                <button
                  onClick={() => setIsEditing(false)}
                  disabled={isSaving}
                  className="px-3 py-1 text-xs font-medium text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
                >
                  {t('cancel')}
                </button>
                <span className="text-xs text-gray-400 dark:text-gray-500">Esc {t('cancel')}, Cmd+Enter {t('save')}</span>
              </div>
            </div>
          ) : chunkGroups ? (
            <ChunkGroupRenderer groups={chunkGroups} />
          ) : (
            <div className="prose prose-sm dark:prose-invert max-w-none">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeHighlight]}
                components={{
                  code({ className, children, ...props }) {
                    const match = /language-(\w+)/.exec(className || '')
                    const isBlock = match || (typeof children === 'string' && children.includes('\n'))
                    const codeText = String(children).replace(/\n$/, '')
                    return isBlock ? (
                      <div className="relative group/code">
                        <div className="absolute top-0 right-0 flex items-center gap-1 px-1 py-1">
                          {match && (
                            <span className="px-1.5 py-0.5 text-xs text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-700 rounded">
                              {match[1]}
                            </span>
                          )}
                          <span className="opacity-0 group-hover/code:opacity-100 transition-opacity">
                            <CopyButton text={codeText} />
                          </span>
                        </div>
                        <pre className={className}>
                          <code className={className} {...props}>
                            {children}
                          </code>
                        </pre>
                      </div>
                    ) : (
                      <code className="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 rounded text-sm" {...props}>
                        {children}
                      </code>
                    )
                  },
                  a({ children, ...props }) {
                    return (
                      <a
                        className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 underline"
                        target="_blank"
                        rel="noopener noreferrer"
                        {...props}
                      >
                        {children}
                      </a>
                    )
                  },
                  table({ children, ...props }) {
                    return (
                      <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700" {...props}>
                          {children}
                        </table>
                      </div>
                    )
                  },
                }}
              >
                {message.content}
              </ReactMarkdown>
            </div>
          )}

          {/* Edit history */}
          {showEditHistory && (
            <div className="mt-2 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
              <div className="px-3 py-1.5 bg-gray-50 dark:bg-gray-700/50 text-xs font-medium text-gray-600 dark:text-gray-400">
                {t('chat.editHistory')}
              </div>
              {loadingHistory ? (
                <div className="px-3 py-2 text-xs text-gray-400 dark:text-gray-500">{t('loading')}</div>
              ) : editHistory.length === 0 ? (
                <div className="px-3 py-2 text-xs text-gray-400 dark:text-gray-500">{t('chat.editHistoryEmpty')}</div>
              ) : (
                <div className="divide-y divide-gray-100 dark:divide-gray-700 max-h-48 overflow-y-auto">
                  {editHistory.map((edit) => (
                    <div key={edit.id} className="px-3 py-2">
                      <div className="text-[10px] text-gray-400 dark:text-gray-500 mb-0.5">
                        {new Date(edit.editedAt).toLocaleString(i18n.language, {
                          month: 'numeric',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                        })}
                      </div>
                      <p className="text-xs text-gray-600 dark:text-gray-400 whitespace-pre-wrap break-words">{edit.previousContent}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Attachments */}
          {message.attachments && message.attachments.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {message.attachments.map((attachment) => {
                const isImage = attachment.mimeType.startsWith('image/')
                return isImage ? (
                  <button
                    key={attachment.id}
                    onClick={() => setLightboxUrl(attachment.url)}
                    className="block max-w-xs cursor-zoom-in"
                  >
                    <img
                      src={attachment.url}
                      alt={attachment.filename}
                      className="rounded-lg border border-gray-200 dark:border-gray-700 max-h-60 object-contain hover:brightness-90 transition-[filter]"
                      loading="lazy"
                    />
                  </button>
                ) : (
                  <a
                    key={attachment.id}
                    href={attachment.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center space-x-2 px-3 py-2 bg-gray-50 dark:bg-gray-700/50 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors border border-gray-100 dark:border-gray-700 max-w-xs"
                  >
                    <FileTypeIcon mimeType={attachment.mimeType} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{attachment.filename}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {attachment.size < 1024 * 1024
                          ? `${(attachment.size / 1024).toFixed(1)} KB`
                          : `${(attachment.size / 1024 / 1024).toFixed(1)} MB`}
                      </p>
                    </div>
                    <svg className="w-4 h-4 text-gray-400 dark:text-gray-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                  </a>
                )
              })}
            </div>
          )}

          {/* Reactions display */}
          {message.reactions && message.reactions.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {message.reactions.map((reaction) => {
                const hasReacted = currentUser && reaction.userIds.includes(currentUser.id)
                return (
                  <button
                    key={reaction.emoji}
                    onClick={() => toggleReaction(message.id, reaction.emoji).catch(() => toast.error(t('error.generic')))}
                    title={reaction.usernames.join(', ')}
                    className={`
                      inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs transition-colors
                      ${hasReacted
                        ? 'bg-blue-100 dark:bg-blue-900/40 border border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-300'
                        : 'bg-gray-100 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600'
                      }
                    `}
                  >
                    <span>{reaction.emoji}</span>
                    <span className="font-medium">{reaction.userIds.length}</span>
                  </button>
                )
              })}
            </div>
          )}

          {/* Image lightbox */}
          {lightboxUrl && (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
              onClick={() => setLightboxUrl(null)}
            >
              <div className="relative max-w-[90vw] max-h-[90vh]">
                <img src={lightboxUrl} alt={t('chat.imagePreview')} className="max-w-full max-h-[90vh] rounded-lg shadow-2xl" />
                <a
                  href={lightboxUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="absolute top-2 right-12 p-2 rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors"
                  title={t('chat.openOriginal')}
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </a>
                <button
                  onClick={() => setLightboxUrl(null)}
                  className="absolute top-2 right-2 p-2 rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
})
