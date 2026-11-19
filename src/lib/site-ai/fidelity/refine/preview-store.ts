import type { CanvasDocument } from '@/src/lib/canvas/types'
import type { CaptureRedis } from '../capture/store'
import { PREVIEW_TOKEN_TTL_SECONDS } from './preview-token'

/**
 * A draft site waiting to be rendered by the capture browser: kept in
 * Redis for a few minutes (never in the database), read by the preview
 * page behind a signed token.
 */

export interface PreviewDraft {
  /** `SiteTheme` as stored in the site row. */
  theme: unknown
  header: CanvasDocument | null
  footer: CanvasDocument | null
  /** Page documents in plan order. */
  pages: Array<{ title: string; document: CanvasDocument }>
}

export const previewKey = (id: string) => `site-ai:preview:${id}`

export async function savePreviewDraft(
  redis: CaptureRedis,
  id: string,
  draft: PreviewDraft,
): Promise<void> {
  await redis.set(
    previewKey(id),
    JSON.stringify(draft),
    'EX',
    PREVIEW_TOKEN_TTL_SECONDS,
  )
}

export async function loadPreviewDraft(
  redis: CaptureRedis,
  id: string,
): Promise<PreviewDraft | null> {
  const raw = await redis.get(previewKey(id))
  if (raw === null) return null
  try {
    const value = JSON.parse(raw) as PreviewDraft
    return Array.isArray(value.pages) ? value : null
  } catch {
    return null
  }
}
