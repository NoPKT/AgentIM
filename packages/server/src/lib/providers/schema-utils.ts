import type { ZodType } from 'zod'

/**
 * Convert a Zod schema to a simplified JSON-like description for the frontend.
 * This is a lightweight serializer — not a full JSON Schema implementation.
 */
export function zodToJsonSchema(schema: ZodType): Record<string, unknown> {
  try {
    // Use Zod's built-in description if available
    const def = (schema as unknown as { _def?: Record<string, unknown> })._def
    if (!def) return { type: 'object' }

    return walkZodDef(def)
  } catch {
    return { type: 'object' }
  }
}

function walkZodDef(def: Record<string, unknown>): Record<string, unknown> {
  const typeName = def.typeName as string

  switch (typeName) {
    case 'ZodObject': {
      const shape = def.shape as
        | (() => Record<string, { _def: Record<string, unknown> }>)
        | undefined
      if (!shape) return { type: 'object' }

      const shapeObj = typeof shape === 'function' ? shape() : shape
      const properties: Record<string, unknown> = {}
      const required: string[] = []

      for (const [key, field] of Object.entries(shapeObj)) {
        const fieldDef = field._def
        const isOptional = fieldDef.typeName === 'ZodOptional' || fieldDef.typeName === 'ZodDefault'
        properties[key] = walkZodDef(fieldDef)
        if (!isOptional) required.push(key)
      }

      return { type: 'object', properties, required }
    }

    case 'ZodString': {
      const result: Record<string, unknown> = { type: 'string' }
      const checks = def.checks as Array<{ kind: string; value?: unknown }> | undefined
      if (checks) {
        for (const check of checks) {
          if (check.kind === 'min') result.minLength = check.value
          if (check.kind === 'max') result.maxLength = check.value
          if (check.kind === 'url') result.format = 'url'
        }
      }
      return result
    }

    case 'ZodNumber': {
      const result: Record<string, unknown> = { type: 'number' }
      const checks = def.checks as Array<{ kind: string; value?: unknown }> | undefined
      if (checks) {
        for (const check of checks) {
          if (check.kind === 'min') result.minimum = check.value
          if (check.kind === 'max') result.maximum = check.value
          if (check.kind === 'int') result.type = 'integer'
        }
      }
      return result
    }

    case 'ZodEnum': {
      const values = def.values as string[]
      return { type: 'string', enum: values }
    }

    case 'ZodDefault': {
      const innerType = def.innerType as { _def: Record<string, unknown> } | undefined
      if (!innerType) return {}
      const inner = walkZodDef(innerType._def)
      const defaultValue =
        typeof def.defaultValue === 'function'
          ? (def.defaultValue as () => unknown)()
          : def.defaultValue
      return { ...inner, default: defaultValue }
    }

    case 'ZodOptional': {
      const innerType = def.innerType as { _def: Record<string, unknown> } | undefined
      if (!innerType) return {}
      return walkZodDef(innerType._def)
    }

    case 'ZodBoolean':
      return { type: 'boolean' }

    case 'ZodArray': {
      const itemType = def.type as { _def: Record<string, unknown> } | undefined
      return {
        type: 'array',
        items: itemType ? walkZodDef(itemType._def) : {},
      }
    }

    default:
      return { type: 'string' }
  }
}
