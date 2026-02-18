import { defaultSchema } from 'rehype-sanitize'

/**
 * Shared rehype-sanitize schema that allows className on code/span elements
 * so syntax-highlighting classes injected by rehype-highlight are preserved.
 * Imported by both MessageItem and ChunkBlocks to avoid duplication.
 */
export const markdownSanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [...(defaultSchema.attributes?.code ?? []), 'className'],
    span: [...(defaultSchema.attributes?.span ?? []), 'className'],
  },
}
