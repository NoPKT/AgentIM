// Polyfill IndexedDB for happy-dom (eliminates IDBKeyRange errors in tests)
import 'fake-indexeddb/auto'
import '@testing-library/jest-dom'
import { vi } from 'vitest'

// Mock react-i18next to avoid i18next initialization in tests
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
  Trans: ({ children }: { children: React.ReactNode }) => children,
  initReactI18next: { type: '3rdParty', init: vi.fn() },
}))
