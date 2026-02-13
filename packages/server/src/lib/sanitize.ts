/**
 * Strip HTML tags from user input to prevent stored XSS.
 * React escapes output by default, but this is defense-in-depth.
 */
export function stripHtml(input: string): string {
  return input.replace(/<[^>]*>/g, '')
}

/**
 * Sanitize user-facing text fields (room names, display names, etc.)
 * Strips HTML tags and trims whitespace.
 */
export function sanitizeText(input: string): string {
  return stripHtml(input).trim()
}

/**
 * Sanitize message content.
 * We allow markdown but strip raw HTML tags.
 */
export function sanitizeContent(input: string): string {
  return stripHtml(input)
}
