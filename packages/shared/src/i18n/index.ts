export { en } from './locales/en.js'
export { zhCN } from './locales/zh-CN.js'
export { ja } from './locales/ja.js'
export { ko } from './locales/ko.js'
export { fr } from './locales/fr.js'
export { de } from './locales/de.js'
export { ru } from './locales/ru.js'

export const SUPPORTED_LANGUAGES = ['en', 'zh-CN', 'ja', 'ko', 'fr', 'de', 'ru'] as const
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number]

export const LANGUAGE_NAMES: Record<SupportedLanguage, string> = {
  en: 'English',
  'zh-CN': '简体中文',
  ja: '日本語',
  ko: '한국어',
  fr: 'Français',
  de: 'Deutsch',
  ru: 'Русский',
}

export const I18N_NAMESPACES = [
  'common',
  'auth',
  'chat',
  'agent',
  'task',
  'settings',
  'error',
  'router',
] as const
