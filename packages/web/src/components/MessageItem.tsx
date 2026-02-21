import { useState, useMemo, memo } from 'react'
import { useTranslation } from 'react-i18next'
import type { Message } from '@agentim/shared'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import rehypeSanitize from 'rehype-sanitize'
import { markdownSanitizeSchema } from '../lib/markdown.js'
import { useChatStore } from '../stores/chat.js'
import { getAvatarGradient } from '../lib/avatars.js'
import { groupChunks, ChunkGroupRenderer } from './ChunkBlocks.js'
import { twMerge } from 'tailwind-merge'
import { Textarea } from './ui.js'
import { useMessageActions } from '../hooks/useMessageActions.js'
import { useUploadUrls } from '../hooks/useUploadUrl.js'
import {
  VideoIcon,
  MusicNoteIcon,
  DocumentIcon,
  ArchiveIcon,
  PaperClipIcon,
  DownloadIcon,
  DotsHorizontalIcon,
  SmileFaceIcon,
  ReplyIcon,
  PencilIcon,
  TrashIcon,
} from './icons.js'

interface MessageItemProps {
  message: Message
  showHeader?: boolean
  onImageClick?: (url: string) => void
}

const REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🎉']

// ─── Sub-components ───

function FileTypeIcon({ mimeType }: { mimeType: string }) {
  if (mimeType.startsWith('video/')) {
    return <VideoIcon className="w-5 h-5 text-file-video flex-shrink-0" />
  }
  if (mimeType.startsWith('audio/')) {
    return <MusicNoteIcon className="w-5 h-5 text-file-audio flex-shrink-0" />
  }
  if (mimeType === 'application/pdf') {
    return <DocumentIcon className="w-5 h-5 text-danger-text flex-shrink-0" />
  }
  if (
    mimeType.includes('zip') ||
    mimeType.includes('tar') ||
    mimeType.includes('compress') ||
    mimeType.includes('archive')
  ) {
    return <ArchiveIcon className="w-5 h-5 text-warning-text flex-shrink-0" />
  }
  return <PaperClipIcon className="w-5 h-5 text-text-muted flex-shrink-0" />
}

function ImageWithSkeleton({
  src,
  alt,
  className,
}: {
  src: string
  alt: string
  className?: string
}) {
  const [loaded, setLoaded] = useState(false)
  return (
    <div className="relative min-w-32 max-w-full min-h-32">
      {!loaded && <div className="absolute inset-0 rounded-lg bg-surface-hover animate-pulse" />}
      <img
        src={src}
        alt={alt}
        className={twMerge(
          'transition-opacity duration-300',
          loaded ? 'opacity-100' : 'opacity-0',
          className,
        )}
        loading="lazy"
        onLoad={() => setLoaded(true)}
      />
    </div>
  )
}

function CopyButton({ text }: { text: string }) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)

  return (
    <button
      onClick={async () => {
        await navigator.clipboard.writeText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      }}
      className="px-2 py-1 text-xs text-text-secondary hover:text-text-primary bg-surface-hover rounded transition-colors"
      title={t('common.copy')}
      aria-label={t('common.copy')}
    >
      {copied ? t('common.copied') : t('common.copy')}
    </button>
  )
}

interface AttachmentListProps {
  attachments: NonNullable<Message['attachments']>
  onImageClick: (url: string) => void
}

function AttachmentList({ attachments, onImageClick }: AttachmentListProps) {
  // Get auth-gated URLs for all attachments in one hook call (avoids hook-in-loop violation).
  // Raw URLs (attachment.url) are still passed to onImageClick so the lightbox can index them.
  const authUrls = useUploadUrls(attachments.map((a) => a.url))

  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {attachments.map((attachment, i) => {
        const isImage = attachment.mimeType.startsWith('image/')
        const authUrl = authUrls[i]
        return isImage ? (
          <button
            key={attachment.id}
            onClick={() => onImageClick(attachment.url)}
            className="block max-w-xs cursor-zoom-in"
          >
            <ImageWithSkeleton
              src={authUrl}
              alt={attachment.filename}
              className="rounded-lg border border-border max-h-60 object-contain hover:brightness-90 transition-[filter]"
            />
          </button>
        ) : (
          <a
            key={attachment.id}
            href={authUrl}
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
              inline-flex items-center gap-1 px-2.5 py-1.5 md:px-2 md:py-0.5 rounded-full text-xs transition-colors
              ${
                hasReacted
                  ? 'bg-info-muted border border-info-border text-info-text'
                  : 'bg-surface-hover border border-border text-text-secondary hover:bg-surface-hover'
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

export const MessageItem = memo(function MessageItem({
  message,
  showHeader = true,
  onImageClick,
}: MessageItemProps) {
  const { t, i18n } = useTranslation()
  const messages = useChatStore((s) => s.messages)
  const actions = useMessageActions(message)

  // Find the replied-to message
  const repliedMessage = message.replyToId
    ? (messages.get(message.roomId) ?? []).find((m) => m.id === message.replyToId)
    : null

  // Group chunks for agent messages that have structured data
  const chunkGroups = useMemo(
    () => (message.chunks?.length ? groupChunks(message.chunks) : null),
    [message.chunks],
  )

  // System messages
  if (message.senderType === 'system') {
    return (
      <div className="px-6 py-2">
        <div className="flex justify-center">
          <div className="px-4 py-1.5 bg-surface-hover rounded-full">
            <p className="text-xs text-text-secondary text-center">{message.content}</p>
          </div>
        </div>
      </div>
    )
  }

  const isAgent = message.senderType === 'agent'

  return (
    <div
      className={`px-6 ${showHeader ? 'py-3' : 'py-0.5'} hover:bg-surface-hover/50 transition-colors group/msg relative`}
    >
      {/* Mobile action trigger */}
      {!actions.showActions && (
        <button
          className="absolute right-1 top-2 p-3 rounded-md text-text-muted active:bg-surface-hover md:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          onClick={(e) => {
            e.stopPropagation()
            actions.setShowActions(true)
          }}
          aria-label={t('chat.actions')}
        >
          <DotsHorizontalIcon className="w-4 h-4" aria-hidden="true" />
        </button>
      )}

      {/* Action buttons */}
      <div
        ref={actions.actionsRef}
        className={`absolute right-4 top-2 flex items-center gap-1 transition-all ${actions.showActions ? 'opacity-100' : 'opacity-0 pointer-events-none md:group-hover/msg:opacity-100 md:group-hover/msg:pointer-events-auto md:focus-within:opacity-100 md:focus-within:pointer-events-auto'}`}
      >
        <div className="relative">
          <button
            onClick={() => actions.setShowEmojiPicker(!actions.showEmojiPicker)}
            className="p-2.5 md:p-1 rounded-md text-text-muted hover:text-warning-text hover:bg-warning-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            title={t('chat.addReaction')}
            aria-label={t('chat.addReaction')}
          >
            <SmileFaceIcon className="w-4 h-4" />
          </button>
          {actions.showEmojiPicker && (
            <div className="absolute right-0 top-8 z-dropdown bg-surface border border-border rounded-lg shadow-lg p-1.5 flex gap-0.5">
              {REACTION_EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  onClick={() => actions.handleReaction(emoji)}
                  className="w-10 h-10 md:w-8 md:h-8 flex items-center justify-center text-lg hover:bg-surface-hover rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  {emoji}
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          onClick={actions.handleReply}
          className="p-2.5 md:p-1 rounded-md text-text-muted hover:text-info-text hover:bg-info-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          title={t('chat.reply')}
          aria-label={t('chat.reply')}
        >
          <ReplyIcon className="w-4 h-4" />
        </button>
        {actions.isOwnMessage && !actions.isEditing && (
          <>
            <button
              onClick={actions.handleEdit}
              className="p-2.5 md:p-1 rounded-md text-text-muted hover:text-success-text hover:bg-success-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              title={t('chat.editMessage')}
              aria-label={t('chat.editMessage')}
            >
              <PencilIcon className="w-4 h-4" />
            </button>
            {actions.confirmingDelete ? (
              <span className="flex items-center gap-1 bg-danger-subtle rounded-md px-1.5 py-0.5">
                <span className="text-xs text-danger-text whitespace-nowrap">
                  {t('chat.confirmDeleteMessage')}
                </span>
                <button
                  onClick={actions.handleDelete}
                  className="px-1.5 py-0.5 text-xs font-medium text-white bg-danger hover:bg-danger-hover rounded"
                >
                  {t('common.delete')}
                </button>
                <button
                  onClick={() => actions.setConfirmingDelete(false)}
                  className="px-1.5 py-0.5 text-xs font-medium text-text-secondary hover:text-text-primary"
                >
                  {t('common.cancel')}
                </button>
              </span>
            ) : (
              <button
                onClick={() => actions.setConfirmingDelete(true)}
                className="p-2.5 md:p-1 rounded-md text-text-muted hover:text-danger-text hover:bg-danger-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
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
        {/* Avatar — hidden for grouped messages, placeholder keeps alignment */}
        {showHeader ? (
          <div
            className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center bg-gradient-to-br ${getAvatarGradient(message.senderName)}`}
          >
            <span className="text-sm font-medium text-white">
              {message.senderName.charAt(0).toUpperCase()}
            </span>
          </div>
        ) : (
          <div className="flex-shrink-0 w-8" />
        )}

        {/* Message content */}
        <div className="flex-1 min-w-0">
          {/* Sender and time — only for first message in group */}
          {showHeader && (
            <div className="flex items-center space-x-2 mb-1">
              <span className="font-semibold text-text-primary text-sm">{message.senderName}</span>
              {isAgent && (
                <span className="px-1.5 py-0.5 text-[10px] font-medium bg-info-muted text-info-text rounded">
                  {t('agent.agents')}
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
                  className="text-xs text-text-muted italic hover:text-accent cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded"
                  onClick={actions.toggleEditHistory}
                >
                  {t('chat.messageEdited')}
                </button>
              )}
            </div>
          )}

          {/* Replied message quote */}
          {repliedMessage && (
            <div className="mb-1.5 pl-3 border-l-2 border-info-border bg-info-subtle/50 rounded-r-md py-1 pr-2">
              <span className="text-xs font-medium text-info-text">
                {repliedMessage.senderName}
              </span>
              <p className="text-xs text-text-secondary truncate">
                {repliedMessage.content.slice(0, 100)}
              </p>
            </div>
          )}

          {/* Message body: edit mode or display */}
          {actions.isEditing ? (
            <div className="mt-1">
              <Textarea
                value={actions.editContent}
                onChange={(e) => actions.setEditContent(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) actions.handleEditSave()
                  if (e.key === 'Escape') actions.handleEditCancel()
                }}
                rows={3}
                autoFocus
                disabled={actions.isSaving}
              />
              <div className="flex items-center gap-2 mt-1">
                <button
                  onClick={actions.handleEditSave}
                  disabled={actions.isSaving || !actions.editContent.trim()}
                  className="px-3 py-1 text-xs font-medium text-white bg-accent hover:bg-accent-hover rounded disabled:opacity-50"
                >
                  {actions.isSaving ? t('settings.saving') : t('common.save')}
                </button>
                <button
                  onClick={actions.handleEditCancel}
                  disabled={actions.isSaving}
                  className="px-3 py-1 text-xs font-medium text-text-secondary hover:text-text-primary"
                >
                  {t('common.cancel')}
                </button>
                <span className="text-xs text-text-muted">
                  Esc {t('common.cancel')}, Cmd+Enter {t('common.save')}
                </span>
              </div>
            </div>
          ) : chunkGroups ? (
            <ChunkGroupRenderer groups={chunkGroups} />
          ) : (
            <div className="prose prose-sm dark:prose-invert max-w-none">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[[rehypeSanitize, markdownSanitizeSchema], rehypeHighlight]}
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
                      <code className="px-1.5 py-0.5 bg-surface-hover rounded text-sm" {...props}>
                        {children}
                      </code>
                    )
                  },
                  a({ children, ...props }) {
                    return (
                      <a
                        className="text-accent hover:text-accent-hover underline"
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
                        <table className="min-w-full divide-y divide-border" {...props}>
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
          {actions.showEditHistory && (
            <div className="mt-2 border border-border rounded-lg overflow-hidden">
              <div className="px-3 py-1.5 bg-surface-secondary text-xs font-medium text-text-secondary">
                {t('chat.editHistory')}
              </div>
              {actions.loadingHistory ? (
                <div className="px-3 py-2 text-xs text-text-muted">{t('common.loading')}</div>
              ) : actions.editHistory.length === 0 ? (
                <div className="px-3 py-2 text-xs text-text-muted">
                  {t('chat.editHistoryEmpty')}
                </div>
              ) : (
                <div className="divide-y divide-border max-h-48 overflow-y-auto">
                  {actions.editHistory.map((edit) => (
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
              onImageClick={onImageClick ?? (() => {})}
            />
          )}

          {/* Reactions */}
          {message.reactions && message.reactions.length > 0 && (
            <ReactionBar
              reactions={message.reactions}
              currentUserId={actions.currentUser?.id}
              onToggle={actions.handleReaction}
            />
          )}
        </div>
      </div>
    </div>
  )
})
