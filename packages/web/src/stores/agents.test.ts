import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useAgentStore } from './agents'

// Mock the WS client module
const { mockWsSend } = vi.hoisted(() => ({
  mockWsSend: vi.fn(),
}))
vi.mock('../lib/ws.js', () => ({
  wsClient: {
    send: mockWsSend,
  },
}))

// Mock the API module
vi.mock('../lib/api.js', () => ({
  api: {
    get: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    post: vi.fn(),
  },
}))

import { api } from '../lib/api.js'

const mockApi = vi.mocked(api)

describe('useAgentStore', () => {
  beforeEach(() => {
    useAgentStore.setState({
      agents: [],
      sharedAgents: [],
      gateways: [],
      isLoading: false,
      loadError: false,
      gatewayCredentials: new Map(),
    })
    vi.clearAllMocks()
  })

  it('has correct initial state', () => {
    const state = useAgentStore.getState()
    expect(state.agents).toEqual([])
    expect(state.sharedAgents).toEqual([])
    expect(state.gateways).toEqual([])
    expect(state.isLoading).toBe(false)
    expect(state.loadError).toBe(false)
  })

  it('loadAgents sets agents on success', async () => {
    const agents = [{ id: 'a1', name: 'Claude', type: 'claude-code', status: 'online' }]
    mockApi.get.mockResolvedValue({ ok: true, data: agents })

    await useAgentStore.getState().loadAgents()

    expect(useAgentStore.getState().agents).toEqual(agents)
    expect(useAgentStore.getState().isLoading).toBe(false)
    expect(useAgentStore.getState().loadError).toBe(false)
  })

  it('loadAgents sets loadError on failure', async () => {
    mockApi.get.mockResolvedValue({ ok: false, error: 'Network error' })

    await useAgentStore.getState().loadAgents()

    expect(useAgentStore.getState().loadError).toBe(true)
    expect(useAgentStore.getState().isLoading).toBe(false)
  })

  it('loadAgents sets loadError on exception', async () => {
    mockApi.get.mockRejectedValue(new Error('Network error'))

    await useAgentStore.getState().loadAgents()

    expect(useAgentStore.getState().loadError).toBe(true)
    expect(useAgentStore.getState().isLoading).toBe(false)
  })

  it('loadSharedAgents sets sharedAgents', async () => {
    const shared = [{ id: 's1', name: 'Shared', type: 'codex', status: 'online' }]
    mockApi.get.mockResolvedValue({ ok: true, data: shared })

    await useAgentStore.getState().loadSharedAgents()

    expect(useAgentStore.getState().sharedAgents).toEqual(shared)
  })

  it('loadGateways sets gateways', async () => {
    const gateways = [{ id: 'g1', userId: 'u1', name: 'GW1' }]
    mockApi.get.mockResolvedValue({ ok: true, data: gateways })

    await useAgentStore.getState().loadGateways()

    expect(useAgentStore.getState().gateways).toEqual(gateways)
  })

  it('deleteGateway removes gateway and its agents', async () => {
    useAgentStore.setState({
      gateways: [{ id: 'g1' }, { id: 'g2' }] as never[],
      agents: [
        { id: 'a1', gatewayId: 'g1' },
        { id: 'a2', gatewayId: 'g2' },
      ] as never[],
    })
    mockApi.delete.mockResolvedValue({ ok: true })

    await useAgentStore.getState().deleteGateway('g1')

    expect(useAgentStore.getState().gateways).toHaveLength(1)
    expect(useAgentStore.getState().agents).toHaveLength(1)
    expect(useAgentStore.getState().agents[0]).toHaveProperty('gatewayId', 'g2')
  })

  it('deleteGateway throws on failure', async () => {
    mockApi.delete.mockResolvedValue({ ok: false, error: 'Not found' })

    await expect(useAgentStore.getState().deleteGateway('g1')).rejects.toThrow('Not found')
  })

  it('updateAgent updates an existing agent', () => {
    useAgentStore.setState({
      agents: [{ id: 'a1', name: 'Old', type: 'codex', status: 'online' }] as never[],
    })

    useAgentStore.getState().updateAgent({ id: 'a1', name: 'New', type: 'codex', status: 'busy' })

    expect(useAgentStore.getState().agents[0]).toMatchObject({ name: 'New', status: 'busy' })
  })

  it('updateAgentVisibility updates visibility on success', async () => {
    useAgentStore.setState({
      agents: [{ id: 'a1', name: 'Agent', type: 'codex', visibility: 'private' }] as never[],
    })
    mockApi.put.mockResolvedValue({ ok: true, data: { id: 'a1', visibility: 'public' } })

    await useAgentStore.getState().updateAgentVisibility('a1', 'public' as never)

    expect(useAgentStore.getState().agents[0]).toHaveProperty('visibility', 'public')
  })

  it('renameAgent updates agent name on success', async () => {
    useAgentStore.setState({
      agents: [{ id: 'a1', name: 'OldName', type: 'codex' }] as never[],
    })
    mockApi.put.mockResolvedValue({ ok: true, data: { id: 'a1', name: 'NewName' } })

    await useAgentStore.getState().renameAgent('a1', 'NewName')

    expect(useAgentStore.getState().agents[0]).toHaveProperty('name', 'NewName')
  })

  it('renameAgent throws on failure', async () => {
    useAgentStore.setState({
      agents: [{ id: 'a1', name: 'OldName', type: 'codex' }] as never[],
    })
    mockApi.put.mockResolvedValue({ ok: false, error: 'Forbidden' })

    await expect(useAgentStore.getState().renameAgent('a1', 'NewName')).rejects.toThrow('Forbidden')
    expect(useAgentStore.getState().agents[0]).toHaveProperty('name', 'OldName')
  })

  it('setGatewayCredentials stores credentials by gateway+agentType key', () => {
    const creds = [
      {
        id: 'c1',
        name: 'Default',
        mode: 'api' as const,
        hasApiKey: true,
        isDefault: true,
        createdAt: '2026-01-01T00:00:00Z',
      },
    ]
    useAgentStore.getState().setGatewayCredentials('g1', 'claude-code', creds)

    const map = useAgentStore.getState().gatewayCredentials
    expect(map.get('g1:claude-code')).toEqual(creds)
  })

  it('addGatewayCredential sends WS message with correct payload', () => {
    useAgentStore.getState().addGatewayCredential('g1', 'claude-code', {
      name: 'MyCred',
      mode: 'api',
      apiKey: 'sk-test',
      baseUrl: 'https://api.example.com',
      model: 'claude-4',
    })

    expect(mockWsSend).toHaveBeenCalledWith({
      type: 'client:add_gateway_credential',
      gatewayId: 'g1',
      agentType: 'claude-code',
      name: 'MyCred',
      mode: 'api',
      apiKey: 'sk-test',
      baseUrl: 'https://api.example.com',
      model: 'claude-4',
    })
  })

  it('addGatewayCredential defaults mode to api and omits apiKey when not provided', () => {
    useAgentStore.getState().addGatewayCredential('g1', 'codex', {
      name: 'Sub',
    })

    expect(mockWsSend).toHaveBeenCalledWith({
      type: 'client:add_gateway_credential',
      gatewayId: 'g1',
      agentType: 'codex',
      name: 'Sub',
      mode: 'api',
      baseUrl: undefined,
      model: undefined,
    })
  })

  it('manageGatewayCredential sends rename action', () => {
    useAgentStore.getState().manageGatewayCredential('g1', 'claude-code', 'c1', 'rename', 'NewName')

    expect(mockWsSend).toHaveBeenCalledWith({
      type: 'client:manage_gateway_credential',
      gatewayId: 'g1',
      agentType: 'claude-code',
      credentialId: 'c1',
      action: 'rename',
      name: 'NewName',
    })
  })

  it('manageGatewayCredential sends delete action without name', () => {
    useAgentStore.getState().manageGatewayCredential('g1', 'claude-code', 'c1', 'delete')

    expect(mockWsSend).toHaveBeenCalledWith({
      type: 'client:manage_gateway_credential',
      gatewayId: 'g1',
      agentType: 'claude-code',
      credentialId: 'c1',
      action: 'delete',
    })
  })

  it('manageGatewayCredential sends set_default action', () => {
    useAgentStore.getState().manageGatewayCredential('g1', 'codex', 'c2', 'set_default')

    expect(mockWsSend).toHaveBeenCalledWith({
      type: 'client:manage_gateway_credential',
      gatewayId: 'g1',
      agentType: 'codex',
      credentialId: 'c2',
      action: 'set_default',
    })
  })

  it('refreshGatewayCredentials sends list request', () => {
    useAgentStore.getState().refreshGatewayCredentials('g1', 'claude-code')

    expect(mockWsSend).toHaveBeenCalledWith({
      type: 'client:list_gateway_credentials',
      gatewayId: 'g1',
      agentType: 'claude-code',
    })
  })

  it('startGatewayOAuth sends start_gateway_oauth message', () => {
    useAgentStore.getState().startGatewayOAuth('g1', 'claude-code', 'my-cred')

    expect(mockWsSend).toHaveBeenCalledWith({
      type: 'client:start_gateway_oauth',
      gatewayId: 'g1',
      agentType: 'claude-code',
      credentialName: 'my-cred',
    })
  })

  it('completeGatewayOAuth sends complete_gateway_oauth message', () => {
    useAgentStore
      .getState()
      .completeGatewayOAuth('g1', 'req-123', 'http://localhost:3000/callback?code=abc')

    expect(mockWsSend).toHaveBeenCalledWith({
      type: 'client:complete_gateway_oauth',
      gatewayId: 'g1',
      requestId: 'req-123',
      callbackUrl: 'http://localhost:3000/callback?code=abc',
    })
  })
})
