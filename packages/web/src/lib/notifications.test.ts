import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Mock localStorage ────────────────────────────────────────────────────────
// happy-dom's localStorage may not support .clear(), so use a Map-backed mock
const storage = new Map<string, string>()
const mockLocalStorage = {
  getItem: vi.fn((key: string) => storage.get(key) ?? null),
  setItem: vi.fn((key: string, value: string) => storage.set(key, value)),
  removeItem: vi.fn((key: string) => storage.delete(key)),
  clear: vi.fn(() => storage.clear()),
  get length() {
    return storage.size
  },
  key: (index: number) => [...storage.keys()][index] ?? null,
}
vi.stubGlobal('localStorage', mockLocalStorage)

import {
  getNotificationPreference,
  setNotificationPreference,
  requestNotificationPermission,
  canShowNotifications,
  showNotification,
} from './notifications.js'

// ── Helpers ──────────────────────────────────────────────────────────────────

function mockNotificationAPI(permission: NotificationPermission) {
  const closeFn = vi.fn()
  // Must use `function` (not arrow) so it can be invoked with `new`
  const NotificationMock = vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this.close = closeFn
    this.onclick = null
  })
  Object.defineProperty(NotificationMock, 'permission', {
    get: () => permission,
    configurable: true,
  })
  NotificationMock.requestPermission = vi.fn()
  Object.defineProperty(window, 'Notification', {
    value: NotificationMock,
    writable: true,
    configurable: true,
  })
  return { NotificationMock, closeFn }
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('getNotificationPreference', () => {
  beforeEach(() => {
    storage.clear()
    vi.clearAllMocks()
  })

  it('returns true by default when no preference is stored', () => {
    expect(getNotificationPreference()).toBe(true)
  })

  it('returns true when preference is "on"', () => {
    storage.set('agentim:notifications', 'on')
    expect(getNotificationPreference()).toBe(true)
  })

  it('returns false when preference is "off"', () => {
    storage.set('agentim:notifications', 'off')
    expect(getNotificationPreference()).toBe(false)
  })

  it('returns true when localStorage throws', () => {
    mockLocalStorage.getItem.mockImplementationOnce(() => {
      throw new Error('SecurityError')
    })
    expect(getNotificationPreference()).toBe(true)
  })
})

describe('setNotificationPreference', () => {
  beforeEach(() => {
    storage.clear()
    vi.clearAllMocks()
  })

  it('stores "on" when enabled is true', () => {
    setNotificationPreference(true)
    expect(storage.get('agentim:notifications')).toBe('on')
  })

  it('stores "off" when enabled is false', () => {
    setNotificationPreference(false)
    expect(storage.get('agentim:notifications')).toBe('off')
  })

  it('does not throw when localStorage is unavailable', () => {
    mockLocalStorage.setItem.mockImplementationOnce(() => {
      throw new Error('QuotaExceededError')
    })
    expect(() => setNotificationPreference(true)).not.toThrow()
  })
})

describe('requestNotificationPermission', () => {
  const originalNotification = globalThis.Notification

  afterEach(() => {
    if (originalNotification) {
      Object.defineProperty(window, 'Notification', {
        value: originalNotification,
        writable: true,
        configurable: true,
      })
    }
  })

  it('returns false when Notification API is not available', async () => {
    const saved = window.Notification
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (window as any).Notification
    const result = await requestNotificationPermission()
    expect(result).toBe(false)
    Object.defineProperty(window, 'Notification', {
      value: saved,
      writable: true,
      configurable: true,
    })
  })

  it('returns true when permission is already granted', async () => {
    mockNotificationAPI('granted')
    const result = await requestNotificationPermission()
    expect(result).toBe(true)
  })

  it('returns false when permission is denied', async () => {
    mockNotificationAPI('denied')
    const result = await requestNotificationPermission()
    expect(result).toBe(false)
  })

  it('requests permission and returns true when granted', async () => {
    const { NotificationMock } = mockNotificationAPI('default')
    NotificationMock.requestPermission.mockResolvedValueOnce('granted')
    const result = await requestNotificationPermission()
    expect(NotificationMock.requestPermission).toHaveBeenCalled()
    expect(result).toBe(true)
  })

  it('requests permission and returns false when denied', async () => {
    const { NotificationMock } = mockNotificationAPI('default')
    NotificationMock.requestPermission.mockResolvedValueOnce('denied')
    const result = await requestNotificationPermission()
    expect(result).toBe(false)
  })
})

describe('canShowNotifications', () => {
  beforeEach(() => {
    storage.clear()
    vi.clearAllMocks()
  })

  it('returns true when all conditions are met', () => {
    mockNotificationAPI('granted')
    storage.set('agentim:notifications', 'on')
    expect(canShowNotifications()).toBe(true)
  })

  it('returns false when permission is not granted', () => {
    mockNotificationAPI('denied')
    expect(canShowNotifications()).toBe(false)
  })

  it('returns false when user preference is off', () => {
    mockNotificationAPI('granted')
    storage.set('agentim:notifications', 'off')
    expect(canShowNotifications()).toBe(false)
  })
})

describe('showNotification', () => {
  beforeEach(() => {
    storage.clear()
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('does not create a notification when canShowNotifications is false', () => {
    mockNotificationAPI('denied')
    showNotification('Title', 'Body')
    expect(window.Notification).not.toHaveBeenCalledWith('Title', expect.anything())
  })

  it('does not create a notification when document is visible', () => {
    mockNotificationAPI('granted')
    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      writable: true,
      configurable: true,
    })
    showNotification('Title', 'Body')
    expect(window.Notification).not.toHaveBeenCalledWith('Title', expect.anything())
  })

  it('creates a notification when document is hidden and permissions are granted', () => {
    const { NotificationMock } = mockNotificationAPI('granted')
    Object.defineProperty(document, 'visibilityState', {
      value: 'hidden',
      writable: true,
      configurable: true,
    })
    showNotification('Title', 'Body')
    expect(NotificationMock).toHaveBeenCalledWith('Title', {
      body: 'Body',
      icon: '/favicon.svg',
      tag: 'agentim-message',
    })
  })

  it('uses custom tag when provided', () => {
    const { NotificationMock } = mockNotificationAPI('granted')
    Object.defineProperty(document, 'visibilityState', {
      value: 'hidden',
      writable: true,
      configurable: true,
    })
    showNotification('Title', 'Body', undefined, 'custom-tag')
    expect(NotificationMock).toHaveBeenCalledWith('Title', {
      body: 'Body',
      icon: '/favicon.svg',
      tag: 'custom-tag',
    })
  })

  it('auto-closes notification after 8 seconds', () => {
    const { closeFn } = mockNotificationAPI('granted')
    Object.defineProperty(document, 'visibilityState', {
      value: 'hidden',
      writable: true,
      configurable: true,
    })
    showNotification('Title', 'Body')
    expect(closeFn).not.toHaveBeenCalled()
    vi.advanceTimersByTime(8000)
    expect(closeFn).toHaveBeenCalled()
  })

  it('sets onclick handler when callback is provided', () => {
    mockNotificationAPI('granted')
    Object.defineProperty(document, 'visibilityState', {
      value: 'hidden',
      writable: true,
      configurable: true,
    })
    const onClick = vi.fn()
    const focusSpy = vi.spyOn(window, 'focus').mockImplementation(() => {})

    showNotification('Title', 'Body', onClick)

    // Get the notification instance from the mock constructor
    const instance = (window.Notification as unknown as ReturnType<typeof vi.fn>).mock.results[0]
      .value
    expect(instance.onclick).toBeTypeOf('function')

    // Simulate click
    instance.onclick()
    expect(focusSpy).toHaveBeenCalled()
    expect(onClick).toHaveBeenCalled()
    expect(instance.close).toHaveBeenCalled()

    focusSpy.mockRestore()
  })
})
