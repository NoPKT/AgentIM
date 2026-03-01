import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { LazyMarkdown } from './LazyMarkdown.js'
import type { ParsedChunk, WorkspaceStatus, WorkspaceFileChange } from '@agentim/shared'

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
      chunk.type !== 'tool_result' &&
      chunk.type !== 'workspace_status'
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
        aria-expanded={expanded}
        className="flex items-center gap-2 text-xs text-text-secondary hover:text-text-primary transition-colors w-full text-left group"
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

        <span className="font-medium">{isStreaming ? t('chat.thinking') : t('chat.thought')}</span>
        {!expanded && summary && <span className="text-text-muted truncate flex-1">{summary}</span>}
      </button>

      {expanded && (
        <div className="mt-1.5 ml-5 pl-3 border-l-2 border-purple-200 dark:border-purple-700 text-sm text-text-secondary whitespace-pre-wrap leading-relaxed max-h-80 overflow-y-auto">
          {content}
          {isStreaming && (
            <span className="inline-block w-1.5 h-4 bg-purple-400 animate-pulse ml-0.5 align-middle" />
          )}
        </div>
      )}
    </div>
  )
}

// ─── Specialized Tool Blocks ───

function parseToolInput(content: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(content)
    // Gateway wraps tool input as {name, id, input: {actual_params}}.
    // Unwrap to return only the actual tool parameters.
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof parsed.input === 'object' &&
      parsed.input !== null &&
      parsed.name
    ) {
      return parsed.input as Record<string, unknown>
    }
    return parsed
  } catch {
    // Try to extract file_path from non-JSON content (e.g. raw text arguments)
    const fileMatch = content.match(/(?:file_path|path|file)["\s:=]+["']?([^\s"',}]+)/i)
    if (fileMatch) {
      return { file_path: fileMatch[1] }
    }
    // Try to extract a command from non-JSON content
    const cmdMatch = content.match(/(?:command)["\s:=]+["']?(.+)/i)
    if (cmdMatch) {
      return { command: cmdMatch[1].replace(/["']$/, '') }
    }
    return null
  }
}

function EditToolBlock({
  content,
  isStreaming = false,
}: {
  content: string
  isStreaming?: boolean
}) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const input = parseToolInput(content)
  const filePath = (input?.file_path as string) || ''
  const oldStr = (input?.old_string as string) || ''
  const newStr = (input?.new_string as string) || ''
  const fileName = filePath.split('/').pop() || filePath

  return (
    <div className="my-2">
      <button
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        className="flex items-center gap-2 text-xs w-full text-left"
      >
        <svg
          className={`w-3.5 h-3.5 text-text-muted transition-transform flex-shrink-0 ${expanded ? 'rotate-90' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        {isStreaming && (
          <span className="relative flex h-2 w-2 flex-shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-yellow-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-yellow-500" />
          </span>
        )}
        <svg
          className="w-3.5 h-3.5 text-yellow-500"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
          />
        </svg>
        <span className="font-medium text-yellow-600 dark:text-yellow-400">
          {t('chat.editingFile', { file: fileName })}
        </span>
        {!expanded && <span className="text-text-muted text-xs truncate">{filePath}</span>}
      </button>
      {expanded && (
        <div className="mt-1.5 ml-5 pl-3 border-l-2 border-yellow-200 dark:border-yellow-700">
          <div className="text-xs text-text-muted mb-1 font-mono truncate">{filePath}</div>
          {oldStr && (
            <pre className="text-xs bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300 rounded-md p-2 overflow-x-auto max-h-40 overflow-y-auto mb-1 whitespace-pre-wrap">
              {oldStr.split('\n').map((line, i) => (
                <div key={i} className="flex">
                  <span className="select-none text-red-400 mr-2 flex-shrink-0">-</span>
                  <span>{line}</span>
                </div>
              ))}
            </pre>
          )}
          {newStr && (
            <pre className="text-xs bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-300 rounded-md p-2 overflow-x-auto max-h-40 overflow-y-auto whitespace-pre-wrap">
              {newStr.split('\n').map((line, i) => (
                <div key={i} className="flex">
                  <span className="select-none text-green-400 mr-2 flex-shrink-0">+</span>
                  <span>{line}</span>
                </div>
              ))}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}

function WriteToolBlock({
  content,
  isStreaming = false,
}: {
  content: string
  isStreaming?: boolean
}) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const input = parseToolInput(content)
  const filePath = (input?.file_path as string) || ''
  const fileContent = (input?.content as string) || ''
  const fileName = filePath.split('/').pop() || filePath
  const lineCount = fileContent.split('\n').length

  return (
    <div className="my-2">
      <button
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        className="flex items-center gap-2 text-xs w-full text-left"
      >
        <svg
          className={`w-3.5 h-3.5 text-text-muted transition-transform flex-shrink-0 ${expanded ? 'rotate-90' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        {isStreaming && (
          <span className="relative flex h-2 w-2 flex-shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
          </span>
        )}
        <svg
          className="w-3.5 h-3.5 text-green-500"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"
          />
        </svg>
        <span className="font-medium text-green-600 dark:text-green-400">
          {t('chat.writingFile', { file: fileName })}
        </span>
        <span className="text-text-muted text-xs">
          {t('chat.linesAdded', { count: lineCount })}
        </span>
      </button>
      {expanded && (
        <div className="mt-1.5 ml-5 pl-3 border-l-2 border-green-200 dark:border-green-700">
          <div className="text-xs text-text-muted mb-1 font-mono truncate">{filePath}</div>
          <pre className="text-xs text-text-secondary bg-surface-secondary rounded-md p-2 overflow-x-auto max-h-60 overflow-y-auto whitespace-pre-wrap">
            {fileContent}
          </pre>
        </div>
      )}
    </div>
  )
}

function ReadToolBlock({ content }: { content: string }) {
  const { t } = useTranslation()
  const input = parseToolInput(content)
  const filePath = (input?.file_path as string) || ''
  const fileName = filePath.split('/').pop() || filePath

  return (
    <div className="my-1 flex items-center gap-2 text-xs text-text-muted">
      <svg
        className="w-3.5 h-3.5 text-blue-400 flex-shrink-0"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
        />
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
        />
      </svg>
      <span className="truncate">
        {fileName ? t('chat.readingFile', { file: fileName }) : t('chat.readingFileGeneric')}
      </span>
    </div>
  )
}

/** Collapse N consecutive ReadToolBlocks into a single summary */
function ReadToolBlockGroup({ contents }: { contents: string[] }) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const files = contents
    .map((c) => {
      const input = parseToolInput(c)
      const filePath = (input?.file_path as string) || ''
      return filePath.split('/').pop() || filePath
    })
    .filter(Boolean)

  return (
    <div className="my-1">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 text-xs text-text-muted hover:text-text-secondary transition-colors"
      >
        <svg
          className="w-3.5 h-3.5 text-blue-400 flex-shrink-0"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
          />
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
          />
        </svg>
        <span>{t('chat.readingFiles', { count: contents.length })}</span>
        <svg
          className={`w-3 h-3 transition-transform ${expanded ? 'rotate-90' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </button>
      {expanded && (
        <div className="ml-5 mt-1 space-y-0.5">
          {files.map((f, i) => (
            <div key={i} className="text-xs text-text-muted font-mono truncate">
              {f}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function BashToolBlock({
  content,
  isStreaming = false,
}: {
  content: string
  isStreaming?: boolean
}) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const input = parseToolInput(content)
  const command = (input?.command as string) || content
  const preview = command.length > 80 ? command.slice(0, 80) + '...' : command

  return (
    <div className="my-2">
      <button
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        className="flex items-center gap-2 text-xs w-full text-left"
      >
        <svg
          className={`w-3.5 h-3.5 text-text-muted transition-transform flex-shrink-0 ${expanded ? 'rotate-90' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        {isStreaming && (
          <span className="relative flex h-2 w-2 flex-shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-gray-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-gray-500" />
          </span>
        )}
        <svg
          className="w-3.5 h-3.5 text-gray-500"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
          />
        </svg>
        <span className="font-medium text-gray-600 dark:text-gray-400">
          {t('chat.runningCommand')}
        </span>
        {!expanded && <code className="text-text-muted font-mono truncate flex-1">{preview}</code>}
      </button>
      {expanded && (
        <div className="mt-1.5 ml-5 pl-3 border-l-2 border-gray-200 dark:border-gray-700">
          <pre className="text-xs font-mono bg-gray-900 text-green-400 rounded-md p-3 overflow-x-auto max-h-60 overflow-y-auto whitespace-pre-wrap">
            <span className="text-gray-500 select-none">$ </span>
            {command}
          </pre>
        </div>
      )}
    </div>
  )
}

function GrepToolBlock({
  content,
  isStreaming = false,
}: {
  content: string
  isStreaming?: boolean
}) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const input = parseToolInput(content)
  const pattern = (input?.pattern as string) || ''
  const path = (input?.path as string) || ''
  const preview = pattern
    ? `${pattern}${path ? ` in ${path.split('/').pop() || path}` : ''}`
    : content.slice(0, 80)

  return (
    <div className="my-2">
      <button
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        className="flex items-center gap-2 text-xs w-full text-left"
      >
        <svg
          className={`w-3.5 h-3.5 text-text-muted transition-transform flex-shrink-0 ${expanded ? 'rotate-90' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        {isStreaming && (
          <span className="relative flex h-2 w-2 flex-shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-cyan-500" />
          </span>
        )}
        <svg
          className="w-3.5 h-3.5 text-cyan-500"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
          />
        </svg>
        <span className="font-medium text-cyan-600 dark:text-cyan-400">{t('chat.searching')}</span>
        {!expanded && <code className="text-text-muted font-mono truncate flex-1">{preview}</code>}
      </button>
      {expanded && (
        <div className="mt-1.5 ml-5 pl-3 border-l-2 border-cyan-200 dark:border-cyan-700">
          {pattern && (
            <div className="text-xs text-text-secondary mb-1">
              <span className="text-text-muted">{t('chat.pattern')}: </span>
              <code className="font-mono text-cyan-600 dark:text-cyan-400">{pattern}</code>
            </div>
          )}
          {path && (
            <div className="text-xs text-text-secondary">
              <span className="text-text-muted">{t('chat.path')}: </span>
              <code className="font-mono truncate">{path}</code>
            </div>
          )}
          {!pattern && !path && (
            <pre className="text-xs text-text-secondary bg-surface-secondary rounded-md p-2 overflow-x-auto whitespace-pre-wrap break-all">
              {content}
            </pre>
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
  const toolName = (metadata?.toolName as string) || t('chat.tool')

  // Dispatch to specialized blocks
  switch (toolName) {
    case 'Edit':
      return <EditToolBlock content={content} isStreaming={isStreaming} />
    case 'Write':
      return <WriteToolBlock content={content} isStreaming={isStreaming} />
    case 'Read':
      return <ReadToolBlock content={content} />
    case 'Bash':
      return <BashToolBlock content={content} isStreaming={isStreaming} />
    case 'Grep':
    case 'Glob':
      return <GrepToolBlock content={content} isStreaming={isStreaming} />
  }

  // Extract a short preview from tool input for the collapsed state
  const input = parseToolInput(content)
  const toolPreview = (() => {
    if (!input) return ''
    // Common patterns: file_path, command, query, url, pattern
    const filePath = input.file_path as string
    if (filePath) return filePath.split('/').pop() || filePath
    const command = input.command as string
    if (command) return command.length > 60 ? command.slice(0, 60) + '...' : command
    const query = (input.query ?? input.pattern ?? input.url) as string
    if (query) return query.length > 60 ? query.slice(0, 60) + '...' : query
    return ''
  })()

  // Generic tool block (fallback)
  return (
    <div className="my-2">
      <button
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        className="flex items-center gap-2 text-xs w-full text-left"
      >
        <svg
          className={`w-3.5 h-3.5 text-text-muted transition-transform flex-shrink-0 ${expanded ? 'rotate-90' : ''}`}
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
          <span className="font-medium text-info-text">{toolName}</span>
        </span>
        {!expanded && toolPreview && (
          <span className="text-text-muted truncate flex-1 font-mono">{toolPreview}</span>
        )}
      </button>

      {expanded && (
        <div className="mt-1.5 ml-5 pl-3 border-l-2 border-info-border">
          <pre className="text-xs text-text-secondary bg-surface-secondary rounded-md p-2 overflow-x-auto max-h-60 overflow-y-auto whitespace-pre-wrap break-all">
            {content}
          </pre>
        </div>
      )}
    </div>
  )
}

export function ToolResultBlock({
  content,
  metadata,
}: {
  content: string
  metadata?: Record<string, unknown>
}) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const isLong = content.length > 200
  const toolName = (metadata?.toolName as string) || ''
  const isBashResult = toolName === 'Bash'

  return (
    <div className="my-1 ml-5 pl-3 border-l-2 border-green-200 dark:border-green-700">
      <div
        className={`text-xs rounded-md p-2 overflow-x-auto ${
          isBashResult
            ? 'bg-gray-900 text-green-400 font-mono'
            : 'text-text-secondary bg-success-subtle'
        }`}
      >
        {isLong && !expanded ? (
          <>
            <pre className="whitespace-pre-wrap">{content.slice(0, 200)}...</pre>
            <button
              onClick={() => setExpanded(true)}
              className="text-success-text hover:opacity-80 mt-1 font-medium"
            >
              {t('common.showMore')}
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
  const { t } = useTranslation()
  return (
    <div className="my-2 px-3 py-2 bg-danger-subtle border border-danger/20 rounded-lg">
      <div className="flex items-center gap-1.5 mb-1">
        <svg
          className="w-4 h-4 text-danger-text"
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
        <span className="text-xs font-medium text-danger-text">{t('common.error')}</span>
      </div>
      <pre className="text-xs text-danger-text whitespace-pre-wrap">{content}</pre>
    </div>
  )
}

/** During streaming, only render the tail of very long text to keep ReactMarkdown fast. */
const STREAMING_TEXT_TRUNCATE = 8000

export function TextBlock({
  content,
  isStreaming = false,
}: {
  content: string
  isStreaming?: boolean
}) {
  const { t } = useTranslation()
  const truncated = isStreaming && content.length > STREAMING_TEXT_TRUNCATE
  const displayContent = useMemo(
    () => (truncated ? content.slice(-STREAMING_TEXT_TRUNCATE) : content),
    [content, truncated],
  )

  return (
    <div className="prose prose-sm max-w-none dark:prose-invert break-words overflow-hidden">
      {truncated && (
        <div className="not-prose text-xs text-text-muted italic mb-1">
          {t('chat.streamingTruncated')}
        </div>
      )}
      <LazyMarkdown>{displayContent}</LazyMarkdown>
      {isStreaming && (
        <span className="inline-block w-1.5 h-4 bg-blue-500 animate-pulse ml-0.5 align-middle" />
      )}
    </div>
  )
}

// ─── Workspace Status Block ───

function FileStatusIcon({ status }: { status: WorkspaceFileChange['status'] }) {
  switch (status) {
    case 'added':
      return <span className="text-green-500 font-bold text-xs">A</span>
    case 'modified':
      return <span className="text-yellow-500 font-bold text-xs">M</span>
    case 'deleted':
      return <span className="text-red-500 font-bold text-xs">D</span>
    case 'renamed':
      return <span className="text-blue-500 font-bold text-xs">R</span>
    default:
      return <span className="text-gray-500 font-bold text-xs">?</span>
  }
}

type DiffRow = {
  type: 'hunk' | 'add' | 'del' | 'ctx'
  old?: number
  new?: number
  text: string
}

function DiffView({ diff }: { diff: string }) {
  const lines = diff.split('\n')
  let oldLine = 0
  let newLine = 0
  const rows: DiffRow[] = []

  for (const line of lines) {
    if (
      line.startsWith('diff --git') ||
      line.startsWith('index ') ||
      line.startsWith('--- ') ||
      line.startsWith('+++ ')
    ) {
      continue
    }
    if (line.startsWith('@@')) {
      const m = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)/)
      if (m) {
        oldLine = +m[1]
        newLine = +m[2]
      }
      rows.push({ type: 'hunk', text: line })
    } else if (line.startsWith('+')) {
      rows.push({ type: 'add', new: newLine++, text: line.slice(1) })
    } else if (line.startsWith('-')) {
      rows.push({ type: 'del', old: oldLine++, text: line.slice(1) })
    } else {
      rows.push({
        type: 'ctx',
        old: oldLine++,
        new: newLine++,
        text: line.startsWith(' ') ? line.slice(1) : line,
      })
    }
  }

  return (
    <div className="ml-5 mt-1 mb-2 overflow-x-auto max-h-60 overflow-y-auto rounded-md border border-border">
      <table className="text-xs font-mono w-full border-collapse">
        <tbody>
          {rows.map((r, i) => {
            const rowBg =
              r.type === 'add'
                ? 'bg-green-500/10'
                : r.type === 'del'
                  ? 'bg-red-500/10'
                  : r.type === 'hunk'
                    ? 'bg-blue-500/10'
                    : ''
            const textCls =
              r.type === 'add'
                ? 'text-green-700 dark:text-green-300'
                : r.type === 'del'
                  ? 'text-red-700 dark:text-red-300'
                  : r.type === 'hunk'
                    ? 'text-blue-600 dark:text-blue-400'
                    : ''
            return (
              <tr key={i} className={rowBg}>
                <td className="select-none text-right pr-2 pl-2 text-text-muted/50 w-[1%] whitespace-nowrap">
                  {r.old ?? ''}
                </td>
                <td className="select-none text-right pr-2 text-text-muted/50 w-[1%] whitespace-nowrap border-r border-border">
                  {r.new ?? ''}
                </td>
                {r.type === 'hunk' ? (
                  <td className={`px-2 whitespace-pre ${textCls} italic`}>{r.text}</td>
                ) : (
                  <td className={`px-2 whitespace-pre ${textCls}`}>{r.text}</td>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function WorkspaceFileItem({ file }: { file: WorkspaceFileChange }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div>
      <button
        onClick={() => file.diff && setExpanded(!expanded)}
        aria-expanded={file.diff ? expanded : undefined}
        className="flex items-center gap-2 text-xs w-full text-left py-0.5 hover:bg-surface-hover rounded px-1"
      >
        <FileStatusIcon status={file.status} />
        <span className="font-mono truncate flex-1">{file.path}</span>
        {file.additions != null && file.additions > 0 && (
          <span className="text-green-500 text-xs">+{file.additions}</span>
        )}
        {file.deletions != null && file.deletions > 0 && (
          <span className="text-red-500 text-xs">-{file.deletions}</span>
        )}
        {file.diff && (
          <svg
            className={`w-3 h-3 text-text-muted transition-transform ${expanded ? 'rotate-90' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        )}
      </button>
      {expanded && file.diff && <DiffView diff={file.diff} />}
    </div>
  )
}

export function WorkspaceStatusBlock({ content }: { content: string }) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)

  let status: WorkspaceStatus | null = null
  try {
    status = JSON.parse(content) as WorkspaceStatus
  } catch {
    return null
  }

  if (!status || status.changedFiles.length === 0) {
    return null
  }

  return (
    <div className="my-3 border border-border rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        className="flex items-center gap-2 w-full text-left px-3 py-2 bg-surface-secondary hover:bg-surface-hover transition-colors"
      >
        <svg
          className={`w-3.5 h-3.5 text-text-muted transition-transform ${expanded ? 'rotate-90' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        <svg
          className="w-4 h-4 text-orange-500"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M4 7v10c0 2 1 3 3 3h10c2 0 3-1 3-3V7M4 7l4-4h8l4 4M4 7h16"
          />
        </svg>
        <span className="text-xs font-medium text-text-primary">{t('chat.workspaceChanges')}</span>
        <span className="text-xs text-text-muted">{status.branch}</span>
        <span className="ml-auto text-xs text-text-muted">
          {t('chat.filesChanged', { count: status.summary.filesChanged })}
        </span>
        <span className="text-green-500 text-xs">+{status.summary.additions}</span>
        <span className="text-red-500 text-xs">-{status.summary.deletions}</span>
      </button>
      {expanded && (
        <div className="px-3 py-2 space-y-1">
          {status.changedFiles.map((file, i) => (
            <WorkspaceFileItem key={i} file={file} />
          ))}
          {status.recentCommits && status.recentCommits.length > 0 && (
            <div className="mt-2 pt-2 border-t border-border">
              <div className="text-xs font-medium text-text-secondary mb-1">
                {t('chat.recentCommits')}
              </div>
              {status.recentCommits.map((commit, i) => (
                <div key={i} className="flex items-center gap-2 text-xs py-0.5">
                  <code className="text-orange-500 font-mono">{commit.hash}</code>
                  <span className="text-text-secondary truncate">{commit.message}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** Batch type for collapsed consecutive groups */
interface CollapsedBatch {
  type: 'read_batch' | 'tool_batch' | 'thinking_batch'
  contents: string[]
  toolName?: string
}

/** Collapse consecutive same-type tool_use/thinking groups into batched renders */
function collapseConsecutiveGroups(groups: ChunkGroup[]): (ChunkGroup | CollapsedBatch)[] {
  const result: (ChunkGroup | CollapsedBatch)[] = []
  let buffer: ChunkGroup[] = []
  let bufferKey = '' // "tool_use:Read", "tool_use:Bash", "thinking", etc.

  const getGroupKey = (g: ChunkGroup): string => {
    if (g.type === 'thinking') return 'thinking'
    if (g.type === 'tool_use') return `tool_use:${(g.metadata?.toolName as string) || ''}`
    return ''
  }

  const flushBuffer = () => {
    if (buffer.length === 0) return
    const first = buffer[0]

    if (first.type === 'thinking' && buffer.length >= 2) {
      result.push({
        type: 'thinking_batch',
        contents: buffer.map((b) => b.content),
      })
    } else if (
      first.type === 'tool_use' &&
      (first.metadata?.toolName as string) === 'Read' &&
      buffer.length > 3
    ) {
      // Read blocks use existing ReadToolBlockGroup with >3 threshold
      result.push({
        type: 'read_batch',
        contents: buffer.map((b) => b.content),
      })
    } else if (first.type === 'tool_use' && buffer.length >= 2) {
      result.push({
        type: 'tool_batch',
        contents: buffer.map((b) => b.content),
        toolName: (first.metadata?.toolName as string) || '',
      })
    } else {
      // Not enough to batch — emit individually
      for (const b of buffer) {
        result.push(b)
      }
    }
    buffer = []
    bufferKey = ''
  }

  for (const group of groups) {
    const key = getGroupKey(group)
    // Only buffer groupable types
    if (key && key === bufferKey) {
      buffer.push(group)
    } else {
      flushBuffer()
      if (key) {
        buffer = [group]
        bufferKey = key
      } else {
        result.push(group)
      }
    }
  }
  flushBuffer()
  return result
}

/** Collapsed batch of same-type tool blocks */
function ToolBatchBlock({ contents, toolName }: { contents: string[]; toolName: string }) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="my-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 text-xs text-text-secondary hover:text-text-primary transition-colors"
      >
        <svg
          className={`w-3.5 h-3.5 text-text-muted transition-transform flex-shrink-0 ${expanded ? 'rotate-90' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
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
        <span className="font-medium">
          {t('chat.toolBatch', { tool: toolName, count: contents.length })}
        </span>
      </button>
      {expanded && (
        <div className="ml-5 mt-1 space-y-1">
          {contents.map((c, i) => (
            <ToolUseBlock key={i} content={c} metadata={{ toolName }} />
          ))}
        </div>
      )}
    </div>
  )
}

/** Collapsed batch of thinking blocks */
function ThinkingBatchBlock({ contents }: { contents: string[] }) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="my-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 text-xs text-text-secondary hover:text-text-primary transition-colors"
      >
        <svg
          className={`w-3.5 h-3.5 text-text-muted transition-transform flex-shrink-0 ${expanded ? 'rotate-90' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        <span className="font-medium">
          {t('chat.thought')} ×{contents.length}
        </span>
      </button>
      {expanded && (
        <div className="ml-5 mt-1 space-y-1">
          {contents.map((c, i) => (
            <ThinkingBlock key={i} content={c} />
          ))}
        </div>
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
  const collapsed = useMemo(() => collapseConsecutiveGroups(groups), [groups])

  return (
    <>
      {collapsed.map((group, i) => {
        const key = `${group.type}-${i}`
        const isLast = isStreaming && i === collapsed.length - 1

        if (group.type === 'read_batch') {
          return <ReadToolBlockGroup key={key} contents={(group as CollapsedBatch).contents} />
        }

        if (group.type === 'tool_batch') {
          const batch = group as CollapsedBatch
          return (
            <ToolBatchBlock key={key} contents={batch.contents} toolName={batch.toolName || ''} />
          )
        }

        if (group.type === 'thinking_batch') {
          return <ThinkingBatchBlock key={key} contents={(group as CollapsedBatch).contents} />
        }

        const g = group as ChunkGroup
        switch (g.type) {
          case 'thinking':
            return <ThinkingBlock key={key} content={g.content} isStreaming={isLast} />
          case 'tool_use':
            return (
              <ToolUseBlock
                key={key}
                content={g.content}
                metadata={g.metadata}
                isStreaming={isLast}
              />
            )
          case 'tool_result':
            return <ToolResultBlock key={key} content={g.content} metadata={g.metadata} />
          case 'error':
            return <ErrorBlock key={key} content={g.content} />
          case 'workspace_status':
            return <WorkspaceStatusBlock key={key} content={g.content} />
          case 'text':
            return <TextBlock key={key} content={g.content} isStreaming={isLast} />
          default:
            return null
        }
      })}
    </>
  )
}
