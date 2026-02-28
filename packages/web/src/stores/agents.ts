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
  deleteAgent: (agentId: string) => Promise<void>
  updateAgent: (agent: Pick<Agent, 'id' | 'name' | 'type' | 'status'> & Partial<Agent>) => void
  updateAgentVisibility: (agentId: string, visibility: AgentVisibility) => Promise<void>
  renameAgent: (agentId: string, name: string) => Promise<void>
  spawnAgent: (
    gatewayId: string,
    agentType: string,
    name: string,
    workingDirectory?: string,
  ) => Promise<void>
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

  deleteAgent: async (agentId) => {
    const res = await api.delete(`/agents/${agentId}`)
    if (!res.ok) throw new Error(res.error ?? 'Failed to delete agent')
    set({ agents: get().agents.filter((a) => a.id !== agentId) })
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

  renameAgent: async (agentId, name) => {
    const res = await api.put<Agent>(`/agents/${agentId}`, { name })
    if (res.ok && res.data) {
      set({
        agents: get().agents.map((a) => (a.id === agentId ? { ...a, name } : a)),
      })
    } else {
      throw new Error(res.error ?? 'Failed to rename agent')
    }
  },

  spawnAgent: async (gatewayId, agentType, name, workingDirectory) => {
    const res = await api.post('/agents/spawn', { gatewayId, agentType, name, workingDirectory })
    if (!res.ok) throw new Error(res.error ?? 'Failed to spawn agent')
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
