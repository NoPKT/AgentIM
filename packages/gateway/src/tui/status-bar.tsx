import React from 'react'
import { Box, Text } from 'ink'

interface StatusBarProps {
  serverUrl: string | null
  loggedIn: boolean
  gatewayRunning: boolean
}

export function StatusBar({ serverUrl, loggedIn, gatewayRunning }: StatusBarProps) {
  return (
    <Box borderStyle="single" borderBottom={false} paddingX={1} justifyContent="space-between">
      <Text bold color="cyan">
        AgentIM
      </Text>
      <Box gap={2}>
        {loggedIn ? (
          <>
            <Text>
              <Text color="green">●</Text> Connected
            </Text>
            <Text dimColor>Server: {serverUrl ?? '—'}</Text>
          </>
        ) : (
          <Text>
            <Text color="red">●</Text> Not connected
          </Text>
        )}
        <Text>
          [G] {gatewayRunning ? <Text color="green">● On</Text> : <Text color="gray">○ Off</Text>}
        </Text>
      </Box>
    </Box>
  )
}
