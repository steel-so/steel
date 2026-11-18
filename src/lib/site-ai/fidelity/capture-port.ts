import type { AppError } from '@/src/errors/app-error'
import type { Result } from '@/src/lib/result'
import type { ReferenceCapture } from './types'

/**
 * What the blueprint pipeline needs from the capture step (front A builds
 * the real one, `captureReference`). The pipeline never imports the
 * browser code: the capture is injected, so it can be mocked in tests and
 * is simply absent when no worker is available.
 */
export interface CapturePort {
  capture(url: string): Promise<Result<ReferenceCapture, AppError>>
}

let registered: CapturePort | null = null

/** Registers the process-wide capture implementation (called once at
 * wiring time by whoever owns the capture job). */
export function registerCapturePort(port: CapturePort | null): void {
  registered = port
}

/** The registered capture, or `null` (the analysis then uses only the
 * user's images and the text summary of each link). */
export function getCapturePort(): CapturePort | null {
  return registered
}
