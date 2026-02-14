import { useState, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { Message } from '@agentim/shared'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import { useChatStore } from '../stores/chat.js'
import { groupChunks, ChunkGroupRenderer } from './ChunkBlocks.js'
import 'highlight.js/styles/github.css'

interface MessageItemProps {
  message: Message
}

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
      className="px-2 py-1 text-xs text-gray-500 hover:text-gray-700 bg-gray-100 hover:bg-gray-200 rounded transition-colors"
      title={t('copy')}
    >
      {copied ? t('copied') : t('copy')}
    </button>
  )
}

export function MessageItem({ message }: MessageItemProps) {
  const { t, i18n } = useTranslation()
  const setReplyTo = useChatStore((s) => s.setReplyTo)
  const messages = useChatStore((s) => s.messages)

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
          <div className="px-4 py-1.5 bg-gray-100 rounded-full">
            <p className="text-xs text-gray-500 text-center">{message.content}</p>
          </div>
        </div>
      </div>
    )
  }

  const isAgent = message.senderType === 'agent'

  return (
    <div className="px-6 py-3 hover:bg-gray-50/50 transition-colors group/msg relative">
      {/* Reply button */}
      <button
        onClick={() => setReplyTo(message)}
        className="absolute right-4 top-2 p-1 rounded-md text-gray-400 hover:text-blue-600 hover:bg-blue-50 opacity-0 group-hover/msg:opacity-100 transition-all"
        title={t('reply')}
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
        </svg>
      </button>

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
            <span className="font-semibold text-gray-900 text-sm">{message.senderName}</span>
            {isAgent && (
              <span className="px-1.5 py-0.5 text-[10px] font-medium bg-blue-100 text-blue-700 rounded">
                Agent
              </span>
            )}
            <span className="text-xs text-gray-400">
              {new Date(message.createdAt).toLocaleString(i18n.language, {
                month: 'numeric',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
          </div>

          {/* Replied message quote */}
          {repliedMessage && (
            <div className="mb-1.5 pl-3 border-l-2 border-blue-300 bg-blue-50/50 rounded-r-md py-1 pr-2">
              <span className="text-xs font-medium text-blue-600">{repliedMessage.senderName}</span>
              <p className="text-xs text-gray-500 truncate">{repliedMessage.content.slice(0, 100)}</p>
            </div>
          )}

          {/* Message content: structured chunks for agent messages, markdown for others */}
          {chunkGroups ? (
            <ChunkGroupRenderer groups={chunkGroups} />
          ) : (
            <div className="prose prose-sm max-w-none">
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
                            <span className="px-1.5 py-0.5 text-xs text-gray-500 bg-gray-100 rounded">
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
                      <code className="px-1.5 py-0.5 bg-gray-100 rounded text-sm" {...props}>
                        {children}
                      </code>
                    )
                  },
                  a({ children, ...props }) {
                    return (
                      <a
                        className="text-blue-600 hover:text-blue-800 underline"
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
                        <table className="min-w-full divide-y divide-gray-200" {...props}>
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

          {/* Attachments */}
          {message.attachments && message.attachments.length > 0 && (
            <div className="mt-2 space-y-2">
              {message.attachments.map((attachment) => (
                <a
                  key={attachment.id}
                  href={attachment.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center space-x-2 px-3 py-2 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors border border-gray-100"
                >
                  <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                  </svg>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{attachment.filename}</p>
                    <p className="text-xs text-gray-500">
                      {(attachment.size / 1024).toFixed(2)} KB
                    </p>
                  </div>
                  <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                </a>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
