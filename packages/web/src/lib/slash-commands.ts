import type { SlashCommand, Agent, AgentSlashCommand } from '@agentim/shared'

export interface SlashCommandHandler {
  command: SlashCommand
  execute: (args: string) => void | Promise<void>
}

/** Represents an agent-specific command in the slash menu. */
export interface AgentCommandItem {
  agentId: string
  agentName: string
  agentType: string
  command: AgentSlashCommand
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
  if (trimmed.length === 0) return null
  const spaceIndex = trimmed.indexOf(' ')
  if (spaceIndex === -1) return { name: trimmed, args: '' }
  return { name: trimmed.slice(0, spaceIndex), args: trimmed.slice(spaceIndex + 1).trim() }
}

/**
 * Gather agent commands from agents in the current room.
 * Filters by agents that have slashCommands defined.
 */
export function getAgentCommands(roomAgents: Agent[]): AgentCommandItem[] {
  const items: AgentCommandItem[] = []
  for (const agent of roomAgents) {
    if (!agent.slashCommands?.length) continue
    for (const cmd of agent.slashCommands) {
      items.push({
        agentId: agent.id,
        agentName: agent.name,
        agentType: agent.type,
        command: cmd,
      })
    }
  }
  return items
}

// Register built-in platform commands
registerCommand({
  command: { name: 'clear', description: 'Clear the chat view', usage: '/clear', clientOnly: true },
  execute: () => {
    window.dispatchEvent(new CustomEvent('slash:clear'))
  },
})

registerCommand({
  command: {
    name: 'help',
    description: 'Show available commands',
    usage: '/help',
    clientOnly: true,
  },
  execute: () => {
    window.dispatchEvent(new CustomEvent('slash:help'))
  },
})

registerCommand({
  command: {
    name: 'stop',
    description: 'Stop agent generation',
    usage: '/stop @agent',
    clientOnly: false,
  },
  execute: (args: string) => {
    window.dispatchEvent(new CustomEvent('slash:stop', { detail: { args } }))
  },
})

registerCommand({
  command: {
    name: 'agents',
    description: 'Show agents in room',
    usage: '/agents',
    clientOnly: true,
  },
  execute: () => {
    window.dispatchEvent(new CustomEvent('slash:agents'))
  },
})
