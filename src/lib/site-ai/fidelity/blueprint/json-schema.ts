import { z } from 'zod'

/**
 * JSON Schema for structured outputs, derived from the Zod schema so the
 * two never drift. Providers run it in strict mode: every object lists all
 * its keys as required (optional values are `nullable()` in the Zod
 * schema) and closes `additionalProperties`; keywords the providers reject
 * (ranges, lengths, patterns, formats) are removed — the compiler clamps
 * numbers and the callers' `validate` checks the rest.
 */

const DROPPED_KEYWORDS = new Set([
  '$schema',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'minLength',
  'maxLength',
  'pattern',
  'format',
  'minItems',
  'maxItems',
  'uniqueItems',
  'default',
  'title',
  'id',
])

type Json = Record<string, unknown>

function clean(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(clean)
  if (typeof node !== 'object' || node === null) return node
  const source = node as Json
  const out: Json = {}
  for (const [key, value] of Object.entries(source)) {
    // The `properties` map holds field names (a field may be called
    // `title` or `format`): only its values are schemas to clean.
    if (key === 'properties' && typeof value === 'object' && value !== null) {
      out.properties = Object.fromEntries(
        Object.entries(value).map(([name, schema]) => [name, clean(schema)]),
      )
      continue
    }
    if (DROPPED_KEYWORDS.has(key)) continue
    if (key === 'oneOf') {
      out.anyOf = clean(value)
      continue
    }
    if (key === 'const') {
      out.enum = [value]
      continue
    }
    out[key] = clean(value)
  }
  const properties = out.properties
  if (typeof properties === 'object' && properties !== null) {
    out.required = Object.keys(properties)
    out.additionalProperties = false
  }
  return out
}

export function strictJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const raw = z.toJSONSchema(schema, { target: 'draft-7' }) as Json
  return clean(raw) as Record<string, unknown>
}
