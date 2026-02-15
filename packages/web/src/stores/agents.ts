import { create } from 'zustand'
import type { Agent } from '@agentim/shared'
import { api } from '../lib/api.js'

interface AgentState {
  agents: Agent[]
  isLoading: boolean
  loadError: boolean
  loadAgents: () => Promise<void>
  updateAgent: (agent: Pick<Agent, 'id' | 'name' | 'type' | 'status'> & Partial<Agent>) => void
}

export const useAgentStore = create<AgentState>((set, get) => ({
  agents: [],
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

  updateAgent: (update) => {
    set({
      agents: get().agents.map((a) =>
        a.id === update.id ? { ...a, ...update } : a,
      ),
    })
  },
}))
