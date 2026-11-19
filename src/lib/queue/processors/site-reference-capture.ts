import type { Job } from 'bullmq'
import { logger } from '@/lib/axiom/logger'
import {
  BETTER_AUTH_SECRET,
  BETTER_AUTH_URL,
  STATUS_APP_PROBE_URL,
} from '@/lib/env/server'
import { stripUrlForDisplay } from '@/src/lib/safe-fetch/fetch-html'
import { captureReference } from '@/src/lib/site-ai/fidelity/capture/capture-reference'
import { saveCapture } from '@/src/lib/site-ai/fidelity/capture/store'
import { resolveInternalPreview } from '@/src/lib/site-ai/fidelity/refine/preview-token'
import { getQueueConnection } from '../connection'
import {
  SiteReferenceCaptureJob,
  type SiteReferenceCaptureJobPayload,
} from '../jobs'

/**
 * `site-reference-capture` queue (docs/site-ai-fidelity.md): captures one
 * reference page with Chromium and keeps the result in Redis for 15 minutes
 * (never on disk or S3). Failures are stored too, so the waiting app gets
 * the pt-BR reason at once instead of timing out.
 */

export async function handleSiteReferenceCaptureJob(
  job: Job,
): Promise<{ requestId: string; ok: boolean }> {
  if (job.name !== SiteReferenceCaptureJob.Capture) {
    throw new Error(
      `Unknown site-reference-capture job: ${job.name} (id=${job.id ?? 'unknown'})`,
    )
  }
  const { workspaceId, url, requestId } =
    job.data as SiteReferenceCaptureJobPayload['capture']

  // The refinement's draft previews (ADR 0072) are served by the app
  // itself: a signed, unexpired preview URL is opened through the worker's
  // own address for the app; anything else keeps the strict external policy.
  const preview = resolveInternalPreview(url, {
    publicOrigin: BETTER_AUTH_URL,
    internalOrigin: STATUS_APP_PROBE_URL ?? BETTER_AUTH_URL,
    secret: BETTER_AUTH_SECRET,
  })
  const result = preview
    ? await captureReference(preview.url, { internalOrigin: preview.origin })
    : await captureReference(url)
  await saveCapture(getQueueConnection(), requestId, result)

  if (result.ok) {
    logger.info('queue.site_reference_capture.done', {
      component: 'Worker',
      workspaceId,
      requestId,
      url: preview ? '[site-preview]' : stripUrlForDisplay(url),
      desktopStrips: result.value.desktop.strips.length,
      mobileStrips: result.value.mobile.strips.length,
    })
  } else {
    logger.warn('queue.site_reference_capture.failed', {
      component: 'Worker',
      workspaceId,
      requestId,
      url: preview ? '[site-preview]' : stripUrlForDisplay(url),
      code: result.error.code,
    })
  }
  return { requestId, ok: result.ok }
}

export async function processSiteReferenceCapture(
  job: Job,
): Promise<{ requestId: string; ok: boolean }> {
  return handleSiteReferenceCaptureJob(job)
}
