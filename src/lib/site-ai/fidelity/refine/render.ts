import { appError } from '@/src/errors/app-error'
import { err, type Result } from '@/src/lib/result'
import type { CaptureRedis } from '../capture/store'
import type { CapturePort } from '../capture-port'
import type { ReferenceCapture } from '../types'
import { type PreviewDraft, savePreviewDraft } from './preview-store'
import { createPreviewToken, previewPath } from './preview-token'

/**
 * Renders the draft: the documents are parked in Redis behind a signed,
 * short-lived token and the capture job (worker, Chromium) opens the app's
 * own preview page — desktop and mobile strips in the same
 * `ReferenceCapture` format as the references (ADR 0072).
 */

export const RENDER_FAILED_MESSAGE =
  'Não foi possível renderizar o rascunho do site.'

export interface DraftRendererDeps {
  redis: CaptureRedis
  /** Capture through the worker queue (the only place with a browser). */
  port: CapturePort
  /** Public origin of the app (`BETTER_AUTH_URL`). */
  publicOrigin: string
  secret: string
  now?: () => number
}

export function createDraftRenderer(deps: DraftRendererDeps) {
  return async function renderDraft(
    draft: PreviewDraft,
    pageIndex: number,
  ): Promise<Result<ReferenceCapture>> {
    try {
      const { token, id } = createPreviewToken(
        deps.secret,
        (deps.now ?? Date.now)(),
      )
      await savePreviewDraft(deps.redis, id, draft)
      const url = `${new URL(deps.publicOrigin).origin}${previewPath(token, pageIndex)}`
      return await deps.port.capture(url)
    } catch {
      return err(appError('INTERNAL_SERVER_ERROR', RENDER_FAILED_MESSAGE))
    }
  }
}
