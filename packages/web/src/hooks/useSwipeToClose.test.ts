import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useSwipeToClose } from './useSwipeToClose.js'

// Helper to create a minimal TouchEvent-like object for the handlers.
// React TouchEventHandlers accept React.TouchEvent which is close enough to
// what we construct here for handler invocation in tests.
function makeTouchEvent(clientX: number, clientY: number, touchCount = 1) {
  const touches = Array.from({ length: touchCount }, () => ({ clientX, clientY }))
  return { touches } as unknown as React.TouchEvent
}

describe('useSwipeToClose', () => {
  let onClose: () => void

  beforeEach(() => {
    onClose = vi.fn()
  })

  it('returns initial state with isSwiping=false and no style', () => {
    const { result } = renderHook(() => useSwipeToClose({ onClose }))
    expect(result.current.isSwiping).toBe(false)
    expect(result.current.style).toBeUndefined()
    expect(result.current.progress).toBe(0)
  })

  it('exposes onTouchStart, onTouchMove, and onTouchEnd handlers', () => {
    const { result } = renderHook(() => useSwipeToClose({ onClose }))
    expect(typeof result.current.handlers.onTouchStart).toBe('function')
    expect(typeof result.current.handlers.onTouchMove).toBe('function')
    expect(typeof result.current.handlers.onTouchEnd).toBe('function')
  })

  it('ignores multi-touch on start', () => {
    const { result } = renderHook(() => useSwipeToClose({ onClose }))

    act(() => {
      result.current.handlers.onTouchStart(makeTouchEvent(100, 100, 2))
      result.current.handlers.onTouchMove(makeTouchEvent(50, 100, 1))
    })

    // No swipe should be tracked because start was multi-touch
    expect(result.current.isSwiping).toBe(false)
  })

  it('ignores multi-touch on move', () => {
    const { result } = renderHook(() => useSwipeToClose({ onClose }))

    act(() => {
      result.current.handlers.onTouchStart(makeTouchEvent(200, 100))
      result.current.handlers.onTouchMove(makeTouchEvent(100, 100, 2))
    })

    expect(result.current.isSwiping).toBe(false)
  })

  it('does not start swiping for small movements (below direction lock threshold)', () => {
    const { result } = renderHook(() => useSwipeToClose({ onClose }))

    act(() => {
      result.current.handlers.onTouchStart(makeTouchEvent(100, 100))
      // Move less than 10px in any direction
      result.current.handlers.onTouchMove(makeTouchEvent(95, 97))
    })

    expect(result.current.isSwiping).toBe(false)
  })

  it('does not swipe for vertical gestures', () => {
    const { result } = renderHook(() => useSwipeToClose({ onClose }))

    act(() => {
      result.current.handlers.onTouchStart(makeTouchEvent(100, 100))
      // Move primarily vertically (> 10px vertical, < 10px horizontal)
      result.current.handlers.onTouchMove(makeTouchEvent(102, 50))
    })

    expect(result.current.isSwiping).toBe(false)
  })

  it('does not swipe for right-swipe (positive deltaX)', () => {
    const { result } = renderHook(() => useSwipeToClose({ onClose }))

    act(() => {
      result.current.handlers.onTouchStart(makeTouchEvent(100, 100))
      // Move right by more than 10px to lock direction
      result.current.handlers.onTouchMove(makeTouchEvent(200, 100))
    })

    // Right swipe resets to not swiping
    expect(result.current.isSwiping).toBe(false)
  })

  it('tracks left swipe with translateX style', () => {
    const { result } = renderHook(() => useSwipeToClose({ onClose }))

    act(() => {
      result.current.handlers.onTouchStart(makeTouchEvent(200, 100))
      // Move left by 50px (past the 10px lock threshold)
      result.current.handlers.onTouchMove(makeTouchEvent(150, 100))
    })

    expect(result.current.isSwiping).toBe(true)
    expect(result.current.style).toEqual({
      transform: 'translateX(-50px)',
      transition: 'none',
    })
    expect(result.current.progress).toBeGreaterThan(0)
  })

  it('calls onClose when left swipe exceeds threshold', () => {
    const threshold = 80
    const { result } = renderHook(() => useSwipeToClose({ onClose, threshold }))

    act(() => {
      result.current.handlers.onTouchStart(makeTouchEvent(200, 100))
      result.current.handlers.onTouchMove(makeTouchEvent(100, 100))
      result.current.handlers.onTouchEnd(makeTouchEvent(100, 100))
    })

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does not call onClose when left swipe is below threshold', () => {
    const threshold = 80
    const { result } = renderHook(() => useSwipeToClose({ onClose, threshold }))

    act(() => {
      result.current.handlers.onTouchStart(makeTouchEvent(200, 100))
      // Move only 50px left (below 80px threshold)
      result.current.handlers.onTouchMove(makeTouchEvent(150, 100))
      result.current.handlers.onTouchEnd(makeTouchEvent(150, 100))
    })

    expect(onClose).not.toHaveBeenCalled()
  })

  it('resets isSwiping and style after touch end', () => {
    const { result } = renderHook(() => useSwipeToClose({ onClose }))

    act(() => {
      result.current.handlers.onTouchStart(makeTouchEvent(200, 100))
      result.current.handlers.onTouchMove(makeTouchEvent(100, 100))
    })
    expect(result.current.isSwiping).toBe(true)

    act(() => {
      result.current.handlers.onTouchEnd(makeTouchEvent(100, 100))
    })
    expect(result.current.isSwiping).toBe(false)
    expect(result.current.style).toBeUndefined()
    expect(result.current.progress).toBe(0)
  })

  it('uses default threshold of 80 when not specified', () => {
    const { result } = renderHook(() => useSwipeToClose({ onClose }))

    // Swipe exactly 81px left — should trigger close
    act(() => {
      result.current.handlers.onTouchStart(makeTouchEvent(200, 100))
      result.current.handlers.onTouchMove(makeTouchEvent(119, 100))
      result.current.handlers.onTouchEnd(makeTouchEvent(119, 100))
    })

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('progress is capped at 1', () => {
    const threshold = 50
    const { result } = renderHook(() => useSwipeToClose({ onClose, threshold }))

    act(() => {
      result.current.handlers.onTouchStart(makeTouchEvent(300, 100))
      // Swipe far beyond threshold * 2 = 100
      result.current.handlers.onTouchMove(makeTouchEvent(50, 100))
    })

    expect(result.current.progress).toBeLessThanOrEqual(1)
  })

  it('handles touchEnd with no prior touchStart gracefully', () => {
    const { result } = renderHook(() => useSwipeToClose({ onClose }))

    // Should not throw
    act(() => {
      result.current.handlers.onTouchEnd(makeTouchEvent(100, 100))
    })

    expect(result.current.isSwiping).toBe(false)
    expect(onClose).not.toHaveBeenCalled()
  })
})
