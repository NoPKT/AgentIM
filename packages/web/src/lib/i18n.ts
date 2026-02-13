import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { en, zhCN, ja, ko } from '@agentim/shared/i18n'

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: { ...en.common, ...en.auth, ...en.chat, ...en.agent, ...en.task, ...en.settings, ...en.error } },
      'zh-CN': { translation: { ...zhCN.common, ...zhCN.auth, ...zhCN.chat, ...zhCN.agent, ...zhCN.task, ...zhCN.settings, ...zhCN.error } },
      ja: { translation: { ...ja.common, ...ja.auth, ...ja.chat, ...ja.agent, ...ja.task, ...ja.settings, ...ja.error } },
      ko: { translation: { ...ko.common, ...ko.auth, ...ko.chat, ...ko.agent, ...ko.task, ...ko.settings, ...ko.error } },
    },
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: 'aim_language',
    },
  })

export default i18n
