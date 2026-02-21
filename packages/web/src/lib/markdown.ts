import { defaultSchema } from 'rehype-sanitize'
import type { Schema } from 'hast-util-sanitize'

/**
 * Shared rehype-sanitize schema that allows className on code/span elements
 * so syntax-highlighting classes injected by rehype-highlight are preserved.
 * Imported by both MessageItem and ChunkBlocks to avoid duplication.
 */
// Only allow className values that match syntax-highlighting patterns injected by
// rehype-highlight (hljs-* classes on span, language-* and hljs on code).
// Arbitrary className values are rejected to reduce XSS surface area.
export const markdownSanitizeSchema: Schema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [...(defaultSchema.attributes?.code ?? []), ['className', /^(hljs|language-)\S*$/]],
    span: [...(defaultSchema.attributes?.span ?? []), ['className', /^hljs\S*$/]],
  },
}
