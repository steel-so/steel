import { err } from '@/src/lib/result'
import type { CapturePort } from '../capture-port'
import { awaitCapture, requestCapture } from './request'

/** Longest wait for one reference: the worker queue plus the 45 s capture. */
export const QUEUE_CAPTURE_WAIT_MS = 150_000

/**
 * The capture as the app uses it: the job runs in the worker (the only
 * place that launches Chromium) and the result comes back through Redis.
 */
export function queueCapturePort(workspaceId: string): CapturePort {
  return {
    async capture(url) {
      const requested = await requestCapture(workspaceId, url)
      if (!requested.ok) return err(requested.error)
      return awaitCapture(requested.value.requestId, QUEUE_CAPTURE_WAIT_MS)
    },
  }
}
