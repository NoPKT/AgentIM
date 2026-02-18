import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { ParsedChunk } from '@agentim/shared'
import { getAvatarGradient } from '../lib/avatars.js'
import { groupChunks, ChunkGroupRenderer } from './ChunkBlocks.js'

interface StreamingMessageProps {
  agentName: string
  chunks: ParsedChunk[]
}

export function StreamingMessage({ agentName, chunks }: StreamingMessageProps) {
  const { t } = useTranslation()

  const groups = useMemo(() => groupChunks(chunks), [chunks])

  // Determine what's currently happening for the status line
  const lastChunk = chunks[chunks.length - 1]
  const statusText = lastChunk
    ? lastChunk.type === 'thinking'
      ? t('agentThinking')
      : lastChunk.type === 'tool_use'
        ? t('agentUsingTool')
        : lastChunk.type === 'text'
          ? t('agentResponding')
          : t('agentWorking')
    : t('agentWorking')

  return (
    <div className="px-6 py-4">
      <div className="flex items-start space-x-3">
        {/* Avatar */}
        <div
          className={`flex-shrink-0 w-8 h-8 rounded-full bg-gradient-to-br ${getAvatarGradient(agentName)} flex items-center justify-center`}
        >
          <span className="text-sm font-medium text-white">
            {agentName.charAt(0).toUpperCase()}
          </span>
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          {/* Header */}
          <div className="flex items-center space-x-2 mb-1">
            <span className="font-semibold text-gray-900 dark:text-gray-100 text-sm">
              {agentName}
            </span>
            <span className="px-1.5 py-0.5 text-[10px] font-medium bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 rounded">
              {t('agents')}
            </span>
            <span className="text-xs text-gray-400 dark:text-gray-500">
              {new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>

          {/* Chunk groups */}
          <ChunkGroupRenderer groups={groups} isStreaming />

          {/* Status line */}
          <div className="mt-2 flex items-center gap-2 text-xs text-blue-600 dark:text-blue-400">
            <div className="flex space-x-1">
              <span
                className="w-1.5 h-1.5 bg-blue-600 dark:bg-blue-400 rounded-full animate-bounce"
                style={{ animationDelay: '0ms' }}
              />
              <span
                className="w-1.5 h-1.5 bg-blue-600 dark:bg-blue-400 rounded-full animate-bounce"
                style={{ animationDelay: '150ms' }}
              />
              <span
                className="w-1.5 h-1.5 bg-blue-600 dark:bg-blue-400 rounded-full animate-bounce"
                style={{ animationDelay: '300ms' }}
              />
            </div>
            <span>{statusText}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
