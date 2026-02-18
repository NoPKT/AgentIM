import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { en, zhCN, ja, ko, fr, de, ru } from '@agentim/shared/i18n'

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: {
        translation: {
          ...en.common,
          ...en.auth,
          ...en.chat,
          ...en.agent,
          ...en.task,
          ...en.settings,
          ...en.error,
          ...en.router,
        },
      },
      'zh-CN': {
        translation: {
          ...zhCN.common,
          ...zhCN.auth,
          ...zhCN.chat,
          ...zhCN.agent,
          ...zhCN.task,
          ...zhCN.settings,
          ...zhCN.error,
          ...zhCN.router,
        },
      },
      ja: {
        translation: {
          ...ja.common,
          ...ja.auth,
          ...ja.chat,
          ...ja.agent,
          ...ja.task,
          ...ja.settings,
          ...ja.error,
          ...ja.router,
        },
      },
      ko: {
        translation: {
          ...ko.common,
          ...ko.auth,
          ...ko.chat,
          ...ko.agent,
          ...ko.task,
          ...ko.settings,
          ...ko.error,
          ...ko.router,
        },
      },
      fr: {
        translation: {
          ...fr.common,
          ...fr.auth,
          ...fr.chat,
          ...fr.agent,
          ...fr.task,
          ...fr.settings,
          ...fr.error,
          ...fr.router,
        },
      },
      de: {
        translation: {
          ...de.common,
          ...de.auth,
          ...de.chat,
          ...de.agent,
          ...de.task,
          ...de.settings,
          ...de.error,
          ...de.router,
        },
      },
      ru: {
        translation: {
          ...ru.common,
          ...ru.auth,
          ...ru.chat,
          ...ru.agent,
          ...ru.task,
          ...ru.settings,
          ...ru.error,
          ...ru.router,
        },
      },
    },
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: 'agentim_language',
    },
  })

export default i18n
