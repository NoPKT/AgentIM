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

/** Apply theme immediately without transition (used at initialization). */
function applyThemeImmediate(isDark: boolean) {
  document.documentElement.classList.toggle('dark', isDark)
}

/** Apply theme with a smooth CSS transition. */
function applyTheme(isDark: boolean) {
  document.documentElement.classList.add('theme-transitioning')
  document.documentElement.classList.toggle('dark', isDark)
  // Remove the transition class after the animation completes
  setTimeout(() => {
    document.documentElement.classList.remove('theme-transitioning')
  }, 300)
}

const initialMode = getInitialMode()
const initialIsDark = resolveIsDark(initialMode)
applyThemeImmediate(initialIsDark)

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
const systemThemeMediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
const systemThemeHandler = () => {
  const { mode } = useThemeStore.getState()
  if (mode === 'system') {
    const isDark = resolveIsDark('system')
    applyTheme(isDark)
    useThemeStore.setState({ isDark })
  }
}
systemThemeMediaQuery.addEventListener('change', systemThemeHandler)

/** Remove the system theme media query listener (useful for cleanup in tests). */
export function unsubscribeSystemTheme() {
  systemThemeMediaQuery.removeEventListener('change', systemThemeHandler)
}
