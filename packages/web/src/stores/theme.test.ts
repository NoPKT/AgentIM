import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Mock localStorage with a simple in-memory implementation
const storage = new Map<string, string>()
const mockLocalStorage = {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
  removeItem: (key: string) => storage.delete(key),
  clear: () => storage.clear(),
  get length() {
    return storage.size
  },
  key: (index: number) => [...storage.keys()][index] ?? null,
}
vi.stubGlobal('localStorage', mockLocalStorage)

// Mock matchMedia before importing the store
const mockAddEventListener = vi.fn()
const mockRemoveEventListener = vi.fn()
vi.stubGlobal(
  'matchMedia',
  vi.fn().mockImplementation((query: string) => ({
    matches: query === '(prefers-color-scheme: dark)',
    media: query,
    onchange: null,
    addEventListener: mockAddEventListener,
    removeEventListener: mockRemoveEventListener,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
)

describe('useThemeStore', () => {
  beforeEach(() => {
    storage.clear()
    document.documentElement.classList.remove('dark', 'theme-transitioning')
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('defaults to system mode when no stored preference', async () => {
    vi.resetModules()
    const { useThemeStore } = await import('./theme.js')
    const state = useThemeStore.getState()
    expect(state.mode).toBe('system')
  })

  it('reads stored mode from localStorage', async () => {
    storage.set('agentim_theme', 'dark')
    vi.resetModules()
    const { useThemeStore } = await import('./theme.js')
    const state = useThemeStore.getState()
    expect(state.mode).toBe('dark')
    expect(state.isDark).toBe(true)
  })

  it('setMode updates state and localStorage', async () => {
    vi.resetModules()
    const { useThemeStore } = await import('./theme.js')
    useThemeStore.getState().setMode('light')
    expect(useThemeStore.getState().mode).toBe('light')
    expect(useThemeStore.getState().isDark).toBe(false)
    expect(storage.get('agentim_theme')).toBe('light')
  })

  it('setMode("dark") sets isDark to true', async () => {
    vi.resetModules()
    const { useThemeStore } = await import('./theme.js')
    useThemeStore.getState().setMode('dark')
    expect(useThemeStore.getState().isDark).toBe(true)
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('setMode adds and removes theme-transitioning class', async () => {
    vi.resetModules()
    const { useThemeStore } = await import('./theme.js')
    useThemeStore.getState().setMode('dark')
    expect(document.documentElement.classList.contains('theme-transitioning')).toBe(true)
    vi.advanceTimersByTime(300)
    expect(document.documentElement.classList.contains('theme-transitioning')).toBe(false)
  })

  it('ignores invalid stored values', async () => {
    storage.set('agentim_theme', 'invalid-value')
    vi.resetModules()
    const { useThemeStore } = await import('./theme.js')
    expect(useThemeStore.getState().mode).toBe('system')
  })

  it('unsubscribeSystemTheme removes the media query listener', async () => {
    vi.resetModules()
    const { unsubscribeSystemTheme } = await import('./theme.js')
    unsubscribeSystemTheme()
    expect(mockRemoveEventListener).toHaveBeenCalled()
  })
})
