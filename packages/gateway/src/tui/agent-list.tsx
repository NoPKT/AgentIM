import React from 'react'
import { Box, Text } from 'ink'
import type { DaemonEntry } from './hooks/use-daemons.js'
import { formatCost, truncate } from './lib/format.js'

interface AgentListProps {
  daemons: DaemonEntry[]
  selectedIndex: number
  focused?: boolean
}

function statusIndicator(entry: DaemonEntry): React.ReactElement {
  if (!entry.info.alive) return <Text color="red">● dead</Text>
  if (entry.stale) return <Text color="yellow">● stale</Text>
  if (entry.status?.running) return <Text color="green">● busy</Text>
  if (entry.info.type === 'gateway') return <Text color="green">● online</Text>
  return <Text color="cyan">● idle</Text>
}

export function AgentList({ daemons, selectedIndex, focused = false }: AgentListProps) {
  if (daemons.length === 0) {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text dimColor>No running agents.</Text>
        <Text dimColor>Start gateway from the status bar.</Text>
      </Box>
    )
  }

  return (
    <Box flexDirection="column" paddingX={1}>
      {daemons.map((entry, i) => {
        const selected = i === selectedIndex
        const prefix = selected && focused ? '> ' : selected ? '  ' : '  '
        const name = truncate(entry.info.name, 20)
        const type = truncate(entry.info.type || '—', 10)
        const cost = entry.status ? formatCost(entry.status.costUSD) : '—'
        const isGatewayChild = entry.info.gatewayId !== 'ephemeral' && entry.info.type !== 'gateway'

        return (
          <Text key={entry.info.name} inverse={selected && focused}>
            {isGatewayChild ? '  └ ' : ''}
            {prefix}
            {name.padEnd(isGatewayChild ? 16 : 20)}
            {'  '}
            {type.padEnd(10)}
            {'  '}
            {statusIndicator(entry)}
            {'  '}
            {cost.padStart(7)}
          </Text>
        )
      })}
    </Box>
  )
}
