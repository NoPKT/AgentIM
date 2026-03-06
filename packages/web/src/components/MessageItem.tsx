import { useState, useMemo, useEffect, useRef, memo } from 'react'
import { useTranslation } from 'react-i18next'
import type { Message } from '@agentim/shared'
import { LazyMarkdown } from './LazyMarkdown.js'
import { useChatStore } from '../stores/chat.js'
import { useAgentStore } from '../stores/agents.js'
import { getAvatarGradient } from '../lib/avatars.js'
import { agentTypeIcons, agentGradients } from '../lib/agentConfig.js'
import { groupChunks, ChunkGroupRenderer } from './ChunkBlocks.js'
import { MediaMessage } from './MediaMessage.js'
import { twMerge } from 'tailwind-merge'
import { useMessageActions } from '../hooks/useMessageActions.js'
import { useUploadUrls } from '../hooks/useUploadUrl.js'
import { useWorkspaceStore } from '../stores/workspace.js'
import {
  VideoIcon,
  MusicNoteIcon,
  DocumentIcon,
  ArchiveIcon,
  PaperClipIcon,
  DownloadIcon,
  DotsHorizontalIcon,
  RewindIcon,
} from './icons.js'

interface MessageItemProps {
  message: Message
  showHeader?: boolean
  onImageClick?: (url: string) => void
  onViewThread?: (messageId: string) => void
  replyCount?: number
  roomSupportsRewind?: boolean
}

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

/**
 * Parse a link href as a file path with optional line number.
 * Returns null for normal URLs (http, https, mailto, etc.).
 */
function parseFileLink(href: string | null): { path: string; line?: number } | null {
  if (!href) return null
  // Skip common URL schemes and anchors
  if (/^(?:https?|mailto|tel|data|javascript|ftp):/i.test(href)) return null
  if (href.startsWith('#')) return null
  // Match a file path (must have extension) with optional :lineNumber
  const match = href.match(/^(.+?\.\w+)(?::(\d+))?$/)
  if (!match) return null
  return { path: match[1], line: match[2] ? parseInt(match[2], 10) : undefined }
}

/**
 * Hook that adds a delegated click handler on a container ref to intercept
 * file path links and open them in the workspace panel.
 */
function useFileLinkHandler(
  containerRef: React.RefObject<HTMLDivElement | null>,
  agentId: string | undefined,
  roomId: string,
) {
  useEffect(() => {
    const el = containerRef.current
    if (!el || !agentId) return

    const handleClick = (e: MouseEvent) => {
      const link = (e.target as Element).closest('a')
      if (!link) return
      const href = link.getAttribute('href')
      const fileInfo = parseFileLink(href)
      if (fileInfo) {
        e.preventDefault()
        e.stopPropagation()
        useWorkspaceStore.getState().openFile(agentId, roomId, fileInfo.path, fileInfo.line)
      }
    }

    el.addEventListener('click', handleClick)
    return () => el.removeEventListener('click', handleClick)
  }, [containerRef, agentId, roomId])
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

function MessageContent({
  chunkGroups,
  content,
}: {
  chunkGroups: ReturnType<typeof groupChunks> | null
  content: string
}) {
  if (chunkGroups) {
    return <ChunkGroupRenderer groups={chunkGroups} />
  }

  return (
    <div className="prose prose-sm dark:prose-invert max-w-none break-words">
      <LazyMarkdown
        components={{
          code({ className, children, ...props }) {
            const match = /language-(\w+)/.exec(className || '')
            const isBlock = match || (typeof children === 'string' && children.includes('\n'))
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
              <div className="not-prose overflow-x-auto -mx-2 px-2">
                <table className="min-w-full divide-y divide-border" {...props}>
                  {children}
                </table>
              </div>
            )
          },
        }}
      >
        {content}
      </LazyMarkdown>
    </div>
  )
}

// ─── Main Component ───

export const MessageItem = memo(function MessageItem({
  message,
  showHeader = true,
  onImageClick,
  onViewThread,
  replyCount,
  roomSupportsRewind,
}: MessageItemProps) {
  const { t, i18n } = useTranslation()
  const messages = useChatStore((s) => s.messages)
  const actions = useMessageActions(message, { roomSupportsRewind })
  const isAgent = message.senderType === 'agent'
  const agentInfo = useAgentStore((s) =>
    isAgent
      ? (s.agents.find((a) => a.id === message.senderId) ??
        s.sharedAgents.find((a) => a.id === message.senderId))
      : undefined,
  )

  // Intercept file path links in agent messages → open in workspace panel
  const msgRef = useRef<HTMLDivElement>(null)
  useFileLinkHandler(msgRef, isAgent ? message.senderId : undefined, message.roomId)

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

  return (
    <div
      ref={msgRef}
      className={`px-6 ${showHeader ? 'py-2' : 'py-0.5'} hover:bg-surface-hover/50 transition-colors group/msg relative`}
    >
      {/* Mobile action trigger — only show when canRewind */}
      {actions.canRewind && !actions.showActions && (
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

      {/* Action buttons - only show rewind for own messages when supported */}
      {actions.canRewind && (
        <div
          ref={actions.actionsRef}
          className={`absolute right-4 top-2 flex items-center gap-1 bg-surface/90 backdrop-blur-sm border border-border rounded-lg px-1 py-0.5 shadow-sm transition-all ${actions.showActions ? 'opacity-100' : 'opacity-0 pointer-events-none md:group-hover/msg:opacity-100 md:group-hover/msg:pointer-events-auto md:focus-within:opacity-100 md:focus-within:pointer-events-auto'}`}
        >
          {actions.confirmingRewind ? (
            <span className="flex items-center gap-1 bg-warning-subtle rounded-md px-1.5 py-0.5">
              <span className="text-xs text-warning-text whitespace-nowrap">
                {t('chat.confirmRewind')}
              </span>
              <button
                onClick={actions.handleRewind}
                className="px-1.5 py-0.5 text-xs font-medium text-white bg-warning-text hover:bg-warning-text/80 rounded"
              >
                {t('chat.rewindConfirm')}
              </button>
              <button
                onClick={() => actions.setConfirmingRewind(false)}
                className="px-1.5 py-0.5 text-xs font-medium text-text-secondary hover:text-text-primary"
              >
                {t('common.cancel')}
              </button>
            </span>
          ) : (
            <button
              onClick={() => actions.setConfirmingRewind(true)}
              className="p-2.5 md:p-1 rounded-md text-text-muted hover:text-warning-text hover:bg-warning-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              title={t('chat.rewindTooltip')}
              aria-label={t('chat.rewindTooltip')}
            >
              <RewindIcon className="w-4 h-4" />
            </button>
          )}
        </div>
      )}

      <div className="flex items-start space-x-3">
        {/* Avatar — hidden for grouped messages, placeholder keeps alignment */}
        {showHeader ? (
          <div
            className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center bg-gradient-to-br ${
              isAgent
                ? agentGradients[agentInfo?.type ?? 'generic'] || agentGradients.generic
                : getAvatarGradient(message.senderName)
            }`}
          >
            {isAgent ? (
              (() => {
                const icon = agentTypeIcons[agentInfo?.type ?? 'generic'] || agentTypeIcons.generic
                return (
                  <svg
                    className="w-4 h-4 text-white"
                    fill="currentColor"
                    viewBox={icon.viewBox || '0 0 24 24'}
                  >
                    {icon.paths.map((d, i) => (
                      <path key={i} d={d} />
                    ))}
                  </svg>
                )
              })()
            ) : (
              <span className="text-sm font-medium text-white">
                {message.senderName.charAt(0).toUpperCase()}
              </span>
            )}
          </div>
        ) : (
          <div className="flex-shrink-0 w-8" />
        )}

        {/* Message content */}
        <div className="flex-1 min-w-0 overflow-hidden">
          {/* Sender and time — only for first message in group */}
          {showHeader && (
            <div className="flex items-center space-x-2 mb-1">
              <span className="font-semibold text-text-primary text-sm">
                {message.senderName}
                {typeof message.metadata?.targetAgentName === 'string' && (
                  <span className="text-text-muted font-normal">
                    {' → '}
                    <span className="font-semibold text-text-primary">
                      {message.metadata.targetAgentName}
                    </span>
                  </span>
                )}
              </span>
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

          <MessageContent chunkGroups={chunkGroups} content={message.content} />

          {/* Attachments — use rich MediaMessage for agent media, standard list for others */}
          {message.attachments &&
            message.attachments.length > 0 &&
            (isAgent &&
            message.attachments.some(
              (a) =>
                a.mimeType.startsWith('audio/') ||
                a.mimeType.startsWith('video/') ||
                a.mimeType.startsWith('model/'),
            ) ? (
              <MediaMessage attachments={message.attachments} onImageClick={onImageClick} />
            ) : (
              <AttachmentList
                attachments={message.attachments}
                onImageClick={onImageClick ?? (() => {})}
              />
            ))}

          {/* Thread replies indicator */}
          {(replyCount ?? 0) > 0 && (
            <button
              onClick={() => onViewThread?.(message.id)}
              className="text-xs text-accent hover:text-accent-hover mt-1 font-medium"
            >
              {t('thread.viewReplies', { count: replyCount })}
            </button>
          )}
        </div>
      </div>
    </div>
  )
})
