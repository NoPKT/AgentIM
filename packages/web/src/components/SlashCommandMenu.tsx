import { useTranslation } from 'react-i18next'
import {
  getAllCommands,
  type SlashCommandHandler,
  type AgentCommandItem,
} from '../lib/slash-commands.js'

export type SlashMenuItem =
  | { type: 'platform'; handler: SlashCommandHandler }
  | { type: 'agent'; item: AgentCommandItem }

interface SlashCommandMenuProps {
  filter: string
  onSelect: (item: SlashMenuItem) => void
  activeIndex: number
  agentCommands: AgentCommandItem[]
}

export function SlashCommandMenu({
  filter,
  onSelect,
  activeIndex,
  agentCommands,
}: SlashCommandMenuProps) {
  const { t } = useTranslation()

  const platformCommands = getAllCommands().filter((cmd) =>
    cmd.command.name.toLowerCase().startsWith(filter.toLowerCase()),
  )

  const filteredAgentCommands = agentCommands.filter((item) =>
    item.command.name.toLowerCase().startsWith(filter.toLowerCase()),
  )

  const totalItems = platformCommands.length + filteredAgentCommands.length
  if (totalItems === 0) return null

  // Group agent commands by agent name
  const agentGroups = new Map<string, AgentCommandItem[]>()
  for (const item of filteredAgentCommands) {
    const key = `${item.agentId}:${item.agentName}`
    const group = agentGroups.get(key) ?? []
    group.push(item)
    agentGroups.set(key, group)
  }

  let globalIndex = 0

  return (
    <div
      id="slash-cmd-listbox"
      className="absolute bottom-full left-0 mb-1 w-72 bg-surface border border-border rounded-lg shadow-lg overflow-hidden overflow-y-auto max-h-64 z-dropdown"
      role="listbox"
      aria-label={t('slashCommand.menu')}
    >
      {/* Platform commands section */}
      {platformCommands.length > 0 && (
        <>
          <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-text-muted bg-surface-secondary border-b border-border">
            {t('slashCommand.platformCommands')}
          </div>
          {platformCommands.map((cmd) => {
            const idx = globalIndex++
            return (
              <button
                key={`p-${cmd.command.name}`}
                id={`slash-cmd-${idx}`}
                role="option"
                aria-selected={idx === activeIndex}
                className={`w-full text-left px-3 py-2 text-sm hover:bg-surface-hover transition-colors ${
                  idx === activeIndex ? 'bg-surface-hover' : ''
                }`}
                onClick={() => onSelect({ type: 'platform', handler: cmd })}
              >
                <div className="font-medium text-text-primary">/{cmd.command.name}</div>
                <div className="text-xs text-text-muted">{cmd.command.description}</div>
              </button>
            )
          })}
        </>
      )}

      {/* Agent commands section */}
      {[...agentGroups.entries()].map(([key, items]) => (
        <div key={key}>
          <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-text-muted bg-surface-secondary border-b border-border flex items-center gap-1.5">
            <span className="w-3.5 h-3.5 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-[8px] text-white font-bold">
              {items[0].agentName.charAt(0).toUpperCase()}
            </span>
            {items[0].agentName}
            <span className="text-text-muted font-normal">({items[0].agentType})</span>
          </div>
          {items.map((item) => {
            const idx = globalIndex++
            return (
              <button
                key={`a-${item.agentId}-${item.command.name}`}
                id={`slash-cmd-${idx}`}
                role="option"
                aria-selected={idx === activeIndex}
                className={`w-full text-left px-3 py-2 text-sm hover:bg-surface-hover transition-colors ${
                  idx === activeIndex ? 'bg-surface-hover' : ''
                }`}
                onClick={() => onSelect({ type: 'agent', item })}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium text-text-primary">/{item.command.name}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-secondary text-text-muted">
                    {item.command.source}
                  </span>
                </div>
                <div className="text-xs text-text-muted">{item.command.description}</div>
              </button>
            )
          })}
        </div>
      ))}
    </div>
  )
}
