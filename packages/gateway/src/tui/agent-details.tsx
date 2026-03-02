import React from 'react'
import { Box, Text } from 'ink'
import type { DaemonEntry } from './hooks/use-daemons.js'
import { formatCost, formatTokens, formatUptime } from './lib/format.js'

interface AgentDetailsProps {
  entry: DaemonEntry | null
}

function DetailRow({ label, value }: { label: string; value: string | React.ReactElement }) {
  return (
    <Box>
      <Text dimColor>{label.padEnd(12)}</Text>
      <Text>{value}</Text>
    </Box>
  )
}

export function AgentDetails({ entry }: AgentDetailsProps) {
  if (!entry) {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text dimColor>Select an agent to view details.</Text>
      </Box>
    )
  }

  const { info, status, stale } = entry
  const uptime = formatUptime(Date.now() - new Date(info.startedAt).getTime())
  const inputTokens = status ? formatTokens(status.inputTokens) : '—'
  const outputTokens = status ? formatTokens(status.outputTokens) : '—'

  return (
    <Box flexDirection="column" paddingX={1}>
      <DetailRow label="Name:" value={info.name} />
      <DetailRow label="Type:" value={info.type} />
      {status?.model && <DetailRow label="Model:" value={status.model} />}
      <DetailRow label="Cost:" value={status ? formatCost(status.costUSD) : '—'} />
      <DetailRow label="Tokens:" value={`${inputTokens} / ${outputTokens}`} />
      {status?.thinkingMode && <DetailRow label="Thinking:" value={status.thinkingMode} />}
      {status?.effortLevel && <DetailRow label="Effort:" value={status.effortLevel} />}
      <DetailRow label="Work Dir:" value={info.workDir} />
      <DetailRow label="Uptime:" value={uptime} />
      <DetailRow label="PID:" value={String(info.pid)} />
      {stale && <Text color="yellow">(stale — status not updated recently)</Text>}
      {!info.alive && <Text color="red">(process not running)</Text>}
    </Box>
  )
}
