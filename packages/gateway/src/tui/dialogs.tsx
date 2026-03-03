import React, { useState } from 'react'
import { Box, Text, useInput } from 'ink'
import TextInput from 'ink-text-input'

interface RenameDialogProps {
  currentName: string
  onSubmit: (newName: string) => void
  onCancel: () => void
}

export function RenameDialog({ currentName, onSubmit, onCancel }: RenameDialogProps) {
  const [value, setValue] = useState(currentName)

  useInput((_input, key) => {
    if (key.escape) onCancel()
  })

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={2} paddingY={1}>
      <Text bold color="cyan">
        Rename Agent
      </Text>
      <Box marginTop={1}>
        <Text>Current: {currentName}</Text>
      </Box>
      <Box marginTop={1}>
        <Text>New name: </Text>
        <Box>
          <TextInput
            value={value}
            onChange={setValue}
            onSubmit={(val) => {
              const trimmed = val.trim()
              if (trimmed && trimmed !== currentName) {
                onSubmit(trimmed)
              } else {
                onCancel()
              }
            }}
          />
        </Box>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>Enter: confirm | Esc: cancel</Text>
      </Box>
    </Box>
  )
}

interface ConfirmDialogProps {
  title?: string
  message: string
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({ title, message, onConfirm, onCancel }: ConfirmDialogProps) {
  useInput((input, key) => {
    if (input === 'y' || input === 'Y') onConfirm()
    else if (input === 'n' || input === 'N' || key.escape) onCancel()
  })

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={2} paddingY={1}>
      {title && (
        <Text bold color="yellow">
          {title}
        </Text>
      )}
      <Box marginTop={title ? 1 : 0}>
        <Text>{message}</Text>
      </Box>
      <Box marginTop={1} gap={2}>
        <Text bold>[Y]es</Text>
        <Text bold>[N]o</Text>
      </Box>
    </Box>
  )
}

interface MessageBoxProps {
  message: string
  color?: string
}

export function MessageBox({ message, color = 'green' }: MessageBoxProps) {
  return (
    <Box paddingX={1}>
      <Text color={color}>{message}</Text>
    </Box>
  )
}
