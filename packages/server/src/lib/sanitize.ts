/**
 * Strip ALL HTML tags from short user-facing text fields (room names, display names, etc.)
 * These fields never legitimately contain angle brackets, so aggressive stripping is safe.
 */
export function stripHtml(input: string): string {
  return input.replace(/<[^>]*>/g, '')
}

/**
 * Sanitize user-facing text fields (room names, display names, etc.)
 * Strips all HTML tags and trims whitespace.
 */
export function sanitizeText(input: string): string {
  return stripHtml(input).trim()
}

// Patterns that are unambiguously dangerous regardless of context.
// Full HTML sanitization is applied client-side via rehype-sanitize;
// these patterns (script/iframe/object blocks) are the constructs that would
// cause harm even in a server-rendered or API-consumer context and never
// appear in legitimate markdown or code.
const DANGEROUS_PATTERNS: RegExp[] = [
  // <script>…</script> blocks (including multiline, case-insensitive)
  /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script\s*>/gi,
  // <iframe>…</iframe>
  /<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe\s*>/gi,
  // <object>…</object>
  /<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object\s*>/gi,
]

/**
 * Sanitize message content.
 * Preserves legitimate markdown and technical text (e.g. `Array<string>`, `a < b`,
 * `use onload=lazy`) while stripping only constructs that are unambiguously
 * dangerous (script/iframe/object tags and inline event-handler attributes).
 *
 * Event-handler attributes (onclick=…, onload=…, etc.) are stripped only when
 * they appear inside HTML tag syntax (`<tag … >`), so ordinary prose or code
 * that happens to contain the text "onload=lazy" is never silently modified.
 *
 * The primary XSS defence is client-side (rehype-sanitize); this function is
 * defence-in-depth for non-web consumers and stored-content safety.
 */
export function sanitizeContent(input: string): string {
  let result = input

  // Strip dangerous block-level tags first.
  for (const pattern of DANGEROUS_PATTERNS) {
    result = result.replace(pattern, '')
  }

  // Strip event-handler attributes (onclick, onload, onerror, …) only when
  // they appear inside what looks like an HTML opening tag.  Running this
  // globally on the full string would silently corrupt legitimate technical
  // text such as "img onload=lazy" or React JSX event props in code examples.
  result = result.replace(/<[a-zA-Z][^>]*>/g, (tag) =>
    tag.replace(/\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*)/gi, ''),
  )

  return result
}
