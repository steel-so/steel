import { type AppError, appError } from '@/src/errors/app-error'
import type { ErrorCode } from '@/src/errors/codes'
import { err, ok, type Result } from '@/src/lib/result'
import type { ReferenceCapture } from '../types'

/**
 * Captures live only in Redis (15 min TTL), never on disk or S3: the strips
 * are screenshots of third-party pages.
 */

export const CAPTURE_TTL_SECONDS = 15 * 60

export const captureKey = (requestId: string) => `site-ai:capture:${requestId}`

/** The subset of ioredis used here (injectable in tests). */
export interface CaptureRedis {
  set(key: string, value: string, mode: 'EX', seconds: number): Promise<unknown>
  get(key: string): Promise<string | null>
}

type Stored =
  | { ok: true; value: ReferenceCapture }
  | { ok: false; error: { code: string; message: string } }

export async function saveCapture(
  redis: CaptureRedis,
  requestId: string,
  result: Result<ReferenceCapture>,
): Promise<void> {
  const stored: Stored = result.ok
    ? { ok: true, value: result.value }
    : {
        ok: false,
        error: { code: result.error.code, message: result.error.message },
      }
  await redis.set(
    captureKey(requestId),
    JSON.stringify(stored),
    'EX',
    CAPTURE_TTL_SECONDS,
  )
}

/** null while the job has not stored anything yet. */
export async function loadCapture(
  redis: CaptureRedis,
  requestId: string,
): Promise<Result<ReferenceCapture> | null> {
  const raw = await redis.get(captureKey(requestId))
  if (raw === null) return null
  let stored: Stored
  try {
    stored = JSON.parse(raw) as Stored
  } catch {
    return err(corrupted())
  }
  if (stored.ok) return ok(stored.value)
  return err(appError(stored.error.code as ErrorCode, stored.error.message))
}

function corrupted(): AppError {
  return appError(
    'INTERNAL_SERVER_ERROR',
    'Não foi possível ler a captura da referência.',
  )
}
