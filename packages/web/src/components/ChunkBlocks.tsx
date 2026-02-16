import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import type { ParsedChunk } from '@agentim/shared'

export interface ChunkGroup {
  type: ParsedChunk['type']
  content: string
  metadata?: Record<string, unknown>
}

/** Group consecutive chunks of the same type together */
export function groupChunks(chunks: ParsedChunk[]): ChunkGroup[] {
  const groups: ChunkGroup[] = []
  for (const chunk of chunks) {
    const last = groups[groups.length - 1]
    if (
      last &&
      last.type === chunk.type &&
      chunk.type !== 'tool_use' &&
      chunk.type !== 'tool_result'
    ) {
      last.content += chunk.content
    } else {
      groups.push({ type: chunk.type, content: chunk.content, metadata: chunk.metadata })
    }
  }
  return groups
}

export function ThinkingBlock({
  content,
  isStreaming = false,
}: {
  content: string
  isStreaming?: boolean
}) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)

  const lines = content.split('\n').filter(Boolean)
  const lastLine = lines[lines.length - 1] || ''
  const summary = lastLine.length > 60 ? lastLine.slice(0, 60) + '...' : lastLine

  return (
    <div className="my-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 text-xs text-gray-500 hover:text-gray-700 transition-colors w-full text-left group dark:text-gray-400 dark:hover:text-gray-300"
      >
        <svg
          className={`w-3.5 h-3.5 transition-transform flex-shrink-0 ${expanded ? 'rotate-90' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>

        {isStreaming && (
          <span className="relative flex h-2 w-2 flex-shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-purple-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-purple-500" />
          </span>
        )}

        <span className="font-medium">{isStreaming ? t('thinking') : t('thought')}</span>
        {!expanded && summary && (
          <span className="text-gray-400 truncate flex-1 dark:text-gray-500">{summary}</span>
        )}
      </button>

      {expanded && (
        <div className="mt-1.5 ml-5 pl-3 border-l-2 border-purple-200 text-sm text-gray-600 whitespace-pre-wrap leading-relaxed max-h-80 overflow-y-auto dark:border-purple-700 dark:text-gray-400">
          {content}
          {isStreaming && (
            <span className="inline-block w-1.5 h-4 bg-purple-400 animate-pulse ml-0.5 align-middle" />
          )}
        </div>
      )}
    </div>
  )
}

export function ToolUseBlock({
  content,
  metadata,
  isStreaming = false,
}: {
  content: string
  metadata?: Record<string, unknown>
  isStreaming?: boolean
}) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const toolName = (metadata?.toolName as string) || t('tool')

  return (
    <div className="my-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 text-xs w-full text-left"
      >
        <svg
          className={`w-3.5 h-3.5 text-gray-400 transition-transform flex-shrink-0 dark:text-gray-500 ${expanded ? 'rotate-90' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>

        {isStreaming && (
          <span className="relative flex h-2 w-2 flex-shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500" />
          </span>
        )}

        <span className="inline-flex items-center gap-1">
          <svg
            className="w-3.5 h-3.5 text-blue-500"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
            />
          </svg>
          <span className="font-medium text-blue-600 dark:text-blue-400">{toolName}</span>
        </span>
      </button>

      {expanded && (
        <div className="mt-1.5 ml-5 pl-3 border-l-2 border-blue-200 dark:border-blue-700">
          <pre className="text-xs text-gray-600 bg-gray-50 rounded-md p-2 overflow-x-auto max-h-60 overflow-y-auto dark:text-gray-400 dark:bg-gray-800">
            {content}
          </pre>
        </div>
      )}
    </div>
  )
}

export function ToolResultBlock({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(false)
  const isLong = content.length > 200

  return (
    <div className="my-1 ml-5 pl-3 border-l-2 border-green-200 dark:border-green-700">
      <div className="text-xs text-gray-600 bg-green-50 rounded-md p-2 overflow-x-auto dark:text-gray-400 dark:bg-green-900/30">
        {isLong && !expanded ? (
          <>
            <pre className="whitespace-pre-wrap">{content.slice(0, 200)}...</pre>
            <button
              onClick={() => setExpanded(true)}
              className="text-green-600 hover:text-green-700 mt-1 font-medium dark:text-green-400 dark:hover:text-green-300"
            >
              Show more
            </button>
          </>
        ) : (
          <pre className="whitespace-pre-wrap max-h-60 overflow-y-auto">{content}</pre>
        )}
      </div>
    </div>
  )
}

export function ErrorBlock({ content }: { content: string }) {
  return (
    <div className="my-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg dark:bg-red-900/30 dark:border-red-800">
      <div className="flex items-center gap-1.5 mb-1">
        <svg
          className="w-4 h-4 text-red-500 dark:text-red-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z"
          />
        </svg>
        <span className="text-xs font-medium text-red-700 dark:text-red-300">Error</span>
      </div>
      <pre className="text-xs text-red-600 whitespace-pre-wrap dark:text-red-400">{content}</pre>
    </div>
  )
}

export function TextBlock({
  content,
  isStreaming = false,
}: {
  content: string
  isStreaming?: boolean
}) {
  return (
    <div className="prose prose-sm max-w-none dark:prose-invert">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
        {content}
      </ReactMarkdown>
      {isStreaming && (
        <span className="inline-block w-1.5 h-4 bg-blue-500 animate-pulse ml-0.5 align-middle" />
      )}
    </div>
  )
}

/** Render an array of chunk groups */
export function ChunkGroupRenderer({
  groups,
  isStreaming = false,
}: {
  groups: ChunkGroup[]
  isStreaming?: boolean
}) {
  return (
    <>
      {groups.map((group, i) => {
        const isLast = isStreaming && i === groups.length - 1
        switch (group.type) {
          case 'thinking':
            return <ThinkingBlock key={i} content={group.content} isStreaming={isLast} />
          case 'tool_use':
            return (
              <ToolUseBlock
                key={i}
                content={group.content}
                metadata={group.metadata}
                isStreaming={isLast}
              />
            )
          case 'tool_result':
            return <ToolResultBlock key={i} content={group.content} />
          case 'error':
            return <ErrorBlock key={i} content={group.content} />
          case 'text':
            return <TextBlock key={i} content={group.content} isStreaming={isLast} />
          default:
            return null
        }
      })}
    </>
  )
}
