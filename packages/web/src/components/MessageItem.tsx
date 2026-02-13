import type { Message } from '@agentim/shared'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import 'highlight.js/styles/github.css'

interface MessageItemProps {
  message: Message
}

export function MessageItem({ message }: MessageItemProps) {
  // 系统消息居中显示
  if (message.senderType === 'system') {
    return (
      <div className="px-6 py-3">
        <div className="flex justify-center">
          <div className="px-4 py-2 bg-gray-100 rounded-full">
            <p className="text-xs text-gray-600 text-center">{message.content}</p>
          </div>
        </div>
      </div>
    )
  }

  // Agent消息背景色
  const bgClass = message.senderType === 'agent' ? 'bg-blue-50' : 'bg-white'

  return (
    <div className={`px-6 py-4 ${bgClass} border-b border-gray-100`}>
      <div className="flex items-start space-x-3">
        {/* 头像 */}
        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center">
          <span className="text-sm font-medium text-gray-600">
            {message.senderName.charAt(0).toUpperCase()}
          </span>
        </div>

        {/* 消息内容 */}
        <div className="flex-1 min-w-0">
          {/* 发送者和时间 */}
          <div className="flex items-center space-x-2 mb-1">
            <span className="font-semibold text-gray-900">{message.senderName}</span>
            <span className="text-xs text-gray-500">
              {new Date(message.createdAt).toLocaleString('zh-CN', {
                month: 'numeric',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
            {message.senderType === 'agent' && (
              <span className="px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-700 rounded">
                Agent
              </span>
            )}
          </div>

          {/* Markdown内容 */}
          <div className="prose prose-sm max-w-none">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeHighlight]}
              components={{
                // 自定义代码块样式
                code({ node, inline, className, children, ...props }) {
                  const match = /language-(\w+)/.exec(className || '')
                  return !inline ? (
                    <div className="relative">
                      {match && (
                        <div className="absolute top-0 right-0 px-2 py-1 text-xs text-gray-500 bg-gray-100 rounded-bl">
                          {match[1]}
                        </div>
                      )}
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
                // 自定义链接样式
                a({ node, children, ...props }) {
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
                // 自定义表格样式
                table({ node, children, ...props }) {
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

          {/* 附件 */}
          {message.attachments && message.attachments.length > 0 && (
            <div className="mt-2 space-y-2">
              {message.attachments.map((attachment) => (
                <a
                  key={attachment.id}
                  href={attachment.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center space-x-2 px-3 py-2 bg-gray-100 rounded-md hover:bg-gray-200 transition-colors"
                >
                  <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
