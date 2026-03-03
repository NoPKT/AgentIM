import React from 'react'
import { Box, Text } from 'ink'
import type { LogEntry } from './hooks/use-logs.js'

interface LogViewerProps {
  logs: LogEntry[]
  maxLines?: number
  scrollOffset?: number
  focused?: boolean
  /** Set of line indices that match the search query */
  matchLineIndices?: Set<number>
  /** The line index of the current (focused) match */
  currentMatchLine?: number
}

export function LogViewer({
  logs,
  maxLines = 6,
  scrollOffset,
  focused = false,
  matchLineIndices,
  currentMatchLine,
}: LogViewerProps) {
  // If scrollOffset is provided, use windowed rendering; otherwise show last N lines
  const total = logs.length
  const offset = scrollOffset ?? Math.max(0, total - maxLines)
  const visible = logs.slice(offset, offset + maxLines)

  const endLine = Math.min(offset + maxLines, total)
  const scrollIndicator = total > maxLines ? `[${offset + 1}-${endLine}/${total}]` : ''

  if (visible.length === 0) {
    return (
      <Box paddingX={1}>
        <Text dimColor>No log output yet.</Text>
      </Box>
    )
  }

  return (
    <Box flexDirection="column" paddingX={1}>
      {visible.map((entry, i) => {
        const lineIdx = offset + i
        const isCurrentMatch = currentMatchLine === lineIdx
        const isMatch = matchLineIndices?.has(lineIdx) ?? false
        return (
          <Text
            key={lineIdx}
            dimColor={!focused && !isMatch}
            color={isMatch ? 'yellow' : undefined}
            inverse={isCurrentMatch}
            wrap="truncate"
          >
            {entry.line}
          </Text>
        )
      })}
      {scrollIndicator && <Text dimColor>{scrollIndicator}</Text>}
    </Box>
  )
}
