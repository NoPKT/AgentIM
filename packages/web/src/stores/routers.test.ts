import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Router } from '@agentim/shared'
import { useRouterStore } from './routers.js'

// ── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('../lib/api.js', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}))

vi.mock('./toast.js', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}))

vi.mock('./reset.js', () => ({
  registerStoreReset: vi.fn(),
}))

import { api } from '../lib/api.js'
import { toast } from './toast.js'

const mockApi = api as unknown as {
  get: ReturnType<typeof vi.fn>
  post: ReturnType<typeof vi.fn>
  put: ReturnType<typeof vi.fn>
  delete: ReturnType<typeof vi.fn>
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeRouter(overrides: Partial<Router> = {}): Router {
  return {
    id: 'router-1',
    name: 'Default Router',
    description: 'Test router',
    scope: 'personal',
    createdById: 'user-1',
    llmBaseUrl: 'https://api.openai.com/v1',
    llmApiKey: 'sk-test',
    llmModel: 'gpt-4',
    maxChainDepth: 3,
    rateLimitWindow: 60,
    rateLimitMax: 100,
    visibility: 'all',
    visibilityList: [],
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    ...overrides,
  }
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('useRouterStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useRouterStore.setState({ routers: [], loading: false })
  })

  describe('initial state', () => {
    it('has empty routers array and loading=false', () => {
      useRouterStore.setState({ routers: [], loading: false })
      const state = useRouterStore.getState()
      expect(state.routers).toEqual([])
      expect(state.loading).toBe(false)
    })
  })

  describe('loadRouters', () => {
    it('populates router list on success', async () => {
      const routers = [makeRouter({ id: 'r1' }), makeRouter({ id: 'r2', name: 'Router 2' })]
      mockApi.get.mockResolvedValueOnce({ ok: true, data: routers })

      await useRouterStore.getState().loadRouters()

      expect(useRouterStore.getState().routers).toHaveLength(2)
      expect(useRouterStore.getState().routers[0].id).toBe('r1')
      expect(useRouterStore.getState().routers[1].id).toBe('r2')
      expect(useRouterStore.getState().loading).toBe(false)
    })

    it('shows toast on error', async () => {
      mockApi.get.mockRejectedValueOnce(new Error('Network error'))

      await useRouterStore.getState().loadRouters()

      expect(toast.error).toHaveBeenCalledWith('Failed to load routers')
      expect(useRouterStore.getState().loading).toBe(false)
    })

    it('sets loading=true during fetch', async () => {
      let loadingDuringFetch = false
      mockApi.get.mockImplementationOnce(async () => {
        loadingDuringFetch = useRouterStore.getState().loading
        return { ok: true, data: [] }
      })

      await useRouterStore.getState().loadRouters()
      expect(loadingDuringFetch).toBe(true)
    })

    it('prevents concurrent loading calls', async () => {
      let callCount = 0
      mockApi.get.mockImplementation(async () => {
        callCount++
        await new Promise((r) => setTimeout(r, 10))
        return { ok: true, data: [] }
      })

      // Set loading state manually to simulate in-progress
      useRouterStore.setState({ loading: true })
      await useRouterStore.getState().loadRouters()

      // Should have returned immediately without calling API
      expect(callCount).toBe(0)
    })

    it('does not update routers when API returns ok=false', async () => {
      useRouterStore.setState({ routers: [makeRouter()] })
      mockApi.get.mockResolvedValueOnce({ ok: false, error: 'Unauthorized' })

      await useRouterStore.getState().loadRouters()

      // Original data preserved
      expect(useRouterStore.getState().routers).toHaveLength(1)
    })
  })

  describe('createRouter', () => {
    it('adds a new router to the list on success', async () => {
      const newRouter = makeRouter({ id: 'r-new', name: 'New Router' })
      mockApi.post.mockResolvedValueOnce({ ok: true, data: newRouter })

      const result = await useRouterStore.getState().createRouter({
        name: 'New Router',
        scope: 'personal',
        llmBaseUrl: 'https://api.openai.com/v1',
        llmApiKey: 'sk-test',
        llmModel: 'gpt-4',
        maxChainDepth: 3,
        rateLimitWindow: 60,
        rateLimitMax: 100,
        visibility: 'all',
        visibilityList: [],
      })

      expect(result).toEqual(newRouter)
      expect(useRouterStore.getState().routers).toHaveLength(1)
      expect(useRouterStore.getState().routers[0].id).toBe('r-new')
    })

    it('throws on API failure', async () => {
      mockApi.post.mockResolvedValueOnce({ ok: false, error: 'Validation error' })

      await expect(
        useRouterStore.getState().createRouter({
          name: 'Bad Router',
          scope: 'personal',
          llmBaseUrl: '',
          llmApiKey: '',
          llmModel: '',
          maxChainDepth: 3,
          rateLimitWindow: 60,
          rateLimitMax: 100,
          visibility: 'all',
          visibilityList: [],
        }),
      ).rejects.toThrow('Validation error')
    })

    it('throws generic message when error is undefined', async () => {
      mockApi.post.mockResolvedValueOnce({ ok: false })

      await expect(
        useRouterStore.getState().createRouter({
          name: 'Bad',
          scope: 'personal',
          llmBaseUrl: '',
          llmApiKey: '',
          llmModel: '',
          maxChainDepth: 1,
          rateLimitWindow: 60,
          rateLimitMax: 100,
          visibility: 'all',
          visibilityList: [],
        }),
      ).rejects.toThrow('Failed to create router')
    })
  })

  describe('updateRouter', () => {
    it('modifies the existing router in the list', async () => {
      useRouterStore.setState({
        routers: [makeRouter({ id: 'r1', name: 'Old Name' })],
      })
      mockApi.put.mockResolvedValueOnce({
        ok: true,
        data: { name: 'New Name' },
      })

      await useRouterStore.getState().updateRouter('r1', { name: 'New Name' })

      const router = useRouterStore.getState().routers[0]
      expect(router.name).toBe('New Name')
      expect(router.id).toBe('r1')
    })

    it('throws on API failure', async () => {
      useRouterStore.setState({ routers: [makeRouter({ id: 'r1' })] })
      mockApi.put.mockResolvedValueOnce({ ok: false, error: 'Not found' })

      await expect(
        useRouterStore.getState().updateRouter('r1', { name: 'Updated' }),
      ).rejects.toThrow('Not found')
    })

    it('does not modify other routers', async () => {
      useRouterStore.setState({
        routers: [
          makeRouter({ id: 'r1', name: 'Router 1' }),
          makeRouter({ id: 'r2', name: 'Router 2' }),
        ],
      })
      mockApi.put.mockResolvedValueOnce({
        ok: true,
        data: { name: 'Updated 1' },
      })

      await useRouterStore.getState().updateRouter('r1', { name: 'Updated 1' })

      expect(useRouterStore.getState().routers[0].name).toBe('Updated 1')
      expect(useRouterStore.getState().routers[1].name).toBe('Router 2')
    })
  })

  describe('deleteRouter', () => {
    it('removes the router from the list on success', async () => {
      useRouterStore.setState({
        routers: [makeRouter({ id: 'r1' }), makeRouter({ id: 'r2' })],
      })
      mockApi.delete.mockResolvedValueOnce({ ok: true })

      await useRouterStore.getState().deleteRouter('r1')

      expect(useRouterStore.getState().routers).toHaveLength(1)
      expect(useRouterStore.getState().routers[0].id).toBe('r2')
    })

    it('throws on API failure', async () => {
      useRouterStore.setState({ routers: [makeRouter({ id: 'r1' })] })
      mockApi.delete.mockResolvedValueOnce({ ok: false, error: 'Forbidden' })

      await expect(useRouterStore.getState().deleteRouter('r1')).rejects.toThrow('Forbidden')
    })

    it('preserves routers list on failure', async () => {
      useRouterStore.setState({ routers: [makeRouter({ id: 'r1' })] })
      mockApi.delete.mockResolvedValueOnce({ ok: false, error: 'Error' })

      try {
        await useRouterStore.getState().deleteRouter('r1')
      } catch {
        // Expected
      }

      expect(useRouterStore.getState().routers).toHaveLength(1)
    })
  })

  describe('testRouter', () => {
    it('returns true when test succeeds', async () => {
      mockApi.post.mockResolvedValueOnce({
        ok: true,
        data: { success: true },
      })
      const result = await useRouterStore.getState().testRouter('r1')
      expect(result).toBe(true)
    })

    it('returns false when test fails', async () => {
      mockApi.post.mockResolvedValueOnce({
        ok: true,
        data: { success: false, error: 'Timeout' },
      })
      const result = await useRouterStore.getState().testRouter('r1')
      expect(result).toBe(false)
    })

    it('returns false when API call fails', async () => {
      mockApi.post.mockResolvedValueOnce({
        ok: false,
        error: 'Server error',
      })
      const result = await useRouterStore.getState().testRouter('r1')
      expect(result).toBe(false)
    })
  })
})
