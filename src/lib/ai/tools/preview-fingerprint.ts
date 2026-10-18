import type { AiToolPreviewDTO } from '@/types/steel-ai'

/**
 * Fingerprint of what the human approves on a write: the preview's title,
 * summary, before → after lines and target. A pending action stores the
 * preview it showed; on confirm the runtime builds the preview again from
 * the current records and compares both fingerprints. Different means the
 * record (or a record the plan resolves: stage, phase, contact…) changed
 * after the preview, so executing would apply something nobody saw.
 *
 * The comparison is on the shown content, not on `updatedAt`: a change the
 * preview does not depend on (an SLA tick, a new chat message) must not
 * block a confirmation, and every write tool already renders the values it
 * is about to overwrite as `before`.
 */

/** Normalized string, or null for absent/empty values (JSONB drops undefined). */
function text(value: unknown): string | null {
  if (value === undefined || value === null) return null
  return String(value)
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : {}
}

/**
 * Canonical form of a preview: fixed key order, `undefined` ≡ `null`, extra
 * keys ignored. Accepts the raw JSON stored on the row (`unknown`), so a
 * malformed or legacy preview still yields a comparable value.
 */
export function previewFingerprint(
  preview: AiToolPreviewDTO | unknown,
): string {
  const p = record(preview)
  const fields = Array.isArray(p.fields) ? p.fields : []
  const target = p.target === undefined || p.target === null ? null : p.target
  const t = record(target)
  return JSON.stringify([
    text(p.title),
    text(p.summary),
    fields.map((field) => {
      const f = record(field)
      return [text(f.label), text(f.before), text(f.after)]
    }),
    target === null
      ? null
      : [text(t.type), text(t.id), text(t.label), text(t.href)],
  ])
}

/** Whether two previews show the same thing to the human. */
export function samePreview(stored: unknown, fresh: AiToolPreviewDTO): boolean {
  return previewFingerprint(stored) === previewFingerprint(fresh)
}
