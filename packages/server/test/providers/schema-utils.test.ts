import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { z } from 'zod'
import { zodToJsonSchema } from '../../src/lib/providers/schema-utils.js'

describe('zodToJsonSchema', () => {
  it('converts simple object schema', () => {
    const schema = z.object({
      name: z.string(),
      age: z.number(),
    })

    const json = zodToJsonSchema(schema)
    assert.equal(json.type, 'object')
    assert.ok(json.properties)
    const props = json.properties as Record<string, Record<string, unknown>>
    assert.equal(props.name.type, 'string')
    assert.equal(props.age.type, 'number')
  })

  it('marks required fields correctly', () => {
    const schema = z.object({
      required: z.string(),
      optional: z.string().optional(),
    })

    const json = zodToJsonSchema(schema)
    const required = json.required as string[]
    assert.ok(required.includes('required'))
    assert.ok(!required.includes('optional'))
  })

  it('handles defaults', () => {
    const schema = z.object({
      model: z.string().default('gpt-4o'),
    })

    const json = zodToJsonSchema(schema)
    const props = json.properties as Record<string, Record<string, unknown>>
    assert.equal(props.model.default, 'gpt-4o')
  })

  it('handles enums', () => {
    const schema = z.object({
      quality: z.enum(['low', 'medium', 'high']),
    })

    const json = zodToJsonSchema(schema)
    const props = json.properties as Record<string, Record<string, unknown>>
    assert.deepEqual(props.quality.enum, ['low', 'medium', 'high'])
  })

  it('handles number constraints', () => {
    const schema = z.object({
      count: z.number().int().min(1).max(100),
    })

    const json = zodToJsonSchema(schema)
    const props = json.properties as Record<string, Record<string, unknown>>
    assert.equal(props.count.type, 'integer')
    assert.equal(props.count.minimum, 1)
    assert.equal(props.count.maximum, 100)
  })

  it('handles string URL format', () => {
    const schema = z.object({
      url: z.string().url(),
    })

    const json = zodToJsonSchema(schema)
    const props = json.properties as Record<string, Record<string, unknown>>
    assert.equal(props.url.format, 'url')
  })
})
