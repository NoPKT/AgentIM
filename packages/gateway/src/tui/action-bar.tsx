import React from 'react'
import { Box, Text } from 'ink'

interface ActionBarProps {
  hasSelection: boolean
  loggedIn: boolean
}

function HotKey({ hotkey, label }: { hotkey: string; label: string }) {
  return (
    <Text>
      [
      <Text bold color="cyan">
        {hotkey}
      </Text>
      ]{label}
    </Text>
  )
}

export function ActionBar({ hasSelection, loggedIn }: ActionBarProps) {
  return (
    <Box paddingX={1} gap={1}>
      <HotKey hotkey="G" label="ateway" />
      {hasSelection && (
        <>
          <HotKey hotkey="R" label="ename" />
          <HotKey hotkey="S" label="top" />
          <HotKey hotkey="D" label="elete" />
          <HotKey hotkey="L" label="ogs" />
        </>
      )}
      <HotKey hotkey="C" label="redentials" />
      {loggedIn && <HotKey hotkey="O" label="ut" />}
      <HotKey hotkey="Q" label="uit" />
    </Box>
  )
}
