import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { badRequest } from '@/src/errors'
import { getAuthSession } from '@/src/lib/auth-session'
import { consume, uploadLimiter } from '@/src/lib/rate-limit'
import { CrmEmailBuilderService } from '@/src/services/crm-email-builder.service'
import { handleError, successResponse } from '@/utils/http-response'

type Params = { params: Promise<{ id: string }> }

const MAX_BYTES = 5 * 1024 * 1024 // 5MB, matches validateImage's own cap

/** Images already uploaded to the workspace's e-mail/document builders. */
export const GET = withAxiom(async (_request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const { id } = await ctx.params
  const listed = await CrmEmailBuilderService.listImages(auth.value.user.id, id)
  if (!listed.ok) return handleError(listed.error)

  return successResponse(listed.value)
})

/** Image upload of the visual e-mail builder (raw body, image/*). */
export const POST = withAxiom(async (request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(uploadLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const { id } = await ctx.params

  const contentType = request.headers.get('content-type')
  if (!contentType) {
    return handleError(badRequest('Content-Type é obrigatório'))
  }

  const contentLength = Number(request.headers.get('content-length') ?? '0')
  if (contentLength > MAX_BYTES) {
    return handleError(badRequest('Arquivo muito grande. Máximo 5 MB'))
  }

  const stored = await CrmEmailBuilderService.uploadImage(
    auth.value.user.id,
    id,
    {
      contentType,
      byteSize: contentLength,
      readBody: async () => Buffer.from(await request.arrayBuffer()),
    },
  )
  if (!stored.ok) return handleError(stored.error)

  return successResponse(stored.value, 201)
})
