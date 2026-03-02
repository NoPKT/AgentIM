import React from 'react'
import { Box, Text } from 'ink'
import type { LogEntry } from './hooks/use-logs.js'

interface LogViewerProps {
  logs: LogEntry[]
  maxLines?: number
}

export function LogViewer({ logs, maxLines = 6 }: LogViewerProps) {
  const visible = logs.slice(-maxLines)

  if (visible.length === 0) {
    return (
      <Box paddingX={1}>
        <Text dimColor>No log output yet.</Text>
      </Box>
    )
  }

  return (
    <Box flexDirection="column" paddingX={1}>
      {visible.map((entry, i) => (
        <Text key={i} dimColor wrap="truncate">
          {entry.line}
        </Text>
      ))}
    </Box>
  )
}
