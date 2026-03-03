import React from 'react'
import { Box, Text, useInput } from 'ink'

export interface MenuItem {
  id: string
  label: string
}

interface ContextMenuProps {
  items: MenuItem[]
  selectedIndex: number
  onSelect: (id: string) => void
  onClose: () => void
  onNavigate: (index: number) => void
}

export function ContextMenu({
  items,
  selectedIndex,
  onSelect,
  onClose,
  onNavigate,
}: ContextMenuProps) {
  useInput((input, key) => {
    if (key.escape) {
      onClose()
      return
    }
    if (key.upArrow) {
      onNavigate(Math.max(0, selectedIndex - 1))
      return
    }
    if (key.downArrow) {
      onNavigate(Math.min(items.length - 1, selectedIndex + 1))
      return
    }
    if (key.return) {
      const item = items[selectedIndex]
      if (item) onSelect(item.id)
    }
  })

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      {items.map((item, i) => {
        const selected = i === selectedIndex
        return (
          <Text key={item.id} inverse={selected}>
            {selected ? ' > ' : '   '}
            {item.label}
          </Text>
        )
      })}
    </Box>
  )
}
