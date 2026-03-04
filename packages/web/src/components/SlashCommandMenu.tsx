import { useTranslation } from 'react-i18next'
import { getAllCommands, type SlashCommandHandler } from '../lib/slash-commands.js'

interface SlashCommandMenuProps {
  filter: string
  onSelect: (cmd: SlashCommandHandler) => void
  activeIndex: number
}

export function SlashCommandMenu({ filter, onSelect, activeIndex }: SlashCommandMenuProps) {
  const { t } = useTranslation()

  const platformCommands = getAllCommands().filter((cmd) =>
    cmd.command.name.toLowerCase().startsWith(filter.toLowerCase()),
  )

  if (platformCommands.length === 0) return null

  return (
    <div
      id="slash-cmd-listbox"
      className="absolute bottom-full left-0 mb-1 w-72 bg-surface border border-border rounded-lg shadow-lg overflow-hidden overflow-y-auto max-h-64 z-dropdown"
      role="listbox"
      aria-label={t('slashCommand.menu')}
    >
      <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-text-muted bg-surface-secondary border-b border-border">
        {t('slashCommand.platformCommands')}
      </div>
      {platformCommands.map((cmd, idx) => (
        <button
          key={cmd.command.name}
          id={`slash-cmd-${idx}`}
          role="option"
          aria-selected={idx === activeIndex}
          className={`w-full text-left px-3 py-2 text-sm hover:bg-surface-hover transition-colors ${
            idx === activeIndex ? 'bg-surface-hover' : ''
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
