import { create } from 'zustand'
import type { ServiceAgent } from '@agentim/shared'
import { api } from '../lib/api.js'

interface ServiceAgentsState {
  serviceAgents: ServiceAgent[]
  loading: boolean
  error: string | null

  fetchServiceAgents: () => Promise<void>
  createServiceAgent: (data: Record<string, unknown>) => Promise<ServiceAgent>
  updateServiceAgent: (id: string, data: Record<string, unknown>) => Promise<void>
  deleteServiceAgent: (id: string) => Promise<void>
  reset: () => void
}

export const useServiceAgentsStore = create<ServiceAgentsState>((set, get) => ({
  serviceAgents: [],
  loading: false,
  error: null,

  fetchServiceAgents: async () => {
    set({ loading: true, error: null })
    try {
      const res = await api.get<ServiceAgent[]>('/service-agents')
      if (res.ok && res.data) {
        set({ serviceAgents: res.data, loading: false })
      } else {
        set({ error: res.error ?? 'Failed to fetch', loading: false })
      }
    } catch (err) {
      set({ error: (err as Error).message, loading: false })
    }
  },

  createServiceAgent: async (body) => {
    const res = await api.post<ServiceAgent>('/service-agents', body)
    if (!res.ok) throw new Error(res.error ?? 'Failed to create')
    await get().fetchServiceAgents()
    return res.data!
  },

  updateServiceAgent: async (id, body) => {
    const res = await api.put<ServiceAgent>(`/service-agents/${id}`, body)
    if (!res.ok) throw new Error(res.error ?? 'Failed to update')
    await get().fetchServiceAgents()
  },

  deleteServiceAgent: async (id) => {
    const res = await api.delete(`/service-agents/${id}`)
    if (!res.ok) throw new Error(res.error ?? 'Failed to delete')
    set((state) => ({
      serviceAgents: state.serviceAgents.filter((sa) => sa.id !== id),
    }))
  },

  reset: () => set({ serviceAgents: [], loading: false, error: null }),
}))
