import { create } from 'zustand'
import type { Agent } from '@agentim/shared'
import { api } from '../lib/api.js'

interface AgentState {
  agents: Agent[]
  loadAgents: () => Promise<void>
  updateAgent: (agent: Pick<Agent, 'id' | 'name' | 'type' | 'status'>) => void
}

export const useAgentStore = create<AgentState>((set, get) => ({
  agents: [],

  loadAgents: async () => {
    const res = await api.get<Agent[]>('/agents')
    if (res.ok && res.data) {
      set({ agents: res.data })
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
