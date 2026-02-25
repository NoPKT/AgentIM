import { create } from 'zustand'
import type { Agent, AgentVisibility, Gateway } from '@agentim/shared'
import { api } from '../lib/api.js'
import { registerStoreReset } from './reset.js'

interface AgentState {
  agents: Agent[]
  sharedAgents: Agent[]
  gateways: Gateway[]
  isLoading: boolean
  loadError: boolean
  loadAgents: () => Promise<void>
  loadSharedAgents: () => Promise<void>
  loadGateways: () => Promise<void>
  deleteGateway: (gatewayId: string) => Promise<void>
  updateAgent: (agent: Pick<Agent, 'id' | 'name' | 'type' | 'status'> & Partial<Agent>) => void
  updateAgentVisibility: (agentId: string, visibility: AgentVisibility) => Promise<void>
}

export const useAgentStore = create<AgentState>((set, get) => ({
  agents: [],
  sharedAgents: [],
  gateways: [],
  isLoading: false,
  loadError: false,

  loadAgents: async () => {
    set({ isLoading: true, loadError: false })
    try {
      const res = await api.get<Agent[]>('/agents')
      if (res.ok && res.data) {
        set({ agents: res.data })
      } else {
        set({ loadError: true })
      }
    } catch {
      set({ loadError: true })
    } finally {
      set({ isLoading: false })
    }
  },

  loadSharedAgents: async () => {
    const res = await api.get<Agent[]>('/agents/shared')
    if (res.ok && res.data) {
      set({ sharedAgents: res.data })
    }
  },

  loadGateways: async () => {
    const res = await api.get<Gateway[]>('/agents/gateways/list')
    if (res.ok && res.data) {
      set({ gateways: res.data })
    }
  },

  deleteGateway: async (gatewayId) => {
    const res = await api.delete(`/agents/gateways/${gatewayId}`)
    if (!res.ok) throw new Error(res.error ?? 'Failed to delete gateway')
    set({
      gateways: get().gateways.filter((g) => g.id !== gatewayId),
      agents: get().agents.filter((a) => a.gatewayId !== gatewayId),
    })
  },

  updateAgent: (update) => {
    set({
      agents: get().agents.map((a) => (a.id === update.id ? { ...a, ...update } : a)),
    })
  },

  updateAgentVisibility: async (agentId, visibility) => {
    const res = await api.put<Agent>(`/agents/${agentId}`, { visibility })
    if (res.ok && res.data) {
      set({
        agents: get().agents.map((a) => (a.id === agentId ? { ...a, visibility } : a)),
      })
    }
  },
}))

registerStoreReset(() =>
  useAgentStore.setState({
    agents: [],
    sharedAgents: [],
    gateways: [],
    isLoading: false,
    loadError: false,
  }),
)
