import type { Page } from '@playwright/test'

export interface WsFrame {
  data: string
  ts: number
}

export interface WsCapture {
  sent: WsFrame[]
  received: WsFrame[]
}

/**
 * Intercept WebSocket frames on a page.
 * Must be called BEFORE page.goto() so that the listener catches the WS connection.
 */
export function interceptWs(page: Page): WsCapture {
  const capture: WsCapture = { sent: [], received: [] }

  page.on('websocket', (ws) => {
    ws.on('framesent', (frame) => {
      if (typeof frame.payload === 'string') {
        capture.sent.push({ data: frame.payload, ts: Date.now() })
      }
    })
    ws.on('framereceived', (frame) => {
      if (typeof frame.payload === 'string') {
        capture.received.push({ data: frame.payload, ts: Date.now() })
      }
    })
  })

  return capture
}

/**
 * Wait for a frame matching the predicate in the specified direction.
 * Polls every 100ms with a default 10s timeout.
 */
export async function waitForFrame(
  capture: WsCapture,
  direction: 'sent' | 'received',
  predicate: (parsed: Record<string, unknown>) => boolean,
  timeoutMs = 10_000,
): Promise<Record<string, unknown>> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const frames = capture[direction]
    for (const frame of frames) {
      try {
        const parsed = JSON.parse(frame.data) as Record<string, unknown>
        if (predicate(parsed)) return parsed
      } catch {
        // skip non-JSON frames
      }
    }
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error(
    `waitForFrame(${direction}) timed out after ${timeoutMs}ms. ` +
      `Captured ${capture[direction].length} frames.`,
  )
}

/**
 * Get all frames of a specific message type.
 */
export function getFramesByType(
  capture: WsCapture,
  direction: 'sent' | 'received',
  type: string,
): Record<string, unknown>[] {
  return capture[direction]
    .map((f) => {
      try {
        return JSON.parse(f.data) as Record<string, unknown>
      } catch {
        return null
      }
    })
    .filter((p): p is Record<string, unknown> => p !== null && p.type === type)
}
