import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { ParsedChunk } from '@agentim/shared'
import { useChatStore } from '../stores/chat.js'
import { MessageItem } from './MessageItem.js'

function StreamingMessage({
  agentName,
  chunks
}: {
  agentName: string
  chunks: ParsedChunk[]
}) {
  const combinedContent = chunks.map(c => c.content).join('')

  return (
    <div className="px-6 py-4 bg-blue-50">
      <div className="flex items-start space-x-3">
        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-200 flex items-center justify-center">
          <span className="text-sm font-medium text-blue-700">
            {agentName.charAt(0).toUpperCase()}
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center space-x-2 mb-1">
            <span className="font-semibold text-gray-900">{agentName}</span>
            <span className="text-xs text-gray-500">{new Date().toLocaleTimeString()}</span>
          </div>
          <div className="prose prose-sm max-w-none">
            <p className="text-gray-800 whitespace-pre-wrap">{combinedContent}</p>
          </div>
          <div className="mt-2 flex items-center space-x-1 text-blue-600">
            <div className="flex space-x-1">
              <span className="w-2 h-2 bg-blue-600 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></span>
              <span className="w-2 h-2 bg-blue-600 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
              <span className="w-2 h-2 bg-blue-600 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export function MessageList() {
  const { t } = useTranslation()
  const { currentRoomId, messages, streaming, hasMore, loadMessages } = useChatStore()
  const parentRef = useRef<HTMLDivElement>(null)
  const scrollToBottomRef = useRef<HTMLDivElement>(null)

  const currentMessages = currentRoomId ? messages.get(currentRoomId) ?? [] : []
  const currentHasMore = currentRoomId ? hasMore.get(currentRoomId) ?? false : false

  // 获取当前房间的流式消息
  const streamingMessages = currentRoomId
    ? Array.from(streaming.entries())
        .filter(([key]) => key.startsWith(`${currentRoomId}:`))
        .map(([, value]) => value)
    : []

  const virtualizer = useVirtualizer({
    count: currentMessages.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 100,
    overscan: 5,
  })

  // 自动滚动到底部(新消息或流式消息更新时)
  useEffect(() => {
    if (scrollToBottomRef.current) {
      scrollToBottomRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [currentMessages.length, streamingMessages.length, streamingMessages[0]?.chunks.length])

  const handleLoadMore = () => {
    if (!currentRoomId || !currentHasMore) return
    const oldestMessage = currentMessages[0]
    if (oldestMessage) {
      loadMessages(currentRoomId, oldestMessage.createdAt)
    }
  }

  if (!currentRoomId) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-500">
        <p>{t('noMessages')}</p>
      </div>
    )
  }

  if (currentMessages.length === 0 && streamingMessages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-500">
        <div className="text-center">
          <svg className="w-16 h-16 mx-auto mb-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
          <p className="text-lg">{t('noMessages')}</p>
        </div>
      </div>
    )
  }

  return (
    <div ref={parentRef} className="flex-1 overflow-y-auto">
      {/* 加载更多按钮 */}
      {currentHasMore && (
        <div className="p-4 text-center">
          <button
            onClick={handleLoadMore}
            className="px-4 py-2 text-sm text-blue-600 hover:bg-blue-50 rounded-md transition-colors"
          >
            {t('loadMore')}
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
              <MessageItem message={message} />
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

      {/* 自动滚动锚点 */}
      <div ref={scrollToBottomRef} />
    </div>
  )
}
