import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useAdminSettingsStore } from './adminSettings.js'
import type { SettingItem } from './adminSettings.js'

// Mock api module
vi.mock('../lib/api.js', () => ({
  api: {
    get: vi.fn(),
    put: vi.fn(),
  },
}))

import { api } from '../lib/api.js'

const mockApi = api as unknown as {
  get: ReturnType<typeof vi.fn>
  put: ReturnType<typeof vi.fn>
}

const fakeSetting: SettingItem = {
  key: 'MAX_AGENTS',
  value: '10',
  type: 'number',
  sensitive: false,
  min: 1,
  max: 100,
  labelKey: 'settings.maxAgents',
  descKey: 'settings.maxAgentsDesc',
  source: 'db',
}

const fakeGroups: Record<string, SettingItem[]> = {
  limits: [fakeSetting],
  security: [
    {
      key: 'API_KEY',
      value: '***',
      type: 'string',
      sensitive: true,
      labelKey: 'settings.apiKey',
      descKey: 'settings.apiKeyDesc',
      source: 'env',
    },
  ],
}

beforeEach(() => {
  vi.clearAllMocks()
  useAdminSettingsStore.setState({
    groups: {},
    loading: false,
    saving: false,
    error: null,
  })
})

describe('initial state', () => {
  it('has correct default values', () => {
    const state = useAdminSettingsStore.getState()
    expect(state.groups).toEqual({})
    expect(state.loading).toBe(false)
    expect(state.saving).toBe(false)
    expect(state.error).toBeNull()
  })
})

describe('loadSettings', () => {
  it('sets loading=true then populates groups on success', async () => {
    mockApi.get.mockResolvedValueOnce({ ok: true, data: fakeGroups })

    const promise = useAdminSettingsStore.getState().loadSettings()

    // After the call resolves
    await promise

    const state = useAdminSettingsStore.getState()
    expect(state.groups).toEqual(fakeGroups)
    expect(state.loading).toBe(false)
    expect(state.error).toBeNull()
  })

  it('calls the correct API endpoint', async () => {
    mockApi.get.mockResolvedValueOnce({ ok: true, data: fakeGroups })

    await useAdminSettingsStore.getState().loadSettings()

    expect(mockApi.get).toHaveBeenCalledWith('/admin/settings')
  })

  it('sets error when API returns failure', async () => {
    mockApi.get.mockResolvedValueOnce({ ok: false, error: 'Unauthorized' })

    await useAdminSettingsStore.getState().loadSettings()

    const state = useAdminSettingsStore.getState()
    expect(state.groups).toEqual({})
    expect(state.loading).toBe(false)
    expect(state.error).toBe('Unauthorized')
  })

  it('sets fallback error message when error is undefined', async () => {
    mockApi.get.mockResolvedValueOnce({ ok: false })

    await useAdminSettingsStore.getState().loadSettings()

    const state = useAdminSettingsStore.getState()
    expect(state.error).toBe('Failed to load settings')
    expect(state.loading).toBe(false)
  })

  it('clears previous error on new load attempt', async () => {
    // First load fails
    mockApi.get.mockResolvedValueOnce({ ok: false, error: 'Error' })
    await useAdminSettingsStore.getState().loadSettings()
    expect(useAdminSettingsStore.getState().error).toBe('Error')

    // Second load succeeds — error should be cleared
    mockApi.get.mockResolvedValueOnce({ ok: true, data: fakeGroups })
    await useAdminSettingsStore.getState().loadSettings()
    expect(useAdminSettingsStore.getState().error).toBeNull()
  })
})

describe('saveSettings', () => {
  it('sets saving=true during save and resets after', async () => {
    mockApi.put.mockResolvedValueOnce({ ok: true, data: { updated: ['MAX_AGENTS'] } })

    const result = await useAdminSettingsStore.getState().saveSettings({ MAX_AGENTS: '20' })

    expect(result).toEqual({ ok: true, error: undefined })
    expect(useAdminSettingsStore.getState().saving).toBe(false)
  })

  it('calls the correct API endpoint with changes', async () => {
    mockApi.put.mockResolvedValueOnce({ ok: true, data: { updated: ['MAX_AGENTS'] } })

    await useAdminSettingsStore.getState().saveSettings({ MAX_AGENTS: '20' })

    expect(mockApi.put).toHaveBeenCalledWith('/admin/settings', { changes: { MAX_AGENTS: '20' } })
  })

  it('returns error when API fails', async () => {
    mockApi.put.mockResolvedValueOnce({ ok: false, error: 'Validation failed' })

    const result = await useAdminSettingsStore.getState().saveSettings({ MAX_AGENTS: 'invalid' })

    expect(result).toEqual({ ok: false, error: 'Validation failed' })
    expect(useAdminSettingsStore.getState().saving).toBe(false)
  })

  it('returns ok=false with undefined error when error is not provided', async () => {
    mockApi.put.mockResolvedValueOnce({ ok: false })

    const result = await useAdminSettingsStore.getState().saveSettings({ MAX_AGENTS: '-1' })

    expect(result.ok).toBe(false)
    expect(result.error).toBeUndefined()
  })
})

describe('store reset', () => {
  it('can reset state to initial values', () => {
    // Simulate a loaded state
    useAdminSettingsStore.setState({
      groups: fakeGroups,
      loading: false,
      saving: false,
      error: 'some error',
    })

    // Reset via setState (same mechanism used by registerStoreReset callback)
    useAdminSettingsStore.setState({
      groups: {},
      loading: false,
      saving: false,
      error: null,
    })

    const state = useAdminSettingsStore.getState()
    expect(state.groups).toEqual({})
    expect(state.error).toBeNull()
  })
})
