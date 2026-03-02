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
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      <Text bold>Rename Agent</Text>
      <Box>
        <Text>New name: </Text>
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
      <Text dimColor>Enter to confirm, Esc to cancel</Text>
    </Box>
  )
}

interface ConfirmDialogProps {
  message: string
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({ message, onConfirm, onCancel }: ConfirmDialogProps) {
  useInput((input, key) => {
    if (input === 'y' || input === 'Y') onConfirm()
    else if (input === 'n' || input === 'N' || key.escape) onCancel()
  })

  return (
    <Box borderStyle="round" borderColor="yellow" paddingX={1}>
      <Text>{message} </Text>
      <Text bold>[Y/N]</Text>
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
