import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useAgentStore } from './agents'

// Mock the API module
vi.mock('../lib/api.js', () => ({
  api: {
    get: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
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
})
