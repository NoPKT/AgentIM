import React from 'react'
import { Box, Text, useFocus, useInput } from 'ink'

export type ActionDef = {
  id: string
  hotkey: string
  label: string
}

interface ActionBarProps {
  actions: ActionDef[]
  onAction: (id: string) => void
}

function ActionButton({
  id,
  hotkey,
  label,
  onActivate,
}: {
  id: string
  hotkey: string
  label: string
  onActivate: () => void
}) {
  const { isFocused } = useFocus({ id })

  useInput(
    (_input, key) => {
      if (key.return || _input === ' ') onActivate()
    },
    { isActive: isFocused },
  )

  return (
    <Text inverse={isFocused}>
      [
      <Text bold color={isFocused ? undefined : 'cyan'}>
        {hotkey}
      </Text>
      ]{label}
    </Text>
  )
}

export function ActionBar({ actions, onAction }: ActionBarProps) {
  return (
    <Box paddingX={1} gap={1}>
      {actions.map((a) => (
        <ActionButton
          key={a.id}
          id={`action-${a.id}`}
          hotkey={a.hotkey}
          label={a.label}
          onActivate={() => onAction(a.id)}
        />
      ))}
    </Box>
  )
}
