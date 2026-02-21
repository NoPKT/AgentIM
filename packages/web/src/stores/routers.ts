import { create } from 'zustand'
import type { Router } from '@agentim/shared'
import type { z } from 'zod'
import type { updateRouterSchema } from '@agentim/shared'
import { api } from '../lib/api.js'
import { toast } from './toast.js'

type UpdateRouterData = z.infer<typeof updateRouterSchema>

interface RoutersState {
  routers: Router[]
  loading: boolean
  loadRouters: () => Promise<void>
  createRouter: (
    data: Omit<Router, 'id' | 'createdById' | 'createdAt' | 'updatedAt'>,
  ) => Promise<Router>
  updateRouter: (id: string, data: UpdateRouterData) => Promise<void>
  deleteRouter: (id: string) => Promise<void>
  testRouter: (id: string) => Promise<boolean>
}

export const useRouterStore = create<RoutersState>((set, get) => ({
  routers: [],
  loading: false,

  loadRouters: async () => {
    if (get().loading) return
    set({ loading: true })
    try {
      const res = await api.get<Router[]>('/routers')
      if (res.ok && res.data) {
        set({ routers: res.data })
      }
    } catch {
      toast.error('Failed to load routers')
    } finally {
      set({ loading: false })
    }
  },

  createRouter: async (data) => {
    const res = await api.post<Router>('/routers', data)
    if (!res.ok || !res.data) throw new Error(res.error ?? 'Failed to create router')
    set({ routers: [...get().routers, res.data] })
    return res.data
  },

  updateRouter: async (id, data) => {
    const res = await api.put<Router>(`/routers/${id}`, data)
    if (!res.ok || !res.data) throw new Error(res.error ?? 'Failed to update router')
    set({
      routers: get().routers.map((r) => (r.id === id ? { ...r, ...res.data } : r)),
    })
  },

  deleteRouter: async (id) => {
    const res = await api.delete(`/routers/${id}`)
    if (!res.ok) throw new Error(res.error ?? 'Failed to delete router')
    set({ routers: get().routers.filter((r) => r.id !== id) })
  },

  testRouter: async (id) => {
    const res = await api.post<{ success: boolean; error?: string }>(`/routers/${id}/test`)
    if (!res.ok || !res.data) return false
    return res.data.success
  },
}))
