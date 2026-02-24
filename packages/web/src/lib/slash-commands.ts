import type { SlashCommand } from '@agentim/shared'

export interface SlashCommandHandler {
  command: SlashCommand
  execute: (args: string) => void | Promise<void>
}

const commandRegistry = new Map<string, SlashCommandHandler>()

export function registerCommand(handler: SlashCommandHandler): void {
  commandRegistry.set(handler.command.name, handler)
}

export function getCommand(name: string): SlashCommandHandler | undefined {
  return commandRegistry.get(name)
}

export function getAllCommands(): SlashCommandHandler[] {
  return Array.from(commandRegistry.values())
}

export function parseSlashCommand(input: string): { name: string; args: string } | null {
  if (!input.startsWith('/')) return null
  const trimmed = input.slice(1).trim()
  const spaceIndex = trimmed.indexOf(' ')
  if (spaceIndex === -1) return { name: trimmed, args: '' }
  return { name: trimmed.slice(0, spaceIndex), args: trimmed.slice(spaceIndex + 1).trim() }
}

// Register built-in commands
registerCommand({
  command: { name: 'clear', description: 'Clear the chat view', usage: '/clear' },
  execute: () => {
    // Will be connected to chat store
    window.dispatchEvent(new CustomEvent('slash:clear'))
  },
})

registerCommand({
  command: { name: 'help', description: 'Show available commands', usage: '/help' },
  execute: () => {
    window.dispatchEvent(new CustomEvent('slash:help'))
  },
})

registerCommand({
  command: { name: 'task', description: 'Create a new task', usage: '/task <title>' },
  execute: (args: string) => {
    window.dispatchEvent(new CustomEvent('slash:task', { detail: { title: args } }))
  },
})

registerCommand({
  command: { name: 'status', description: 'Show connection status', usage: '/status' },
  execute: () => {
    window.dispatchEvent(new CustomEvent('slash:status'))
  },
})
