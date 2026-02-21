import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

// Mock wsClient before importing the hook
const mockUnsub = vi.fn()
const mockOnStatusChange = vi.fn((_cb: (status: string) => void) => mockUnsub)
const mockWsClient = {
  status: 'disconnected' as string,
  onStatusChange: mockOnStatusChange,
}

vi.mock('../lib/ws.js', () => ({
  wsClient: mockWsClient,
}))

// Import after mocking
const { useConnectionStatus } = await import('./useConnectionStatus.js')

describe('useConnectionStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWsClient.status = 'disconnected'
    mockOnStatusChange.mockReturnValue(mockUnsub)
  })

  it('returns initial status from wsClient.status', () => {
    mockWsClient.status = 'connected'
    const { result } = renderHook(() => useConnectionStatus())
    expect(result.current).toBe('connected')
  })

  it('returns disconnected as initial status when not connected', () => {
    mockWsClient.status = 'disconnected'
    const { result } = renderHook(() => useConnectionStatus())
    expect(result.current).toBe('disconnected')
  })

  it('registers an onStatusChange listener on mount', () => {
    renderHook(() => useConnectionStatus())
    expect(mockOnStatusChange).toHaveBeenCalledTimes(1)
    expect(mockOnStatusChange).toHaveBeenCalledWith(expect.any(Function))
  })

  it('calls cleanup function returned by onStatusChange on unmount', () => {
    const { unmount } = renderHook(() => useConnectionStatus())
    unmount()
    expect(mockUnsub).toHaveBeenCalledTimes(1)
  })

  it('updates status when the registered callback is called', () => {
    let capturedCallback: ((status: string) => void) | null = null
    mockOnStatusChange.mockImplementation((cb: (status: string) => void) => {
      capturedCallback = cb
      return mockUnsub
    })

    const { result } = renderHook(() => useConnectionStatus())
    expect(result.current).toBe('disconnected')

    act(() => {
      capturedCallback?.('connected')
    })

    expect(result.current).toBe('connected')
  })

  it('updates to reconnecting status', () => {
    let capturedCallback: ((status: string) => void) | null = null
    mockOnStatusChange.mockImplementation((cb: (status: string) => void) => {
      capturedCallback = cb
      return mockUnsub
    })

    const { result } = renderHook(() => useConnectionStatus())

    act(() => {
      capturedCallback?.('reconnecting')
    })

    expect(result.current).toBe('reconnecting')
  })
})
