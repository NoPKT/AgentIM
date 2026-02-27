import { describe, it, expect } from 'vitest'
import { markdownSanitizeSchema } from './markdown.js'

describe('markdownSanitizeSchema', () => {
  describe('structure', () => {
    it('has attributes property', () => {
      expect(markdownSanitizeSchema.attributes).toBeDefined()
    })

    it('has code attribute rules', () => {
      expect(markdownSanitizeSchema.attributes!.code).toBeDefined()
      expect(Array.isArray(markdownSanitizeSchema.attributes!.code)).toBe(true)
    })

    it('has span attribute rules', () => {
      expect(markdownSanitizeSchema.attributes!.span).toBeDefined()
      expect(Array.isArray(markdownSanitizeSchema.attributes!.span)).toBe(true)
    })
  })

  describe('code className pattern', () => {
    // Extract all className regex patterns from the code attribute array
    function getCodeClassNamePatterns(): RegExp[] {
      const codeAttrs = markdownSanitizeSchema.attributes!.code as unknown[]
      const patterns: RegExp[] = []
      for (const entry of codeAttrs) {
        if (Array.isArray(entry) && entry[0] === 'className' && entry[1] instanceof RegExp) {
          patterns.push(entry[1])
        }
      }
      return patterns
    }

    // Test if any pattern matches the given value
    function matchesAnyCodePattern(value: string): boolean {
      return getCodeClassNamePatterns().some((p) => p.test(value))
    }

    it('has at least one className regex pattern', () => {
      expect(getCodeClassNamePatterns().length).toBeGreaterThan(0)
    })

    it('allows language-* classes', () => {
      expect(matchesAnyCodePattern('language-javascript')).toBe(true)
      expect(matchesAnyCodePattern('language-typescript')).toBe(true)
      expect(matchesAnyCodePattern('language-python')).toBe(true)
      expect(matchesAnyCodePattern('language-css')).toBe(true)
    })

    it('allows hljs and hljs-* classes', () => {
      expect(matchesAnyCodePattern('hljs')).toBe(true)
      expect(matchesAnyCodePattern('hljs-keyword')).toBe(true)
      expect(matchesAnyCodePattern('hljs-string')).toBe(true)
    })

    it('rejects arbitrary classes', () => {
      expect(matchesAnyCodePattern('my-custom-class')).toBe(false)
      expect(matchesAnyCodePattern('malicious')).toBe(false)
      expect(matchesAnyCodePattern('xss-inject')).toBe(false)
    })

    it('rejects dangerous class patterns', () => {
      expect(matchesAnyCodePattern('')).toBe(false)
      expect(matchesAnyCodePattern('onclick')).toBe(false)
    })
  })

  describe('span className pattern', () => {
    function getSpanClassNamePattern(): RegExp | undefined {
      const spanAttrs = markdownSanitizeSchema.attributes!.span as unknown[]
      for (const entry of spanAttrs) {
        if (Array.isArray(entry) && entry[0] === 'className' && entry[1] instanceof RegExp) {
          return entry[1]
        }
      }
      return undefined
    }

    it('allows hljs-* classes on span', () => {
      const pattern = getSpanClassNamePattern()!
      expect(pattern).toBeDefined()
      expect(pattern.test('hljs-keyword')).toBe(true)
      expect(pattern.test('hljs-string')).toBe(true)
      expect(pattern.test('hljs-number')).toBe(true)
      expect(pattern.test('hljs-comment')).toBe(true)
      expect(pattern.test('hljs-built_in')).toBe(true)
    })

    it('rejects non-hljs classes on span', () => {
      const pattern = getSpanClassNamePattern()!
      expect(pattern.test('language-javascript')).toBe(false)
      expect(pattern.test('custom-class')).toBe(false)
      expect(pattern.test('malicious')).toBe(false)
    })

    it('rejects empty string', () => {
      const pattern = getSpanClassNamePattern()!
      expect(pattern.test('')).toBe(false)
    })

    it('rejects classes with spaces or special characters', () => {
      const pattern = getSpanClassNamePattern()!
      expect(pattern.test('hljs keyword')).toBe(false)
      expect(pattern.test('hljs<script>')).toBe(false)
    })
  })

  describe('preserves default schema', () => {
    it('preserves tag stripping and other default behaviors', () => {
      // The schema extends defaultSchema, so tagNames should exist
      expect(markdownSanitizeSchema.tagNames).toBeDefined()
    })

    it('does not remove default attributes', () => {
      // href on anchor tags should be preserved from defaultSchema
      const aAttrs = markdownSanitizeSchema.attributes!.a
      expect(aAttrs).toBeDefined()
    })
  })
})
