import { create } from 'zustand'
import type { Agent, AgentVisibility } from '@agentim/shared'
import { api } from '../lib/api.js'

interface AgentState {
  agents: Agent[]
  sharedAgents: Agent[]
  isLoading: boolean
  loadError: boolean
  loadAgents: () => Promise<void>
  loadSharedAgents: () => Promise<void>
  updateAgent: (agent: Pick<Agent, 'id' | 'name' | 'type' | 'status'> & Partial<Agent>) => void
  updateAgentVisibility: (agentId: string, visibility: AgentVisibility) => Promise<void>
}

export const useAgentStore = create<AgentState>((set, get) => ({
  agents: [],
  sharedAgents: [],
  isLoading: false,
  loadError: false,

  loadAgents: async () => {
    set({ isLoading: true, loadError: false })
    const res = await api.get<Agent[]>('/agents')
    if (res.ok && res.data) {
      set({ agents: res.data, isLoading: false })
    } else {
      set({ isLoading: false, loadError: true })
    }
  },

  loadSharedAgents: async () => {
    const res = await api.get<Agent[]>('/agents/shared')
    if (res.ok && res.data) {
      set({ sharedAgents: res.data })
    }
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
