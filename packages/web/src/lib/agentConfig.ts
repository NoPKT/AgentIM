import type { TFunction } from 'i18next'

export function getStatusConfig(t: TFunction) {
  return {
    online: {
      color: 'bg-green-500',
      label: t('common.online'),
      textColor: 'text-green-700',
      bgColor: 'bg-green-50',
    },
    offline: {
      color: 'bg-gray-400',
      label: t('common.offline'),
      textColor: 'text-gray-700',
      bgColor: 'bg-gray-50',
    },
    busy: {
      color: 'bg-yellow-500',
      label: t('common.busy'),
      textColor: 'text-yellow-700',
      bgColor: 'bg-yellow-50',
    },
    error: {
      color: 'bg-red-500',
      label: t('common.error'),
      textColor: 'text-red-700',
      bgColor: 'bg-red-50',
    },
  } as const
}

export function getTypeConfig(t: TFunction) {
  return {
    'claude-code': {
      label: t('agent.claudeCode'),
      color: 'bg-role-bg text-role-text',
    },
    codex: {
      label: t('agent.codex'),
      color: 'bg-info-muted text-info-text',
    },
    gemini: {
      label: t('agent.gemini'),
      color: 'bg-cyan-100 dark:bg-cyan-900/30 text-cyan-800 dark:text-cyan-300',
    },
    cursor: {
      label: t('agent.cursor'),
      color: 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-800 dark:text-indigo-300',
    },
    generic: {
      label: t('agent.generic'),
      color: 'bg-badge-bg text-badge-text',
    },
  } as Record<string, { label: string; color: string }>
}

export const agentGradients: Record<string, string> = {
  'claude-code': 'from-purple-500 to-violet-600',
  codex: 'from-blue-500 to-indigo-600',
  gemini: 'from-cyan-500 to-teal-600',
  cursor: 'from-indigo-500 to-purple-600',
  generic: 'from-gray-500 to-gray-600',
}

/** SVG path data for each agent type icon (rendered at 24x24 viewBox) */
export const agentTypeIcons: Record<string, { paths: string[]; viewBox?: string }> = {
  // Anthropic-inspired: hexagonal crystal shape
  'claude-code': {
    paths: ['M12 2L3 7v10l9 5 9-5V7l-9-5zm0 3l5.5 3v6L12 17l-5.5-3V8L12 5z'],
  },
  // Code brackets: </>
  codex: {
    paths: [
      'M9.4 16.6L4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4z',
      'M14.6 16.6L19.2 12l-4.6-4.6L16 6l6 6-6 6-1.4-1.4z',
    ],
  },
  // Four-pointed star / sparkle (Gemini-inspired)
  gemini: {
    paths: ['M12 2C12 2 14 8 16 10s6 2 6 2-4 0-6 2-4 8-4 8-2-6-4-8-6-2-6-2 4 0 6-2 4-8 4-8z'],
  },
  // Cursor arrow
  cursor: {
    paths: ['M5 3l14 9-6 1 3 7-3 1-3-7-5 4V3z'],
  },
  // Robot/gear
  generic: {
    paths: [
      'M12 2a2 2 0 012 2v1h3a2 2 0 012 2v3h1a2 2 0 010 4h-1v3a2 2 0 01-2 2H7a2 2 0 01-2-2v-3H4a2 2 0 010-4h1V7a2 2 0 012-2h3V4a2 2 0 012-2zm-2 8a1 1 0 100 2 1 1 0 000-2zm4 0a1 1 0 100 2 1 1 0 000-2z',
    ],
  },
}
