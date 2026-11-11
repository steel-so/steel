import { randomBytes } from 'node:crypto'
import { sha256 } from '@/src/lib/crm-deals/snapshot'

/**
 * Hashes and tokens of CRM > Documentos (ADR 0063). Server only (node:crypto).
 */

/** JSON with object keys sorted at every level, so equal data hashes equal. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value ?? null)
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`
  }
  const record = value as Record<string, unknown>
  const keys = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
  const body = keys.map(
    (key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`,
  )
  return `{${body.join(',')}}`
}

/** SHA-256 (hex) of the canonical JSON of content + theme + settings. */
export function documentVersionHash(input: {
  content: unknown
  theme: unknown
  settings: unknown
}): string {
  return sha256(
    canonicalJson({
      content: input.content,
      theme: input.theme,
      settings: input.settings,
    }),
  )
}

/** Random 32-byte base64url token for `/d/<token>` links. */
export function newDocumentToken(): string {
  return randomBytes(32).toString('base64url')
}

/** IP hash stored with responses and used as the public rate-limit key. */
export function hashDocumentIp(ip: string): string {
  return sha256(ip)
}
