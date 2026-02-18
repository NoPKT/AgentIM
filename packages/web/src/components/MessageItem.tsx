import { useState, useCallback, useMemo, useRef, useEffect, memo } from 'react'
import { useTranslation } from 'react-i18next'
import type { Message } from '@agentim/shared'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'

// Allow class attributes on code/span elements for syntax highlighting
const sanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [...(defaultSchema.attributes?.code ?? []), 'className'],
    span: [...(defaultSchema.attributes?.span ?? []), 'className'],
  },
}
import { useChatStore } from '../stores/chat.js'
import { useAuthStore } from '../stores/auth.js'
import { toast } from '../stores/toast.js'
import { api } from '../lib/api.js'
import { getAvatarGradient } from '../lib/avatars.js'
import { groupChunks, ChunkGroupRenderer } from './ChunkBlocks.js'
import { Textarea } from './ui.js'
import {
  VideoIcon,
  MusicNoteIcon,
  DocumentIcon,
  ArchiveIcon,
  PaperClipIcon,
  DownloadIcon,
  ExternalLinkIcon,
  CloseIcon,
  DotsHorizontalIcon,
  SmileFaceIcon,
  ReplyIcon,
  PencilIcon,
  TrashIcon,
} from './icons.js'
import 'highlight.js/styles/github.css'

interface MessageItemProps {
  message: Message
}

const REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🎉']

// ─── Sub-components ───

function FileTypeIcon({ mimeType }: { mimeType: string }) {
  if (mimeType.startsWith('video/')) {
    return <VideoIcon className="w-5 h-5 text-purple-500 flex-shrink-0" />
  }
  if (mimeType.startsWith('audio/')) {
    return <MusicNoteIcon className="w-5 h-5 text-green-500 flex-shrink-0" />
  }
  if (mimeType === 'application/pdf') {
    return <DocumentIcon className="w-5 h-5 text-red-500 flex-shrink-0" />
  }
  if (
    mimeType.includes('zip') ||
    mimeType.includes('tar') ||
    mimeType.includes('compress') ||
    mimeType.includes('archive')
  ) {
    return <ArchiveIcon className="w-5 h-5 text-yellow-600 flex-shrink-0" />
  }
  return <PaperClipIcon className="w-5 h-5 text-text-muted flex-shrink-0" />
}

function ImageWithSkeleton({ src, alt, className }: { src: string; alt: string; className?: string }) {
  const [loaded, setLoaded] = useState(false)
  return (
    <div className="relative">
      {!loaded && (
        <div className="rounded-lg bg-surface-hover max-h-60 w-48 h-32 animate-pulse" />
      )}
      <img
        src={src}
        alt={alt}
        className={`${className ?? ''} ${loaded ? '' : 'absolute inset-0 opacity-0'}`}
        loading="lazy"
        onLoad={() => setLoaded(true)}
      />
    </div>
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
      className="px-2 py-1 text-xs text-text-secondary hover:text-text-primary bg-surface-hover hover:bg-gray-200 dark:hover:bg-gray-600 rounded transition-colors"
      title={t('copy')}
      aria-label={t('copy')}
    >
      {copied ? t('copied') : t('copy')}
    </button>
  )
}

interface AttachmentListProps {
  attachments: NonNullable<Message['attachments']>
  onImageClick: (url: string) => void
}

function AttachmentList({ attachments, onImageClick }: AttachmentListProps) {
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {attachments.map((attachment) => {
        const isImage = attachment.mimeType.startsWith('image/')
        return isImage ? (
          <button
            key={attachment.id}
            onClick={() => onImageClick(attachment.url)}
            className="block max-w-xs cursor-zoom-in"
          >
            <ImageWithSkeleton
              src={attachment.url}
              alt={attachment.filename}
              className="rounded-lg border border-border max-h-60 object-contain hover:brightness-90 transition-[filter]"
            />
          </button>
        ) : (
          <a
            key={attachment.id}
            href={attachment.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center space-x-2 px-3 py-2 bg-surface-secondary rounded-lg hover:bg-surface-hover transition-colors border border-border max-w-xs"
          >
            <FileTypeIcon mimeType={attachment.mimeType} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-text-primary truncate">
                {attachment.filename}
              </p>
              <p className="text-xs text-text-secondary">
                {attachment.size < 1024 * 1024
                  ? `${(attachment.size / 1024).toFixed(1)} KB`
                  : `${(attachment.size / 1024 / 1024).toFixed(1)} MB`}
              </p>
            </div>
            <DownloadIcon className="w-4 h-4 text-text-muted flex-shrink-0" />
          </a>
        )
      })}
    </div>
  )
}

interface ReactionBarProps {
  reactions: NonNullable<Message['reactions']>
  currentUserId: string | undefined
  onToggle: (emoji: string) => void
}

function ReactionBar({ reactions, currentUserId, onToggle }: ReactionBarProps) {
  return (
    <div className="mt-1.5 flex flex-wrap gap-1">
      {reactions.map((reaction) => {
        const hasReacted = currentUserId && reaction.userIds.includes(currentUserId)
        return (
          <button
            key={reaction.emoji}
            onClick={() => onToggle(reaction.emoji)}
            title={reaction.usernames.join(', ')}
            className={`
              inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs transition-colors
              ${
                hasReacted
                  ? 'bg-blue-100 dark:bg-blue-900/40 border border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-300'
                  : 'bg-surface-hover border border-border text-text-secondary hover:bg-gray-200 dark:hover:bg-gray-600'
              }
            `}
          >
            <span>{reaction.emoji}</span>
            <span className="font-medium">{reaction.userIds.length}</span>
          </button>
        )
      })}
    </div>
  )
}

// ─── Main Component ───

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
  const [editHistory, setEditHistory] = useState<
    { id: string; previousContent: string; editedAt: string }[]
  >([])
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

  const isOwnMessage =
    currentUser && message.senderId === currentUser.id && message.senderType === 'user'

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
          <div className="px-4 py-1.5 bg-surface-hover rounded-full">
            <p className="text-xs text-text-secondary text-center">
              {message.content}
            </p>
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
          className="absolute right-2 top-3 p-1.5 rounded-md text-text-muted active:bg-surface-hover md:hidden"
          onClick={(e) => {
            e.stopPropagation()
            setShowActions(true)
          }}
          aria-label={t('chat.actions')}
        >
          <DotsHorizontalIcon className="w-4 h-4" aria-hidden="true" />
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
            className="p-1 rounded-md text-text-muted hover:text-amber-500 dark:hover:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/30"
            title={t('chat.addReaction')}
            aria-label={t('chat.addReaction')}
          >
            <SmileFaceIcon className="w-4 h-4" />
          </button>
          {showEmojiPicker && (
            <div className="absolute right-0 top-8 z-dropdown bg-surface border border-border rounded-lg shadow-lg p-1.5 flex gap-0.5">
              {REACTION_EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  onClick={() => {
                    toggleReaction(message.id, emoji).catch(() => toast.error(t('error.generic')))
                    setShowEmojiPicker(false)
                    setShowActions(false)
                  }}
                  className="w-8 h-8 flex items-center justify-center text-lg hover:bg-surface-hover rounded transition-colors"
                >
                  {emoji}
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          onClick={() => {
            setReplyTo(message)
            setShowActions(false)
          }}
          className="p-1 rounded-md text-text-muted hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30"
          title={t('chat.reply')}
          aria-label={t('chat.reply')}
        >
          <ReplyIcon className="w-4 h-4" />
        </button>
        {isOwnMessage && !isEditing && (
          <>
            <button
              onClick={handleEdit}
              className="p-1 rounded-md text-text-muted hover:text-green-600 dark:hover:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/30"
              title={t('chat.editMessage')}
              aria-label={t('chat.editMessage')}
            >
              <PencilIcon className="w-4 h-4" />
            </button>
            {confirmingDelete ? (
              <span className="flex items-center gap-1 bg-red-50 dark:bg-red-900/30 rounded-md px-1.5 py-0.5">
                <span className="text-xs text-red-600 dark:text-red-400 whitespace-nowrap">
                  {t('chat.confirmDeleteMessage')}
                </span>
                <button
                  onClick={handleDelete}
                  className="px-1.5 py-0.5 text-xs font-medium text-white bg-red-600 hover:bg-red-700 rounded"
                >
                  {t('delete')}
                </button>
                <button
                  onClick={() => setConfirmingDelete(false)}
                  className="px-1.5 py-0.5 text-xs font-medium text-text-secondary hover:text-text-primary"
                >
                  {t('cancel')}
                </button>
              </span>
            ) : (
              <button
                onClick={() => setConfirmingDelete(true)}
                className="p-1 rounded-md text-text-muted hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30"
                title={t('chat.deleteMessage')}
                aria-label={t('chat.deleteMessage')}
              >
                <TrashIcon className="w-4 h-4" />
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
            ${
              isAgent
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
            <span className="font-semibold text-text-primary text-sm">
              {message.senderName}
            </span>
            {isAgent && (
              <span className="px-1.5 py-0.5 text-[10px] font-medium bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 rounded">
                {t('agents')}
              </span>
            )}
            <span className="text-xs text-text-muted">
              {new Date(message.createdAt).toLocaleString(i18n.language, {
                month: 'numeric',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
            {message.updatedAt && (
              <button
                className="text-xs text-text-muted italic hover:text-accent cursor-pointer"
                onClick={async () => {
                  if (showEditHistory) {
                    setShowEditHistory(false)
                    return
                  }
                  setLoadingHistory(true)
                  setShowEditHistory(true)
                  try {
                    const res = await api.get<
                      { id: string; previousContent: string; editedAt: string }[]
                    >(`/messages/${message.id}/history`)
                    if (res.ok && res.data) setEditHistory(res.data)
                  } catch {
                    /* ignore */
                  }
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
              <span className="text-xs font-medium text-blue-600 dark:text-blue-400">
                {repliedMessage.senderName}
              </span>
              <p className="text-xs text-text-secondary truncate">
                {repliedMessage.content.slice(0, 100)}
              </p>
            </div>
          )}

          {/* Message body: edit mode or display */}
          {isEditing ? (
            <div className="mt-1">
              <Textarea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleEditSave()
                  if (e.key === 'Escape') setIsEditing(false)
                }}
                rows={3}
                autoFocus
                disabled={isSaving}
              />
              <div className="flex items-center gap-2 mt-1">
                <button
                  onClick={handleEditSave}
                  disabled={isSaving || !editContent.trim()}
                  className="px-3 py-1 text-xs font-medium text-white bg-accent hover:bg-accent-hover rounded disabled:opacity-50"
                >
                  {isSaving ? t('settings.saving') : t('save')}
                </button>
                <button
                  onClick={() => setIsEditing(false)}
                  disabled={isSaving}
                  className="px-3 py-1 text-xs font-medium text-text-secondary hover:text-text-primary"
                >
                  {t('cancel')}
                </button>
                <span className="text-xs text-text-muted">
                  Esc {t('cancel')}, Cmd+Enter {t('save')}
                </span>
              </div>
            </div>
          ) : chunkGroups ? (
            <ChunkGroupRenderer groups={chunkGroups} />
          ) : (
            <div className="prose prose-sm dark:prose-invert max-w-none">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[[rehypeSanitize, sanitizeSchema], rehypeHighlight]}
                components={{
                  code({ className, children, ...props }) {
                    const match = /language-(\w+)/.exec(className || '')
                    const isBlock =
                      match || (typeof children === 'string' && children.includes('\n'))
                    const codeText = String(children).replace(/\n$/, '')
                    return isBlock ? (
                      <div className="relative group/code">
                        <div className="absolute top-0 right-0 flex items-center gap-1 px-1 py-1">
                          {match && (
                            <span className="px-1.5 py-0.5 text-xs text-text-secondary bg-surface-hover rounded">
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
                      <code
                        className="px-1.5 py-0.5 bg-surface-hover rounded text-sm"
                        {...props}
                      >
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
                        <table
                          className="min-w-full divide-y divide-border"
                          {...props}
                        >
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
            <div className="mt-2 border border-border rounded-lg overflow-hidden">
              <div className="px-3 py-1.5 bg-surface-secondary text-xs font-medium text-text-secondary">
                {t('chat.editHistory')}
              </div>
              {loadingHistory ? (
                <div className="px-3 py-2 text-xs text-text-muted">
                  {t('loading')}
                </div>
              ) : editHistory.length === 0 ? (
                <div className="px-3 py-2 text-xs text-text-muted">
                  {t('chat.editHistoryEmpty')}
                </div>
              ) : (
                <div className="divide-y divide-border max-h-48 overflow-y-auto">
                  {editHistory.map((edit) => (
                    <div key={edit.id} className="px-3 py-2">
                      <div className="text-[10px] text-text-muted mb-0.5">
                        {new Date(edit.editedAt).toLocaleString(i18n.language, {
                          month: 'numeric',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                        })}
                      </div>
                      <p className="text-xs text-text-secondary whitespace-pre-wrap break-words">
                        {edit.previousContent}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Attachments */}
          {message.attachments && message.attachments.length > 0 && (
            <AttachmentList
              attachments={message.attachments}
              onImageClick={setLightboxUrl}
            />
          )}

          {/* Reactions */}
          {message.reactions && message.reactions.length > 0 && (
            <ReactionBar
              reactions={message.reactions}
              currentUserId={currentUser?.id}
              onToggle={(emoji) =>
                toggleReaction(message.id, emoji).catch(() => toast.error(t('error.generic')))
              }
            />
          )}

          {/* Image lightbox */}
          {lightboxUrl && (
            <div
              className="fixed inset-0 z-modal flex items-center justify-center bg-black/70 backdrop-blur-sm"
              onClick={() => setLightboxUrl(null)}
            >
              <div className="relative max-w-[90vw] max-h-[90vh]">
                <img
                  src={lightboxUrl}
                  alt={t('chat.imagePreview')}
                  className="max-w-full max-h-[90vh] rounded-lg shadow-2xl"
                />
                <a
                  href={lightboxUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="absolute top-2 right-12 p-2 rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors"
                  title={t('chat.openOriginal')}
                  aria-label={t('chat.openOriginal')}
                >
                  <ExternalLinkIcon className="w-5 h-5" aria-hidden="true" />
                </a>
                <button
                  onClick={() => setLightboxUrl(null)}
                  className="absolute top-2 right-2 p-2 rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors"
                  aria-label={t('close')}
                >
                  <CloseIcon className="w-5 h-5" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
})
