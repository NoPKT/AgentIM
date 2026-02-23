import type { Context } from 'hono'
import { createMiddleware } from 'hono/factory'
import type { ZodError } from 'zod'

/**
 * Format a ZodError into a flat array of field-level error messages.
 * Suitable for including in API error responses to help clients diagnose issues.
 *
 * Example output:
 *   [{ field: 'username', message: 'String must contain at least 3 character(s)' }]
 */
export function formatZodError(error: ZodError): { field: string; message: string }[] {
  return error.issues.map((issue) => ({
    field: issue.path.join('.') || '(root)',
    message: issue.message,
  }))
}

/**
 * Safely parse JSON body from a request.
 * Returns the parsed object or a 400 Response if the body is not valid JSON.
 */
export async function parseJsonBody(c: Context): Promise<unknown | Response> {
  try {
    return await c.req.json()
  } catch {
    return c.json({ ok: false, error: 'Invalid JSON body' }, 400)
  }
}

/**
 * Safely parse a query parameter as an integer with bounds.
 * Returns `defaultVal` when the raw value is missing, empty, or non-numeric.
 */
export function parseQueryInt(
  raw: string | undefined,
  defaultVal: number,
  min: number,
  max: number,
): number {
  const parsed = parseInt(raw ?? '', 10)
  const value = Number.isNaN(parsed) ? defaultVal : parsed
  return Math.min(Math.max(value, min), max)
}

/**
 * Validate that a URL parameter is a plausible nanoid or short string ID.
 * Rejects empty strings and excessively long values.
 */
// nanoid uses A-Za-z0-9_- charset; reject anything outside that range
const VALID_ID_RE = /^[A-Za-z0-9_-]+$/

export function isValidId(id: string): boolean {
  return typeof id === 'string' && id.length > 0 && id.length <= 30 && VALID_ID_RE.test(id)
}

/**
 * Hono middleware that validates all named URL params are valid IDs.
 * Returns 400 if any param fails validation.
 */
export const validateIdParams = createMiddleware(async (c, next) => {
  // c.req.param() returns all params as a Record when called with no args
  const params = c.req.param() as Record<string, string>
  for (const [key, value] of Object.entries(params)) {
    if (!isValidId(value)) {
      return c.json({ ok: false, error: `Invalid parameter: ${key}` }, 400)
    }
  }
  await next()
})
