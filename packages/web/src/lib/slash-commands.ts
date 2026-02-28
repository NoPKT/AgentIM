import i18next from 'i18next'
import type { SlashCommand, Agent, AgentSlashCommand } from '@agentim/shared'
import { useChatStore } from '../stores/chat.js'
import { useAgentStore } from '../stores/agents.js'
import { wsClient } from './ws.js'
import { toast } from '../stores/toast.js'

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
    const { currentRoomId, messages } = useChatStore.getState()
    if (!currentRoomId) return
    const msgs = new Map(messages)
    msgs.set(currentRoomId, [])
    useChatStore.setState({ messages: msgs })
    toast.success(i18next.t('slashCommand.chatCleared'))
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
    const commands = getAllCommands()
    const lines = commands.map((c) => `/${c.command.name} — ${c.command.description}`)
    toast.info(lines.join('\n'))
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
    const { currentRoomId, streaming } = useChatStore.getState()
    if (!currentRoomId) return

    // If an agent name is specified (e.g., "@agentname"), stop only that agent
    const agentName = args.replace(/^@/, '').trim()
    if (agentName) {
      const agents = useAgentStore.getState().agents
      const agent = agents.find((a) => a.name.toLowerCase() === agentName.toLowerCase())
      if (!agent) {
        toast.error(i18next.t('slashCommand.noAgentFound', { name: agentName }))
        return
      }
      wsClient.send({
        type: 'client:stop_generation',
        roomId: currentRoomId,
        agentId: agent.id,
      })
      toast.info(i18next.t('slashCommand.stopSent', { name: agent.name }))
      return
    }

    // No agent specified — stop all streaming agents in the current room
    const prefix = `${currentRoomId}:`
    let stopped = 0
    for (const [key, stream] of streaming.entries()) {
      if (key.startsWith(prefix)) {
        wsClient.send({
          type: 'client:stop_generation',
          roomId: currentRoomId,
          agentId: stream.agentId,
        })
        stopped++
      }
    }
    if (stopped > 0) {
      toast.info(i18next.t('slashCommand.stopSent', { name: `${stopped} agent(s)` }))
    } else {
      toast.info(i18next.t('slashCommand.noActiveStreams'))
    }
  },
})
