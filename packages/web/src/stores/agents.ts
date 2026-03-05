import { create } from 'zustand'
import type { Agent, AgentVisibility, Gateway } from '@agentim/shared'
import { api } from '../lib/api.js'
import { wsClient } from '../lib/ws.js'
import { registerStoreReset } from './reset.js'

/** Credential metadata (secrets never leave gateway) */
export interface CredentialInfo {
  id: string
  name: string
  mode: 'subscription' | 'api'
  hasApiKey: boolean
  hasOAuthData: boolean
  baseUrl?: string
  model?: string
  isDefault: boolean
  createdAt: string
}

interface AgentState {
  agents: Agent[]
  sharedAgents: Agent[]
  gateways: Gateway[]
  isLoading: boolean
  loadError: boolean
  /** Per-gateway, per-agent-type credential cache */
  gatewayCredentials: Map<string, CredentialInfo[]>
  loadAgents: () => Promise<void>
  loadSharedAgents: () => Promise<void>
  loadGateways: () => Promise<void>
  deleteGateway: (gatewayId: string) => Promise<void>
  deleteAgent: (agentId: string) => Promise<void>
  updateAgent: (agent: Pick<Agent, 'id' | 'name' | 'type' | 'status'> & Partial<Agent>) => void
  updateAgentVisibility: (
    agentId: string,
    visibility: AgentVisibility,
    visibilityList?: string[],
  ) => Promise<void>
  renameAgent: (agentId: string, name: string) => Promise<void>
  spawnAgent: (
    gatewayId: string,
    agentType: string,
    name: string,
    workingDirectory?: string,
    credentialId?: string,
  ) => Promise<void>
  setGatewayCredentials: (
    gatewayId: string,
    agentType: string,
    credentials: CredentialInfo[],
  ) => void
  addGatewayCredential: (
    gatewayId: string,
    agentType: string,
    data: {
      name: string
      mode?: 'api' | 'subscription'
      apiKey?: string
      baseUrl?: string
      model?: string
    },
  ) => void
  manageGatewayCredential: (
    gatewayId: string,
    agentType: string,
    credentialId: string,
    action: 'rename' | 'delete' | 'set_default',
    name?: string,
  ) => void
  refreshGatewayCredentials: (gatewayId: string, agentType: string) => void
  startGatewayOAuth: (gatewayId: string, agentType: string, credentialName: string) => void
  completeGatewayOAuth: (gatewayId: string, requestId: string, callbackUrl: string) => void
}

export const useAgentStore = create<AgentState>((set, get) => ({
  agents: [],
  sharedAgents: [],
  gateways: [],
  isLoading: false,
  loadError: false,
  gatewayCredentials: new Map(),

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

  updateAgentVisibility: async (agentId, visibility, visibilityList) => {
    const body: Record<string, unknown> = { visibility }
    if (visibilityList !== undefined) body.visibilityList = visibilityList
    const res = await api.put<Agent>(`/agents/${agentId}`, body)
    if (res.ok && res.data) {
      set({
        agents: get().agents.map((a) =>
          a.id === agentId ? { ...a, visibility, visibilityList } : a,
        ),
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

  spawnAgent: async (gatewayId, agentType, name, workingDirectory, credentialId) => {
    const res = await api.post('/agents/spawn', {
      gatewayId,
      agentType,
      name,
      workingDirectory,
      credentialId,
    })
    if (!res.ok) throw new Error(res.error ?? 'Failed to spawn agent')
  },

  setGatewayCredentials: (gatewayId, agentType, credentials) => {
    const key = `${gatewayId}:${agentType}`
    const map = new Map(get().gatewayCredentials)
    map.set(key, credentials)
    set({ gatewayCredentials: map })
  },

  addGatewayCredential: (gatewayId, agentType, data) => {
    wsClient.send({
      type: 'client:add_gateway_credential',
      gatewayId,
      agentType,
      name: data.name,
      mode: data.mode ?? 'api',
      ...(data.apiKey ? { apiKey: data.apiKey } : {}),
      baseUrl: data.baseUrl,
      model: data.model,
    })
  },

  manageGatewayCredential: (gatewayId, agentType, credentialId, action, name) => {
    wsClient.send({
      type: 'client:manage_gateway_credential',
      gatewayId,
      agentType,
      credentialId,
      action,
      ...(name ? { name } : {}),
    })
  },

  refreshGatewayCredentials: (gatewayId, agentType) => {
    wsClient.send({
      type: 'client:list_gateway_credentials',
      gatewayId,
      agentType,
    })
  },

  startGatewayOAuth: (gatewayId, agentType, credentialName) => {
    wsClient.send({
      type: 'client:start_gateway_oauth',
      gatewayId,
      agentType,
      credentialName,
    })
  },

  completeGatewayOAuth: (gatewayId, requestId, callbackUrl) => {
    wsClient.send({
      type: 'client:complete_gateway_oauth',
      gatewayId,
      requestId,
      callbackUrl,
    })
  },
}))

registerStoreReset(() =>
  useAgentStore.setState({
    agents: [],
    sharedAgents: [],
    gateways: [],
    isLoading: false,
    loadError: false,
    gatewayCredentials: new Map(),
  }),
)
