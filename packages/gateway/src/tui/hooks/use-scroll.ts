import { useState, useCallback, useEffect, useRef } from 'react'

export function useScroll(totalLines: number, visibleLines: number) {
  const [offset, setOffset] = useState(0)
  const [autoFollow, setAutoFollow] = useState(true)
  const prevTotal = useRef(totalLines)

  const maxOffset = Math.max(0, totalLines - visibleLines)

  // Snap to bottom when auto-follow is active (new lines, resize, etc.).
  // When total shrinks (e.g. switched to a different log source), clamp offset.
  useEffect(() => {
    if (totalLines < prevTotal.current) {
      // Log source changed — clamp offset to valid range and snap to bottom
      setOffset(Math.max(0, totalLines - visibleLines))
      setAutoFollow(true)
    } else if (autoFollow) {
      // Auto-follow: always snap to bottom
      setOffset(Math.max(0, totalLines - visibleLines))
    }
    prevTotal.current = totalLines
  }, [totalLines, visibleLines, autoFollow])

  const scrollUp = useCallback(
    (n = 1) => {
      setOffset((o) => {
        const next = Math.max(0, o - n)
        if (next < maxOffset) setAutoFollow(false)
        return next
      })
    },
    [maxOffset],
  )

  const scrollDown = useCallback(
    (n = 1) => {
      setOffset((o) => {
        const next = Math.min(maxOffset, o + n)
        if (next >= maxOffset) setAutoFollow(true)
        return next
      })
    },
    [maxOffset],
  )

  const pageUp = useCallback(() => {
    scrollUp(Math.max(1, visibleLines - 1))
  }, [scrollUp, visibleLines])

  const pageDown = useCallback(() => {
    scrollDown(Math.max(1, visibleLines - 1))
  }, [scrollDown, visibleLines])

  const goTop = useCallback(() => {
    setOffset(0)
    setAutoFollow(false)
  }, [])

  const goBottom = useCallback(() => {
    setOffset(maxOffset)
    setAutoFollow(true)
  }, [maxOffset])

  /** Scroll to center a specific line index in the viewport. */
  const scrollTo = useCallback(
    (lineIndex: number) => {
      const target = Math.max(0, Math.min(maxOffset, lineIndex - Math.floor(visibleLines / 2)))
      setOffset(target)
      setAutoFollow(target >= maxOffset)
    },
    [maxOffset, visibleLines],
  )

  return { offset, autoFollow, scrollUp, scrollDown, pageUp, pageDown, goTop, goBottom, scrollTo }
}
