import type { TFunction } from 'i18next'

export function getStatusConfig(t: TFunction) {
  return {
    online: {
      color: 'bg-green-500',
      label: t('online'),
      textColor: 'text-green-700',
      bgColor: 'bg-green-50',
    },
    offline: {
      color: 'bg-gray-400',
      label: t('offline'),
      textColor: 'text-gray-700',
      bgColor: 'bg-gray-50',
    },
    busy: {
      color: 'bg-yellow-500',
      label: t('busy'),
      textColor: 'text-yellow-700',
      bgColor: 'bg-yellow-50',
    },
    error: {
      color: 'bg-red-500',
      label: t('error'),
      textColor: 'text-red-700',
      bgColor: 'bg-red-50',
    },
  } as const
}

export function getTypeConfig(t: TFunction) {
  return {
    claude_code: {
      label: t('claudeCode'),
      color: 'bg-purple-100 text-purple-800',
    },
    codex: {
      label: t('codex'),
      color: 'bg-blue-100 text-blue-800',
    },
    gemini: {
      label: t('gemini'),
      color: 'bg-cyan-100 text-cyan-800',
    },
    cursor: {
      label: t('cursor'),
      color: 'bg-indigo-100 text-indigo-800',
    },
    generic: {
      label: t('generic'),
      color: 'bg-gray-100 text-gray-800',
    },
  } as Record<string, { label: string; color: string }>
}

export const agentGradients: Record<string, string> = {
  claude_code: 'from-purple-500 to-violet-600',
  codex: 'from-blue-500 to-indigo-600',
  gemini: 'from-cyan-500 to-teal-600',
  cursor: 'from-indigo-500 to-purple-600',
  generic: 'from-gray-500 to-gray-600',
}
