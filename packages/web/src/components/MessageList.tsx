import { useState, useEffect, useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useShallow } from 'zustand/shallow'
import { useChatStore } from '../stores/chat.js'
import { useAuthStore } from '../stores/auth.js'
import { MessageItem } from './MessageItem.js'
import { StreamingMessage } from './StreamingMessage.js'
import { ChatBubbleIcon, ArrowDownIcon } from './icons.js'

interface MessageListProps {
  onImageClick?: (url: string) => void
  roomSupportsRewind?: boolean
}

export function MessageList({ onImageClick, roomSupportsRewind }: MessageListProps) {
  const { t } = useTranslation()
  const { currentRoomId, messages, hasMore, loadMessages } = useChatStore()
  const readReceipts = useChatStore((s) => s.readReceipts)
  // Derive streaming entries for the current room via a shallow-compared
  // selector so the Map reference churn does not defeat useMemo.
  const streamingMessages = useChatStore(
    useShallow((s) => {
      if (!s.currentRoomId) return []
      const prefix = `${s.currentRoomId}:`
      return Array.from(s.streaming.entries())
        .filter(([key]) => key.startsWith(prefix))
        .map(([, value]) => value)
    }),
  )
  const currentUser = useAuthStore((s) => s.user)
  const parentRef = useRef<HTMLDivElement>(null)
  const scrollToBottomRef = useRef<HTMLDivElement>(null)

  const loadingMessages = useChatStore((s) => s.loadingMessages)
  const currentMessages = currentRoomId ? (messages.get(currentRoomId) ?? []) : []
  const currentHasMore = currentRoomId ? (hasMore.get(currentRoomId) ?? false) : false
  const isLoading = currentRoomId ? loadingMessages.has(currentRoomId) : false
  const [isScrolledUp, setIsScrolledUp] = useState(false)

  // Track scroll position for scroll-to-bottom button
  useEffect(() => {
    const el = parentRef.current
    if (!el) return
    const handler = () => {
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
      setIsScrolledUp(distanceFromBottom > 200)
    }
    el.addEventListener('scroll', handler, { passive: true })
    return () => el.removeEventListener('scroll', handler)
  }, [])

  const scrollToBottom = useCallback(() => {
    scrollToBottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  const estimateSize = useCallback(
    (index: number) => {
      const msg = currentMessages[index]
      if (!msg) return 80
      const prev = index > 0 ? currentMessages[index - 1] : null
      const hasHeader =
        !prev ||
        prev.senderId !== msg.senderId ||
        prev.senderType === 'system' ||
        msg.senderType === 'system' ||
        new Date(msg.createdAt).getTime() - new Date(prev.createdAt).getTime() > 5 * 60 * 1000
      // Header: avatar + name + timestamp (~56px) + vertical padding (~16px)
      // No header: minimal vertical padding (~6px)
      const baseHeight = hasHeader ? 72 : 6
      // Use 24px per line to match rendered prose line-height (~1.5)
      const LINE_HEIGHT = 24
      const CHARS_PER_LINE = 72

      // Cap estimates so inaccuracies never create page-spanning gaps.
      // measureElement will correct to the true height once the item renders.
      const MAX_ESTIMATE = 400

      // Agent messages with chunks: only count visible text (not collapsed
      // thinking/tool_use blocks which are hidden by default).
      // Process sections collapse multiple blocks into a single ~28px header.
      if (msg.chunks?.length) {
        const visibleText = msg.chunks.reduce(
          (acc: number, c: { type?: string; content?: string }) => {
            if (c.type === 'thinking' || c.type === 'tool_use' || c.type === 'tool_result')
              return acc
            return acc + (c.content?.length ?? 0)
          },
          0,
        )
        const lineEstimate = Math.max(1, Math.ceil(visibleText / CHARS_PER_LINE))
        // Count process blocks; groups of >=3 consecutive process chunks become
        // a single collapsed ProcessSection (~28px). Fewer remain individual (~28px each).
        const processChunks = msg.chunks.filter(
          (c: { type?: string }) =>
            c.type === 'thinking' || c.type === 'tool_use' || c.type === 'tool_result',
        ).length
        // Approximate: if >=3 process chunks, they collapse into 1 section header
        const processHeight = processChunks >= 3 ? 28 : processChunks * 28
        return Math.min(baseHeight + lineEstimate * LINE_HEIGHT + processHeight, MAX_ESTIMATE)
      }

      const contentLength = msg.content?.length ?? 0
      const lineEstimate = Math.max(1, Math.ceil(contentLength / CHARS_PER_LINE))
      return Math.min(baseHeight + lineEstimate * LINE_HEIGHT, MAX_ESTIMATE)
    },
    [currentMessages],
  )

  const virtualizer = useVirtualizer({
    count: currentMessages.length,
    getScrollElement: () => parentRef.current,
    estimateSize,
    // Stable keys prevent DOM recreation when messages are inserted/reordered
    getItemKey: useCallback(
      (index: number) => currentMessages[index]?.id ?? index,
      [currentMessages],
    ),
    overscan: 8,
  })

  // Re-measure visible items when dynamic content changes (expanded/collapsed
  // sections, lazy markdown, images).  Instead of calling virtualizer.measure()
  // (which DESTROYS all cached measurements and forces fallback to estimates),
  // we re-invoke measureElement on each rendered DOM node so the virtualizer
  // keeps accurate per-item sizes.
  //
  // We observe the wrapper container (not individual items) to avoid
  // measure→resize→observe loops that trigger ResizeObserver warnings.
  const measureRAF = useRef(0)
  useEffect(() => {
    const el = parentRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(measureRAF.current)
      measureRAF.current = requestAnimationFrame(() => {
        const nodes = el.querySelectorAll<HTMLElement>('[data-index]')
        nodes.forEach((node) => virtualizer.measureElement(node))
      })
    })
    const listContainer = el.querySelector('[style*="position: relative"]')
    if (listContainer instanceof HTMLElement) {
      ro.observe(listContainer)
    }
    return () => {
      cancelAnimationFrame(measureRAF.current)
      ro.disconnect()
    }
  }, [virtualizer])

  // Auto-scroll to bottom (on new messages or streaming updates), throttled to avoid layout thrashing
  const scrollRAF = useRef(0)
  useEffect(() => {
    if (!scrollToBottomRef.current || isScrolledUp) return
    cancelAnimationFrame(scrollRAF.current)
    scrollRAF.current = requestAnimationFrame(() => {
      scrollToBottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    })
    return () => cancelAnimationFrame(scrollRAF.current)
  }, [currentMessages.length, streamingMessages.length, isScrolledUp])

  // Track message count before loading more, so we can anchor scroll position
  const prevCountRef = useRef(0)
  const needsAnchorRef = useRef(false)

  const handleLoadMore = () => {
    if (!currentRoomId || !currentHasMore || isLoading) return
    const oldestMessage = currentMessages[0]
    if (oldestMessage) {
      prevCountRef.current = currentMessages.length
      needsAnchorRef.current = true
      loadMessages(currentRoomId, oldestMessage.createdAt)
    }
  }

  // After history messages are prepended, scroll to anchor the previous first visible message
  useEffect(() => {
    if (!needsAnchorRef.current) return
    const prevCount = prevCountRef.current
    if (prevCount === 0 || currentMessages.length <= prevCount) return
    needsAnchorRef.current = false
    const insertedCount = currentMessages.length - prevCount
    // Scroll to the item that was previously at index 0 (now at insertedCount)
    virtualizer.scrollToIndex(insertedCount, { align: 'start' })
  }, [currentMessages.length, virtualizer])

  if (!currentRoomId) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-secondary">
        <p>{t('chat.noMessages')}</p>
      </div>
    )
  }

  if (isLoading && currentMessages.length === 0) {
    return (
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-start space-x-3 animate-pulse">
            <div className="w-8 h-8 rounded-full bg-surface-hover flex-shrink-0" />
            <div className="flex-1 space-y-2">
              <div className="flex items-center space-x-2">
                <div className="h-3 w-20 bg-surface-hover rounded" />
                <div className="h-3 w-12 bg-surface-hover rounded" />
              </div>
              <div className="h-4 bg-surface-hover rounded w-3/4" />
              <div className="h-4 bg-surface-hover rounded w-1/2" />
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (currentMessages.length === 0 && streamingMessages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-secondary">
        <div className="text-center">
          <ChatBubbleIcon className="w-16 h-16 mx-auto mb-4 text-border" aria-hidden="true" />
          <p className="text-lg">{t('chat.noMessages')}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 relative min-h-0">
      <div
        ref={parentRef}
        className="h-full overflow-y-auto scrollbar-thin"
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        aria-label={t('chat.messages')}
        aria-busy={isLoading}
      >
        {/* Load more button */}
        {currentHasMore && (
          <div className="p-4 text-center">
            <button
              onClick={handleLoadMore}
              disabled={isLoading}
              className="px-4 py-2 text-sm text-accent hover:bg-info-subtle rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2"
            >
              {isLoading && (
                <svg
                  className="w-4 h-4 animate-spin"
                  viewBox="0 0 24 24"
                  fill="none"
                  aria-hidden="true"
                >
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
              )}
              {t('chat.loadMore')}
            </button>
          </div>
        )}

        {/* Virtualized message list */}
        <div
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            width: '100%',
            position: 'relative',
          }}
        >
          {virtualizer.getVirtualItems().map((virtualItem) => {
            const message = currentMessages[virtualItem.index]
            const prev = virtualItem.index > 0 ? currentMessages[virtualItem.index - 1] : null
            const showHeader =
              !prev ||
              prev.senderId !== message.senderId ||
              prev.senderType === 'system' ||
              message.senderType === 'system' ||
              new Date(message.createdAt).getTime() - new Date(prev.createdAt).getTime() >
                5 * 60 * 1000
            return (
              <div
                key={virtualItem.key}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${virtualItem.start}px)`,
                }}
                ref={virtualizer.measureElement}
                data-index={virtualItem.index}
              >
                <MessageItem
                  message={message}
                  showHeader={showHeader}
                  onImageClick={onImageClick}
                  roomSupportsRewind={roomSupportsRewind}
                />
              </div>
            )
          })}
        </div>

        {/* Streaming messages */}
        {streamingMessages.map((streamMsg) => (
          <StreamingMessage
            key={`${streamMsg.agentId}:${streamMsg.messageId}`}
            agentName={streamMsg.agentName}
            agentId={streamMsg.agentId}
            roomId={currentRoomId!}
            chunks={streamMsg.chunks}
          />
        ))}

        {/* Read receipts */}
        {(() => {
          const receipts = (currentRoomId ? (readReceipts.get(currentRoomId) ?? []) : []).filter(
            (r) => r.userId !== currentUser?.id,
          )

          if (receipts.length === 0) return null

          return (
            <div className="flex items-center gap-1 px-6 py-1.5 justify-end">
              <span className="text-xs text-text-muted mr-1">{t('chat.readBy')}</span>
              {receipts.slice(0, 5).map((r) => (
                <span
                  key={r.userId}
                  title={r.username}
                  className="w-5 h-5 rounded-full bg-text-muted flex items-center justify-center text-[9px] font-medium text-white"
                >
                  {r.username.charAt(0).toUpperCase()}
                </span>
              ))}
              {receipts.length > 5 && (
                <span className="text-xs text-text-muted">+{receipts.length - 5}</span>
              )}
            </div>
          )
        })()}

        {/* Auto-scroll anchor */}
        <div ref={scrollToBottomRef} />
      </div>

      {/* Scroll to bottom floating button */}
      {isScrolledUp && (
        <button
          onClick={scrollToBottom}
          aria-label={t('chat.scrollToBottom')}
          className="absolute bottom-4 right-4 z-dropdown p-2.5 bg-surface shadow-lg rounded-full text-text-secondary hover:bg-surface-hover transition-all border border-border"
        >
          <ArrowDownIcon className="w-5 h-5" aria-hidden="true" />
        </button>
      )}
    </div>
  )
}
