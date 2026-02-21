import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useChatStore } from '../stores/chat.js'
import { useAuthStore } from '../stores/auth.js'
import { MessageItem } from './MessageItem.js'
import { StreamingMessage } from './StreamingMessage.js'
import { ChatBubbleIcon, ArrowDownIcon } from './icons.js'

interface MessageListProps {
  onImageClick?: (url: string) => void
}

export function MessageList({ onImageClick }: MessageListProps) {
  const { t } = useTranslation()
  const { currentRoomId, messages, streaming, hasMore, loadMessages } = useChatStore()
  const readReceipts = useChatStore((s) => s.readReceipts)
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

  // 获取当前房间的流式消息
  const streamingMessages = useMemo(
    () =>
      currentRoomId
        ? Array.from(streaming.entries())
            .filter(([key]) => key.startsWith(`${currentRoomId}:`))
            .map(([, value]) => value)
        : [],
    [currentRoomId, streaming],
  )

  const virtualizer = useVirtualizer({
    count: currentMessages.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 100,
    overscan: 5,
  })

  // 自动滚动到底部(新消息或流式消息更新时), throttled to avoid layout thrashing
  const scrollRAF = useRef(0)
  useEffect(() => {
    if (!scrollToBottomRef.current || isScrolledUp) return
    cancelAnimationFrame(scrollRAF.current)
    scrollRAF.current = requestAnimationFrame(() => {
      scrollToBottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    })
  }, [
    currentMessages.length,
    streamingMessages.length,
    streamingMessages[0]?.chunks.length,
    isScrolledUp,
  ])

  const handleLoadMore = () => {
    if (!currentRoomId || !currentHasMore || isLoading) return
    const oldestMessage = currentMessages[0]
    if (oldestMessage) {
      loadMessages(currentRoomId, oldestMessage.createdAt)
    }
  }

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
        aria-label={t('chat.rooms')}
      >
        {/* 加载更多按钮 */}
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

        {/* 虚拟化消息列表 */}
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
                />
              </div>
            )
          })}
        </div>

        {/* 流式消息 */}
        {streamingMessages.map((streamMsg) => (
          <StreamingMessage
            key={streamMsg.messageId}
            agentName={streamMsg.agentName}
            chunks={streamMsg.chunks}
          />
        ))}

        {/* 已读回执 */}
        {currentRoomId &&
          (() => {
            const receipts = (readReceipts.get(currentRoomId) ?? []).filter(
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

        {/* 自动滚动锚点 */}
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
