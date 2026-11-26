import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { badRequest } from '@/src/errors'
import { getAuthSession } from '@/src/lib/auth-session'
import { consume, uploadLimiter } from '@/src/lib/rate-limit'
import {
  baseContentType,
  needsAudioTranscode,
  transcodeToOggOpus,
} from '@/src/lib/whatsapp/audio-transcode'
import { persistOutboundMedia } from '@/src/lib/whatsapp/media'
import { assertModuleMember } from '@/src/services/authz'
import { handleError, successResponse } from '@/utils/http-response'

type Params = { params: Promise<{ id: string }> }

const MAX_BYTES = 16 * 1024 * 1024 // 16MB, matches WhatsApp's own media cap

export const POST = withAxiom(async (request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(uploadLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const { id } = await ctx.params

  const membership = await assertModuleMember(
    auth.value.user.id,
    id,
    'COMMUNICATION',
    {
      resource: 'conversations',
      action: 'CREATE',
    },
  )
  if (!membership.ok) return handleError(membership.error)

  const contentType = request.headers.get('content-type')
  if (!contentType) {
    return handleError(badRequest('Content-Type é obrigatório'))
  }

  const contentLength = Number(request.headers.get('content-length') ?? '0')
  if (contentLength > MAX_BYTES) {
    return handleError(badRequest('Arquivo muito grande. Máximo 16 MB'))
  }

  const body = Buffer.from(await request.arrayBuffer())
  if (body.byteLength === 0) {
    return handleError(badRequest('Arquivo vazio'))
  }
  if (body.byteLength > MAX_BYTES) {
    return handleError(badRequest('Arquivo muito grande. Máximo 16 MB'))
  }

  // Browser recordings (audio/webm) are refused by Meta: send Ogg/Opus.
  let outBody: Buffer = body
  // Without `; codecs=...`: the stored key extension and header stay clean.
  let outType = baseContentType(contentType)
  if (needsAudioTranscode(contentType)) {
    const converted = await transcodeToOggOpus(body)
    if (!converted.ok) return handleError(converted.error)
    outBody = converted.value
    outType = 'audio/ogg'
  }

  const stored = await persistOutboundMedia({
    workspaceId: id,
    body: outBody,
    contentType: outType,
  })
  if (!stored.ok) return handleError(stored.error)

  return successResponse(stored.value, 201)
})
