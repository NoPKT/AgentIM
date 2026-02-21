import { create } from 'zustand'
import { api } from '../lib/api.js'

export interface SettingItem {
  key: string
  value: string
  type: 'string' | 'number' | 'boolean' | 'enum'
  sensitive: boolean
  enumValues?: string[]
  min?: number
  max?: number
  labelKey: string
  descKey: string
  source: 'db' | 'env' | 'default'
}

interface AdminSettingsState {
  groups: Record<string, SettingItem[]>
  loading: boolean
  saving: boolean
  error: string | null
  loadSettings: () => Promise<void>
  saveSettings: (changes: Record<string, string>) => Promise<{ ok: boolean; error?: string }>
}

export const useAdminSettingsStore = create<AdminSettingsState>((set) => ({
  groups: {},
  loading: false,
  saving: false,
  error: null,

  loadSettings: async () => {
    set({ loading: true, error: null })
    const res = await api.get<Record<string, SettingItem[]>>('/admin/settings')
    if (res.ok && res.data) {
      set({ groups: res.data, loading: false })
    } else {
      set({ error: res.error || 'Failed to load settings', loading: false })
    }
  },

  saveSettings: async (changes) => {
    set({ saving: true })
    const res = await api.put<{ updated: string[] }>('/admin/settings', { changes })
    set({ saving: false })
    return { ok: !!res.ok, error: res.error }
  },
}))
