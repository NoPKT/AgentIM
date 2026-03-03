import React from 'react'
import { Box, Text } from 'ink'

interface HelpBarProps {
  hints: string
}

export function HelpBar({ hints }: HelpBarProps) {
  return (
    <Box paddingX={1}>
      <Text dimColor>{hints}</Text>
    </Box>
  )
}
