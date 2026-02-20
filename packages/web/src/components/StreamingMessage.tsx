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
  const { t, i18n } = useTranslation()

  const groups = useMemo(() => groupChunks(chunks), [chunks])

  // Determine what's currently happening for the status line
  const lastChunk = chunks[chunks.length - 1]
  const statusText = lastChunk
    ? lastChunk.type === 'thinking'
      ? t('chat.agentThinking')
      : lastChunk.type === 'tool_use'
        ? t('chat.agentUsingTool')
        : lastChunk.type === 'text'
          ? t('chat.agentResponding')
          : t('chat.agentWorking')
    : t('chat.agentWorking')

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
            <span className="font-semibold text-text-primary text-sm">
              {agentName}
            </span>
            <span className="px-1.5 py-0.5 text-[10px] font-medium bg-info-muted text-info-text rounded">
              {t('agent.agents')}
            </span>
            <span className="text-xs text-text-muted">
              {new Date().toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>

          {/* Chunk groups */}
          <ChunkGroupRenderer groups={groups} isStreaming />

          {/* Status line */}
          <div className="mt-2 flex items-center gap-2 text-xs text-info-text">
            <div className="flex space-x-1">
              <span
                className="w-1.5 h-1.5 bg-info-text rounded-full animate-bounce"
                style={{ animationDelay: '0ms' }}
              />
              <span
                className="w-1.5 h-1.5 bg-info-text rounded-full animate-bounce"
                style={{ animationDelay: '150ms' }}
              />
              <span
                className="w-1.5 h-1.5 bg-info-text rounded-full animate-bounce"
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
