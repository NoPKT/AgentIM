import { create } from 'zustand'

type ThemeMode = 'light' | 'dark' | 'system'

interface ThemeState {
  mode: ThemeMode
  setMode: (mode: ThemeMode) => void
  isDark: boolean
}

const STORAGE_KEY = 'agentim_theme'

function getInitialMode(): ThemeMode {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored === 'light' || stored === 'dark' || stored === 'system') return stored
  return 'system'
}

function resolveIsDark(mode: ThemeMode): boolean {
  if (mode === 'dark') return true
  if (mode === 'light') return false
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

function applyTheme(isDark: boolean) {
  document.documentElement.classList.toggle('dark', isDark)
}

const initialMode = getInitialMode()
const initialIsDark = resolveIsDark(initialMode)
applyTheme(initialIsDark)

export const useThemeStore = create<ThemeState>((set) => ({
  mode: initialMode,
  isDark: initialIsDark,
  setMode: (mode) => {
    localStorage.setItem(STORAGE_KEY, mode)
    const isDark = resolveIsDark(mode)
    applyTheme(isDark)
    set({ mode, isDark })
  },
}))

// Listen for system theme changes
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  const { mode } = useThemeStore.getState()
  if (mode === 'system') {
    const isDark = resolveIsDark('system')
    applyTheme(isDark)
    useThemeStore.setState({ isDark })
  }
})
