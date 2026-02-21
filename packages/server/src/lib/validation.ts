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
 * Validate that a URL parameter is a plausible nanoid or short string ID.
 * Rejects empty strings and excessively long values.
 */
export function isValidId(id: string): boolean {
  return typeof id === 'string' && id.length > 0 && id.length <= 30
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
