import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ServiceAgent } from '@agentim/shared'
import { useServiceAgentsStore } from './serviceAgents.js'

// ── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('../lib/api.js', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}))

vi.mock('./reset.js', () => ({
  registerStoreReset: vi.fn(),
}))

import { api } from '../lib/api.js'

const mockApi = api as unknown as {
  get: ReturnType<typeof vi.fn>
  post: ReturnType<typeof vi.fn>
  put: ReturnType<typeof vi.fn>
  delete: ReturnType<typeof vi.fn>
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeServiceAgent(overrides: Partial<ServiceAgent> = {}): ServiceAgent {
  return {
    id: 'sa-1',
    name: 'Test Agent',
    type: 'claude',
    category: 'coding',
    description: 'A test service agent',
    status: 'active',
    createdById: 'user-1',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    ...overrides,
  } as ServiceAgent
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('useServiceAgentsStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useServiceAgentsStore.getState().reset()
  })

  describe('initial state', () => {
    it('has empty serviceAgents array, loading=false, error=null', () => {
      const state = useServiceAgentsStore.getState()
      expect(state.serviceAgents).toEqual([])
      expect(state.loading).toBe(false)
      expect(state.error).toBeNull()
    })
  })

  describe('fetchServiceAgents', () => {
    it('populates the service agents list on success', async () => {
      const agents = [
        makeServiceAgent({ id: 'sa-1' }),
        makeServiceAgent({ id: 'sa-2', name: 'Agent 2' }),
      ]
      mockApi.get.mockResolvedValueOnce({ ok: true, data: agents })

      await useServiceAgentsStore.getState().fetchServiceAgents()

      const state = useServiceAgentsStore.getState()
      expect(state.serviceAgents).toHaveLength(2)
      expect(state.serviceAgents[0].id).toBe('sa-1')
      expect(state.serviceAgents[1].id).toBe('sa-2')
      expect(state.loading).toBe(false)
      expect(state.error).toBeNull()
    })

    it('sets error on API failure (ok=false)', async () => {
      mockApi.get.mockResolvedValueOnce({
        ok: false,
        error: 'Unauthorized',
      })

      await useServiceAgentsStore.getState().fetchServiceAgents()

      const state = useServiceAgentsStore.getState()
      expect(state.serviceAgents).toEqual([])
      expect(state.error).toBe('Unauthorized')
      expect(state.loading).toBe(false)
    })

    it('sets error on network exception', async () => {
      mockApi.get.mockRejectedValueOnce(new Error('Network error'))

      await useServiceAgentsStore.getState().fetchServiceAgents()

      const state = useServiceAgentsStore.getState()
      expect(state.error).toBe('Network error')
      expect(state.loading).toBe(false)
    })

    it('sets loading=true during fetch', async () => {
      let loadingDuringFetch = false
      mockApi.get.mockImplementationOnce(async () => {
        loadingDuringFetch = useServiceAgentsStore.getState().loading
        return { ok: true, data: [] }
      })

      await useServiceAgentsStore.getState().fetchServiceAgents()
      expect(loadingDuringFetch).toBe(true)
    })

    it('uses default error message when error is undefined', async () => {
      mockApi.get.mockResolvedValueOnce({ ok: false })

      await useServiceAgentsStore.getState().fetchServiceAgents()

      expect(useServiceAgentsStore.getState().error).toBe('Failed to fetch')
    })
  })

  describe('createServiceAgent', () => {
    it('creates and re-fetches service agents', async () => {
      const newAgent = makeServiceAgent({
        id: 'sa-new',
        name: 'New Agent',
      })
      mockApi.post.mockResolvedValueOnce({ ok: true, data: newAgent })
      // After create, fetchServiceAgents is called
      mockApi.get.mockResolvedValueOnce({ ok: true, data: [newAgent] })

      const result = await useServiceAgentsStore
        .getState()
        .createServiceAgent({ name: 'New Agent' })

      expect(result).toEqual(newAgent)
      expect(mockApi.post).toHaveBeenCalledWith('/service-agents', {
        name: 'New Agent',
      })
      // Should have re-fetched the list
      expect(mockApi.get).toHaveBeenCalled()
    })

    it('throws on API failure', async () => {
      mockApi.post.mockResolvedValueOnce({
        ok: false,
        error: 'Validation error',
      })

      await expect(
        useServiceAgentsStore.getState().createServiceAgent({ name: 'Bad' }),
      ).rejects.toThrow('Validation error')
    })

    it('throws generic message when error is undefined', async () => {
      mockApi.post.mockResolvedValueOnce({ ok: false })

      await expect(
        useServiceAgentsStore.getState().createServiceAgent({ name: 'Bad' }),
      ).rejects.toThrow('Failed to create')
    })
  })

  describe('updateServiceAgent', () => {
    it('updates and re-fetches the list', async () => {
      mockApi.put.mockResolvedValueOnce({
        ok: true,
        data: makeServiceAgent({ name: 'Updated' }),
      })
      mockApi.get.mockResolvedValueOnce({
        ok: true,
        data: [makeServiceAgent({ name: 'Updated' })],
      })

      await useServiceAgentsStore.getState().updateServiceAgent('sa-1', { name: 'Updated' })

      expect(mockApi.put).toHaveBeenCalledWith('/service-agents/sa-1', {
        name: 'Updated',
      })
      expect(mockApi.get).toHaveBeenCalled()
    })

    it('throws on API failure', async () => {
      mockApi.put.mockResolvedValueOnce({
        ok: false,
        error: 'Not found',
      })

      await expect(
        useServiceAgentsStore.getState().updateServiceAgent('sa-1', { name: 'X' }),
      ).rejects.toThrow('Not found')
    })
  })

  describe('deleteServiceAgent', () => {
    it('removes the agent from the list on success', async () => {
      useServiceAgentsStore.setState({
        serviceAgents: [makeServiceAgent({ id: 'sa-1' }), makeServiceAgent({ id: 'sa-2' })],
      })
      mockApi.delete.mockResolvedValueOnce({ ok: true })

      await useServiceAgentsStore.getState().deleteServiceAgent('sa-1')

      const state = useServiceAgentsStore.getState()
      expect(state.serviceAgents).toHaveLength(1)
      expect(state.serviceAgents[0].id).toBe('sa-2')
    })

    it('throws on API failure', async () => {
      mockApi.delete.mockResolvedValueOnce({
        ok: false,
        error: 'Forbidden',
      })

      await expect(useServiceAgentsStore.getState().deleteServiceAgent('sa-1')).rejects.toThrow(
        'Forbidden',
      )
    })

    it('preserves list on failure', async () => {
      useServiceAgentsStore.setState({
        serviceAgents: [makeServiceAgent({ id: 'sa-1' })],
      })
      mockApi.delete.mockResolvedValueOnce({ ok: false, error: 'Error' })

      try {
        await useServiceAgentsStore.getState().deleteServiceAgent('sa-1')
      } catch {
        // Expected
      }

      expect(useServiceAgentsStore.getState().serviceAgents).toHaveLength(1)
    })
  })

  describe('reset', () => {
    it('resets all state to initial values', () => {
      useServiceAgentsStore.setState({
        serviceAgents: [makeServiceAgent()],
        loading: true,
        error: 'Some error',
      })

      useServiceAgentsStore.getState().reset()

      const state = useServiceAgentsStore.getState()
      expect(state.serviceAgents).toEqual([])
      expect(state.loading).toBe(false)
      expect(state.error).toBeNull()
    })
  })
})
