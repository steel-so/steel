import type { NextRequest } from 'next/server'
import { logger } from '@/lib/axiom/logger'
import { withAxiom } from '@/lib/axiom/server'
import { storageError } from '@/src/errors'
import { getAuthSession } from '@/src/lib/auth-session'
import { PHONE_CALL_RECORDINGS_BUCKET } from '@/src/lib/pabx/recording'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import { getObjectRangeStream } from '@/src/lib/storage/s3'
import { PhoneCallService } from '@/src/services/phone-call.service'
import { PhoneCallRecordingService } from '@/src/services/phone-call-recording.service'
import { handleError, successResponse } from '@/utils/http-response'

type Params = { params: Promise<{ id: string; callId: string }> }

/** Only a single `bytes=start-end` range is passed to the store. */
const RANGE = /^bytes=\d*-\d*$/

/**
 * The call audio for the `<audio>` player, streamed from the private bucket
 * with `Range` support (seeking). Same visibility as the call lists.
 */
export const GET = withAxiom(async (request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const { id, callId } = await ctx.params
  const recording = await PhoneCallService.recordingFor(
    auth.value.user.id,
    id,
    callId,
  )
  if (!recording.ok) return handleError(recording.error)

  const header = request.headers.get('range')
  const range = header && RANGE.test(header) ? header : undefined
  try {
    const object = await getObjectRangeStream({
      bucket: PHONE_CALL_RECORDINGS_BUCKET,
      key: recording.value.key,
      range,
    })
    const headers = new Headers({
      'Content-Type': recording.value.mimeType,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, no-store',
      'Content-Disposition': 'inline',
    })
    if (object.contentLength !== undefined)
      headers.set('Content-Length', String(object.contentLength))
    if (range && object.contentRange)
      headers.set('Content-Range', object.contentRange)
    return new Response(object.body, {
      status: range && object.contentRange ? 206 : 200,
      headers,
    })
  } catch (cause) {
    logger.error('phone_call.recording_read_failed', {
      component: 'PhoneCallRecordingRoute',
      workspaceId: id,
      callId,
      message: cause instanceof Error ? cause.message : String(cause),
    })
    return handleError(storageError('Falha ao ler a gravação'))
  }
})

/** Deletes the audio now (LGPD); transcript and summary stay. Admins. */
export const DELETE = withAxiom(async (_request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const { id, callId } = await ctx.params
  const result = await PhoneCallRecordingService.deleteRecording(
    auth.value.user.id,
    id,
    callId,
  )
  if (!result.ok) return handleError(result.error)

  return successResponse({ deleted: true })
})
