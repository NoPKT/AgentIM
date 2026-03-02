import React from 'react'
import { Box, Text } from 'ink'

interface ActionBarProps {
  hasSelection: boolean
  loggedIn: boolean
}

function HotKey({ key, label }: { key: string; label: string }) {
  return (
    <Text>
      [
      <Text bold color="cyan">
        {key}
      </Text>
      ]{label}
    </Text>
  )
}

export function ActionBar({ hasSelection, loggedIn }: ActionBarProps) {
  return (
    <Box paddingX={1} gap={1}>
      <HotKey key="G" label="ateway" />
      {hasSelection && (
        <>
          <HotKey key="R" label="ename" />
          <HotKey key="S" label="top" />
          <HotKey key="D" label="elete" />
          <HotKey key="L" label="ogs" />
        </>
      )}
      <HotKey key="C" label="redentials" />
      {loggedIn && <HotKey key="O" label="ut" />}
      <HotKey key="Q" label="uit" />
    </Box>
  )
}
