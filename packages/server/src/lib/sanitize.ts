/**
 * Strip ALL HTML tags from short user-facing text fields (room names, display names, etc.)
 * These fields never legitimately contain angle brackets, so aggressive stripping is safe.
 */
export function stripHtml(input: string): string {
  // Decode common HTML entities first, then strip tags
  const decoded = input
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
  return decoded.replace(/<[^>]*>/g, '')
}

/**
 * Sanitize user-facing text fields (room names, display names, etc.)
 * Strips all HTML tags and trims whitespace.
 */
export function sanitizeText(input: string): string {
  return sanitizeContent(stripHtml(input)).trim()
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
  // <embed> (void element — no closing tag)
  /<embed\b[^>]*>/gi,
  // <form>…</form> (prevents phishing via injected forms)
  /<form\b[^<]*(?:(?!<\/form>)<[^<]*)*<\/form\s*>/gi,
  // <svg>…</svg> blocks — SVGs can embed <script>, <foreignObject>,
  // <use xlink:href="data:…">, and event handlers to execute arbitrary JS.
  /<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg\s*>/gi,
  // <math>…</math> blocks — MathML can contain embedded scripts via
  // annotation-xml and similar exotic injection vectors.
  /<math\b[^<]*(?:(?!<\/math>)<[^<]*)*<\/math\s*>/gi,
]

/**
 * Sanitize message content.
 * Preserves legitimate markdown and technical text (e.g. `Array<string>`, `a < b`,
 * `use onload=lazy`) while stripping only constructs that are unambiguously
 * dangerous (script/iframe/object tags, inline event-handler attributes, and
 * dangerous URL schemes in href/src/action/formaction attributes).
 *
 * Event-handler and URL-scheme stripping are applied only when they appear
 * inside HTML tag syntax (`<tag … >`), so ordinary prose or code that happens
 * to contain the text "onload=lazy" or "javascript:" is never silently modified.
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

  // Within each HTML opening tag, strip three classes of dangerous content:
  //   1. Event-handler attributes (onclick=…, onload=…, onerror=…, …)
  //   2. Dangerous URL schemes in quoted href/src/action/formaction attributes
  //      (javascript:, vbscript:, data: — covers stored-XSS via pseudo-protocols)
  //   3. Dangerous URL schemes in unquoted href/src/action/formaction attributes
  //      (defense-in-depth — browsers normalize these to quoted form, but strip
  //      server-side as well to protect non-browser API consumers)
  //
  // URL-scheme stripping notes:
  //   • Requires \s+ before the attribute name so that substrings like `data-href`
  //     (word boundary after `-` would also satisfy \b) are NOT matched.
  //   • Quoted and unquoted values are handled in separate passes to avoid
  //     false positives from prose containing `href=javascript:…`.
  result = result.replace(/<[a-zA-Z][^>]*>/g, (tag) =>
    tag
      .replace(/\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*)/gi, '')
      .replace(
        /(\s+(?:href|src|action|formaction)\s*=\s*)(?:"(?:javascript|vbscript|data):[^"]*"|'(?:javascript|vbscript|data):[^']*')/gi,
        '$1""',
      )
      .replace(
        /(\s+(?:href|src|action|formaction)\s*=\s*)(?:javascript|vbscript|data):[^\s>"']*/gi,
        '$1""',
      ),
  )

  return result
}
