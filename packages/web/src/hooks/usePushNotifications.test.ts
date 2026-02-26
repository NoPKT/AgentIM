import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'

// ── API mock ────────────────────────────────────────────────────────────────

const mockApiGet = vi.fn()
const mockApiPost = vi.fn()

vi.mock('../lib/api.js', () => ({
  api: {
    get: (...args: unknown[]) => mockApiGet(...args),
    post: (...args: unknown[]) => mockApiPost(...args),
  },
}))

// ── Browser API mocks ───────────────────────────────────────────────────────

const mockUnsubscribe = vi.fn().mockResolvedValue(true)
const mockGetSubscription = vi.fn()
const mockSubscribe = vi.fn()

const mockPushManager = {
  getSubscription: mockGetSubscription,
  subscribe: mockSubscribe,
}

const mockServiceWorkerReady = Promise.resolve({
  pushManager: mockPushManager,
})

// Store original properties so we can restore them
const originalPushManager = Object.getOwnPropertyDescriptor(window, 'PushManager')
const originalServiceWorker = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker')

function setupBrowserApis(options: { hasPushManager?: boolean } = {}) {
  const { hasPushManager = true } = options

  if (hasPushManager) {
    Object.defineProperty(window, 'PushManager', {
      value: class PushManager {},
      writable: true,
      configurable: true,
    })
  } else {
    // Remove PushManager
    Object.defineProperty(window, 'PushManager', {
      value: undefined,
      writable: true,
      configurable: true,
    })
  }

  Object.defineProperty(navigator, 'serviceWorker', {
    value: {
      ready: mockServiceWorkerReady,
    },
    writable: true,
    configurable: true,
  })
}

function cleanupBrowserApis() {
  if (originalPushManager) {
    Object.defineProperty(window, 'PushManager', originalPushManager)
  } else {
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete (window as unknown as Record<string, unknown>)['PushManager']
  }
  if (originalServiceWorker) {
    Object.defineProperty(navigator, 'serviceWorker', originalServiceWorker)
  }
}

// We need a fresh import each test to re-evaluate `isSupported`
// Since the module captures isSupported at call time, we import it once
// and control PushManager presence before each test.
const { usePushNotifications } = await import('./usePushNotifications.js')

describe('usePushNotifications', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSubscription.mockResolvedValue(null)
    mockApiGet.mockResolvedValue({ ok: true, data: { publicKey: 'test-vapid-key-base64url' } })
    mockApiPost.mockResolvedValue({ ok: true })
    setupBrowserApis({ hasPushManager: true })
  })

  afterEach(() => {
    cleanupBrowserApis()
  })

  // ── isSupported ─────────────────────────────────────────────────────────

  it('returns isSupported=true when PushManager and serviceWorker are available', () => {
    const { result } = renderHook(() => usePushNotifications())
    expect(result.current.isSupported).toBe(true)
  })

  // ── Initial subscription check ──────────────────────────────────────────

  it('checks existing subscription on mount and sets isSubscribed=false when none', async () => {
    mockGetSubscription.mockResolvedValue(null)
    const { result } = renderHook(() => usePushNotifications())

    await waitFor(() => {
      expect(result.current.isSubscribed).toBe(false)
    })
  })

  it('checks existing subscription on mount and sets isSubscribed=true when found', async () => {
    mockGetSubscription.mockResolvedValue({ endpoint: 'https://push.example.com' })
    const { result } = renderHook(() => usePushNotifications())

    await waitFor(() => {
      expect(result.current.isSubscribed).toBe(true)
    })
  })

  // ── subscribe ───────────────────────────────────────────────────────────

  it('subscribes: gets VAPID key, subscribes to push, posts to server', async () => {
    const mockSub = {
      toJSON: () => ({
        endpoint: 'https://push.example.com/sub1',
        keys: { p256dh: 'key1', auth: 'auth1' },
      }),
    }
    mockSubscribe.mockResolvedValue(mockSub)

    const { result } = renderHook(() => usePushNotifications())

    await act(async () => {
      await result.current.subscribe()
    })

    // 1. Should fetch VAPID key
    expect(mockApiGet).toHaveBeenCalledWith('/push/vapid-key')

    // 2. Should subscribe via PushManager
    expect(mockSubscribe).toHaveBeenCalledWith({
      userVisibleOnly: true,
      applicationServerKey: expect.any(Uint8Array),
    })

    // 3. Should post subscription to server
    expect(mockApiPost).toHaveBeenCalledWith('/push/subscribe', {
      endpoint: 'https://push.example.com/sub1',
      keys: { p256dh: 'key1', auth: 'auth1' },
    })

    expect(result.current.isSubscribed).toBe(true)
  })

  it('subscribe sets isLoading during the operation', async () => {
    let resolveSubscribe: (v: unknown) => void
    mockSubscribe.mockReturnValue(
      new Promise((r) => {
        resolveSubscribe = r
      }),
    )

    const { result } = renderHook(() => usePushNotifications())

    // Start subscribe (don't await yet)
    let subscribePromise: Promise<void>
    act(() => {
      subscribePromise = result.current.subscribe()
    })

    // isLoading should be true while operation is pending
    expect(result.current.isLoading).toBe(true)

    // Resolve the push subscription
    const mockSub = {
      toJSON: () => ({
        endpoint: 'https://push.example.com',
        keys: { p256dh: 'k', auth: 'a' },
      }),
    }
    await act(async () => {
      resolveSubscribe!(mockSub)
      await subscribePromise!
    })

    expect(result.current.isLoading).toBe(false)
  })

  it('subscribe does nothing when VAPID key fetch fails', async () => {
    mockApiGet.mockResolvedValue({ ok: false })

    const { result } = renderHook(() => usePushNotifications())

    await act(async () => {
      await result.current.subscribe()
    })

    expect(mockSubscribe).not.toHaveBeenCalled()
    expect(result.current.isSubscribed).toBe(false)
  })

  it('subscribe does nothing when VAPID key is missing from response', async () => {
    mockApiGet.mockResolvedValue({ ok: true, data: {} })

    const { result } = renderHook(() => usePushNotifications())

    await act(async () => {
      await result.current.subscribe()
    })

    expect(mockSubscribe).not.toHaveBeenCalled()
    expect(result.current.isSubscribed).toBe(false)
  })

  // ── unsubscribe ─────────────────────────────────────────────────────────

  it('unsubscribes: removes push subscription and posts to server', async () => {
    const mockSub = {
      endpoint: 'https://push.example.com/sub1',
      unsubscribe: mockUnsubscribe,
    }
    mockGetSubscription.mockResolvedValue(mockSub)

    const { result } = renderHook(() => usePushNotifications())

    // Wait for initial subscription check
    await waitFor(() => {
      expect(result.current.isSubscribed).toBe(true)
    })

    await act(async () => {
      await result.current.unsubscribe()
    })

    expect(mockUnsubscribe).toHaveBeenCalled()
    expect(mockApiPost).toHaveBeenCalledWith('/push/unsubscribe', {
      endpoint: 'https://push.example.com/sub1',
    })
    expect(result.current.isSubscribed).toBe(false)
  })

  it('unsubscribe handles case when no subscription exists', async () => {
    mockGetSubscription.mockResolvedValue(null)

    const { result } = renderHook(() => usePushNotifications())

    await act(async () => {
      await result.current.unsubscribe()
    })

    expect(mockUnsubscribe).not.toHaveBeenCalled()
    expect(result.current.isSubscribed).toBe(false)
  })

  it('unsubscribe sets isLoading during the operation', async () => {
    let resolveUnsub!: (v: unknown) => void
    const unsubPromiseCreated = new Promise<void>((notifyCreated) => {
      const mockSub = {
        endpoint: 'https://push.example.com',
        unsubscribe: () =>
          new Promise((r) => {
            resolveUnsub = r
            notifyCreated()
          }),
      }
      // Return the subscription on mount (for isSubscribed check)
      // and again inside unsubscribe() call
      mockGetSubscription.mockResolvedValue(mockSub)
    })

    const { result } = renderHook(() => usePushNotifications())

    await waitFor(() => {
      expect(result.current.isSubscribed).toBe(true)
    })

    // Start unsubscribe (don't await yet)
    let unsubPromise: Promise<void>
    act(() => {
      unsubPromise = result.current.unsubscribe()
    })

    // Wait for the unsubscribe promise to be created so resolveUnsub is assigned
    await act(async () => {
      await unsubPromiseCreated
    })

    expect(result.current.isLoading).toBe(true)

    await act(async () => {
      resolveUnsub(true)
      await unsubPromise!
    })

    expect(result.current.isLoading).toBe(false)
  })

  // ── Error handling ──────────────────────────────────────────────────────

  it('subscribe resets isLoading on error', async () => {
    mockApiGet.mockRejectedValue(new Error('Network error'))

    const { result } = renderHook(() => usePushNotifications())

    await act(async () => {
      try {
        await result.current.subscribe()
      } catch {
        // Expected
      }
    })

    expect(result.current.isLoading).toBe(false)
  })

  it('unsubscribe resets isLoading on error', async () => {
    const mockSub = {
      endpoint: 'https://push.example.com',
      unsubscribe: vi.fn().mockRejectedValue(new Error('Unsub failed')),
    }
    mockGetSubscription.mockResolvedValue(mockSub)

    const { result } = renderHook(() => usePushNotifications())

    await waitFor(() => {
      expect(result.current.isSubscribed).toBe(true)
    })

    await act(async () => {
      try {
        await result.current.unsubscribe()
      } catch {
        // Expected
      }
    })

    expect(result.current.isLoading).toBe(false)
  })
})
