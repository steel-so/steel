import { randomUUID } from 'node:crypto'
import { appError, badRequest } from '@/src/errors/app-error'
import { getQueueConnection } from '@/src/lib/queue/connection'
import { SiteReferenceCaptureJob } from '@/src/lib/queue/jobs'
import { getSiteReferenceCaptureQueue } from '@/src/lib/queue/queues'
import { err, ok, type Result } from '@/src/lib/result'
import { SAFE_FETCH_MESSAGES } from '@/src/lib/safe-fetch/fetch-html'
import type { ReferenceCapture } from '../types'
import { type CaptureRedis, loadCapture } from './store'

/**
 * App side of the reference capture: the app never launches Chromium, it
 * queues the job (worker) and polls Redis for the result.
 */

export const CAPTURE_POLL_INTERVAL_MS = 500
export const CAPTURE_WAIT_TIMEOUT_MESSAGE =
  'A captura da referência demorou demais. Tente de novo em instantes.'

export async function requestCapture(
  workspaceId: string,
  url: string,
): Promise<Result<{ requestId: string }>> {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return err(badRequest(SAFE_FETCH_MESSAGES.invalid_url))
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return err(badRequest(SAFE_FETCH_MESSAGES.bad_scheme))
  }
  const requestId = randomUUID()
  try {
    await getSiteReferenceCaptureQueue().add(
      SiteReferenceCaptureJob.Capture,
      { workspaceId, url: parsed.toString(), requestId },
      { jobId: `site-reference-capture-${requestId}` },
    )
  } catch {
    return err(
      appError(
        'INTERNAL_SERVER_ERROR',
        'Não foi possível iniciar a captura da referência.',
      ),
    )
  }
  return ok({ requestId })
}

export interface AwaitCaptureOptions {
  redis?: CaptureRedis
  pollIntervalMs?: number
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

/** Polls Redis until the worker stores the result or `timeoutMs` passes. */
export async function awaitCapture(
  requestId: string,
  timeoutMs: number,
  options: AwaitCaptureOptions = {},
): Promise<Result<ReferenceCapture>> {
  const redis = options.redis ?? getQueueConnection()
  const now = options.now ?? Date.now
  const sleep =
    options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)))
  const interval = options.pollIntervalMs ?? CAPTURE_POLL_INTERVAL_MS
  const deadline = now() + timeoutMs

  for (;;) {
    try {
      const found = await loadCapture(redis, requestId)
      if (found) return found
    } catch {
      return err(
        appError(
          'INTERNAL_SERVER_ERROR',
          'Não foi possível ler a captura da referência.',
        ),
      )
    }
    if (now() >= deadline) {
      return err(
        appError('INTERNAL_SERVER_ERROR', CAPTURE_WAIT_TIMEOUT_MESSAGE),
      )
    }
    await sleep(interval)
  }
}
