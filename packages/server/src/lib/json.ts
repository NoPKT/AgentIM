/**
 * Depth-limited JSON parser with collection size guards.
 * Shared by clientHandler and gatewayHandler to prevent DoS via
 * deeply nested or excessively wide JSON payloads.
 */

/** Maximum number of elements in an array or keys in an object at any level. */
export const MAX_COLLECTION_SIZE = 1000

/** Parse JSON with a nesting depth limit and collection size guard. */
export function safeJsonParse(raw: string, maxDepth: number): unknown {
  const result = JSON.parse(raw)
  checkDepth(result, maxDepth, 0)
  return result
}

function checkDepth(value: unknown, maxDepth: number, current: number): void {
  if (current > maxDepth) {
    throw new Error('JSON nesting depth exceeded')
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_COLLECTION_SIZE) {
      throw new Error('JSON collection size exceeded')
    }
    for (const item of value) {
      checkDepth(item, maxDepth, current + 1)
    }
  } else if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>)
    if (keys.length > MAX_COLLECTION_SIZE) {
      throw new Error('JSON collection size exceeded')
    }
    for (const key of keys) {
      checkDepth((value as Record<string, unknown>)[key], maxDepth, current + 1)
    }
  }
}
