import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'

// ── Mocks ───────────────────────────────────────────────────────────────────

const mockGetToken = vi.fn()
let mockTokenVersion = 0

vi.mock('../stores/auth.js', () => ({
  useAuthStore: Object.assign(
    // Zustand selector pattern: the store is called as a function with a selector
    (selector: (s: { tokenVersion: number }) => number) =>
      selector({ tokenVersion: mockTokenVersion }),
    {
      getState: () => ({ tokenVersion: mockTokenVersion }),
    },
  ),
}))

vi.mock('../lib/api.js', () => ({
  api: {
    getToken: () => mockGetToken(),
  },
}))

const { useUploadUrl, useUploadUrls } = await import('./useUploadUrl.js')

// ── Tests ───────────────────────────────────────────────────────────────────

describe('useUploadUrl', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockTokenVersion = 0
    mockGetToken.mockReturnValue(null)
  })

  it('returns empty string for empty/null/undefined URL', () => {
    const { result: r1 } = renderHook(() => useUploadUrl(''))
    expect(r1.current).toBe('')

    const { result: r2 } = renderHook(() => useUploadUrl(null))
    expect(r2.current).toBe('')

    const { result: r3 } = renderHook(() => useUploadUrl(undefined))
    expect(r3.current).toBe('')
  })

  it('returns non-upload URLs unchanged', () => {
    const { result } = renderHook(() => useUploadUrl('/api/users'))
    expect(result.current).toBe('/api/users')
  })

  it('returns upload URL unchanged when no token is available', () => {
    mockGetToken.mockReturnValue(null)
    const { result } = renderHook(() => useUploadUrl('/uploads/photo.jpg'))
    expect(result.current).toBe('/uploads/photo.jpg')
  })

  it('appends token parameter to upload URLs', () => {
    mockGetToken.mockReturnValue('my-access-token')
    const { result } = renderHook(() => useUploadUrl('/uploads/photo.jpg'))
    expect(result.current).toBe('/uploads/photo.jpg?token=my-access-token')
  })

  it('encodes special characters in the token', () => {
    mockGetToken.mockReturnValue('token with spaces&special=chars')
    const { result } = renderHook(() => useUploadUrl('/uploads/file.png'))
    expect(result.current).toBe(
      `/uploads/file.png?token=${encodeURIComponent('token with spaces&special=chars')}`,
    )
  })

  it('does not append token to non-upload paths even with valid token', () => {
    mockGetToken.mockReturnValue('valid-token')
    const { result } = renderHook(() => useUploadUrl('/api/data'))
    expect(result.current).toBe('/api/data')
  })

  it('responds to tokenVersion changes', () => {
    mockGetToken.mockReturnValue('token-v0')
    mockTokenVersion = 0
    const { result, rerender } = renderHook(() => useUploadUrl('/uploads/img.png'))
    expect(result.current).toBe('/uploads/img.png?token=token-v0')

    // Simulate token rotation
    mockGetToken.mockReturnValue('token-v1')
    mockTokenVersion = 1
    rerender()
    expect(result.current).toBe('/uploads/img.png?token=token-v1')
  })
})

describe('useUploadUrls', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockTokenVersion = 0
    mockGetToken.mockReturnValue(null)
  })

  it('returns original URLs when no token is available', () => {
    mockGetToken.mockReturnValue(null)
    const urls = ['/uploads/a.jpg', '/uploads/b.png', '/api/data']
    const { result } = renderHook(() => useUploadUrls(urls))
    expect(result.current).toEqual(urls)
  })

  it('appends token only to upload URLs in the array', () => {
    mockGetToken.mockReturnValue('tok')
    const urls = ['/uploads/a.jpg', '/api/data', '/uploads/b.png']
    const { result } = renderHook(() => useUploadUrls(urls))
    expect(result.current).toEqual([
      '/uploads/a.jpg?token=tok',
      '/api/data',
      '/uploads/b.png?token=tok',
    ])
  })

  it('handles empty array', () => {
    mockGetToken.mockReturnValue('tok')
    const { result } = renderHook(() => useUploadUrls([]))
    expect(result.current).toEqual([])
  })

  it('handles array with no upload URLs', () => {
    mockGetToken.mockReturnValue('tok')
    const urls = ['/api/data', '/images/logo.svg']
    const { result } = renderHook(() => useUploadUrls(urls))
    expect(result.current).toEqual(urls)
  })
})
