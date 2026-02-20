import { useRef, useCallback, useState, type CSSProperties, type TouchEventHandler } from 'react'

interface SwipeState {
  startX: number
  startY: number
  currentX: number
  directionLocked: boolean
  isHorizontal: boolean
}

interface UseSwipeToCloseOptions {
  onClose: () => void
  threshold?: number
}

interface UseSwipeToCloseReturn {
  handlers: {
    onTouchStart: TouchEventHandler
    onTouchMove: TouchEventHandler
    onTouchEnd: TouchEventHandler
  }
  style: CSSProperties | undefined
  isSwiping: boolean
  progress: number
}

export function useSwipeToClose({
  onClose,
  threshold = 80,
}: UseSwipeToCloseOptions): UseSwipeToCloseReturn {
  const stateRef = useRef<SwipeState | null>(null)
  const [isSwiping, setIsSwiping] = useState(false)
  const [translateX, setTranslateX] = useState(0)

  const onTouchStart: TouchEventHandler = useCallback((e) => {
    if (e.touches.length !== 1) return
    stateRef.current = {
      startX: e.touches[0].clientX,
      startY: e.touches[0].clientY,
      currentX: e.touches[0].clientX,
      directionLocked: false,
      isHorizontal: false,
    }
  }, [])

  const onTouchMove: TouchEventHandler = useCallback((e) => {
    const state = stateRef.current
    if (!state || e.touches.length !== 1) return

    const touch = e.touches[0]
    const deltaX = touch.clientX - state.startX
    const deltaY = touch.clientY - state.startY

    if (!state.directionLocked) {
      if (Math.abs(deltaX) < 10 && Math.abs(deltaY) < 10) return
      state.directionLocked = true
      state.isHorizontal = Math.abs(deltaX) > Math.abs(deltaY)
    }

    if (!state.isHorizontal) return

    // Only allow left swipe (negative deltaX = closing)
    if (deltaX > 0) {
      state.currentX = state.startX
      setTranslateX(0)
      setIsSwiping(false)
      return
    }

    state.currentX = touch.clientX
    setTranslateX(deltaX)
    setIsSwiping(true)
  }, [])

  const onTouchEnd: TouchEventHandler = useCallback(() => {
    const state = stateRef.current
    if (!state) return

    const deltaX = state.currentX - state.startX

    if (state.isHorizontal && deltaX < -threshold) {
      onClose()
    }

    stateRef.current = null
    setIsSwiping(false)
    setTranslateX(0)
  }, [onClose, threshold])

  const progress = isSwiping ? Math.min(1, Math.abs(translateX) / (threshold * 2)) : 0

  const style: CSSProperties | undefined = isSwiping
    ? {
        transform: `translateX(${translateX}px)`,
        transition: 'none',
      }
    : undefined

  return {
    handlers: { onTouchStart, onTouchMove, onTouchEnd },
    style,
    isSwiping,
    progress,
  }
}
