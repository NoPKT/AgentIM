import React from 'react'
import { Box, Text } from 'ink'

export interface StatusBarItem {
  id: string
  label: string
  indicator?: React.ReactElement
}

interface StatusBarProps {
  serverUrl: string | null
  loggedIn: boolean
  gatewayRunning: boolean
  focused?: boolean
  selectedItem?: number
  items?: StatusBarItem[]
}

export function StatusBar({
  serverUrl,
  loggedIn,
  gatewayRunning,
  focused = false,
  selectedItem = 0,
  items,
}: StatusBarProps) {
  // Default navigable items
  const navItems: StatusBarItem[] = items ?? [
    {
      id: 'gateway',
      label: 'Gateway',
      indicator: gatewayRunning ? <Text color="green">● On</Text> : <Text color="gray">○ Off</Text>,
    },
    { id: 'credentials', label: 'Credentials' },
    { id: 'logout', label: 'Logout' },
  ]

  return (
    <Box
      width="100%"
      borderStyle="single"
      borderBottom={false}
      paddingX={1}
      justifyContent="space-between"
    >
      <Text bold color="cyan">
        AgentIM
      </Text>
      <Box gap={2}>
        {loggedIn && (
          <Text>
            <Text color="green">●</Text> {serverUrl ?? 'Connected'}
          </Text>
        )}
        {!loggedIn && (
          <Text>
            <Text color="red">●</Text> Not connected
          </Text>
        )}
        {navItems.map((item, i) => {
          const isSelected = focused && i === selectedItem
          return (
            <Text key={item.id} inverse={isSelected}>
              {' '}
              {item.label}
              {item.indicator && <> {item.indicator}</>}{' '}
            </Text>
          )
        })}
      </Box>
    </Box>
  )
}
