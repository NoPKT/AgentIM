import { useTranslation } from 'react-i18next'
import { getAllCommands, type SlashCommandHandler } from '../lib/slash-commands.js'

interface SlashCommandMenuProps {
  filter: string
  onSelect: (command: SlashCommandHandler) => void
  activeIndex: number
}

export function SlashCommandMenu({ filter, onSelect, activeIndex }: SlashCommandMenuProps) {
  const { t } = useTranslation()
  const commands = getAllCommands().filter((cmd) =>
    cmd.command.name.toLowerCase().startsWith(filter.toLowerCase()),
  )

  if (commands.length === 0) return null

  return (
    <div
      id="slash-cmd-listbox"
      className="absolute bottom-full left-0 mb-1 w-64 bg-surface border border-border rounded-lg shadow-lg overflow-hidden z-dropdown"
      role="listbox"
      aria-label={t('slashCommand.menu')}
    >
      {commands.map((cmd, index) => (
        <button
          key={cmd.command.name}
          id={`slash-cmd-${cmd.command.name}`}
          role="option"
          aria-selected={index === activeIndex}
          className={`w-full text-left px-3 py-2 text-sm hover:bg-surface-hover transition-colors ${
            index === activeIndex ? 'bg-surface-hover' : ''
          }`}
          onClick={() => onSelect(cmd)}
        >
          <div className="font-medium text-text-primary">/{cmd.command.name}</div>
          <div className="text-xs text-text-muted">{cmd.command.description}</div>
        </button>
      ))}
    </div>
  )
}
