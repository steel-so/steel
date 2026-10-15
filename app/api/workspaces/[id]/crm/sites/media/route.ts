import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { badRequest, validationError } from '@/src/errors'
import { getAuthSession } from '@/src/lib/auth-session'
import { requireConsent } from '@/src/lib/consent'
import { consume, uploadLimiter } from '@/src/lib/rate-limit'
import { err } from '@/src/lib/result'
import { RemoveSiteMediaSchema } from '@/src/schemas/site-studio.schema'
import { SiteMediaService } from '@/src/services/site-media.service'
import { handleError, successResponse } from '@/utils/http-response'
import { siteRoute } from '../_lib/handler'

type Params = { id: string }

const MAX_BYTES = 5 * 1024 * 1024 // 5MB, matches validateImage's own cap

/** Images of the workspace's site media library, newest first. */
export const GET = siteRoute<Params>({}, ({ userId, params }) =>
  SiteMediaService.list(userId, params.id),
)

/** Uploads one image (raw body, JPEG/PNG/WebP up to 5 MB). */
export const POST = withAxiom(
  async (request: NextRequest, ctx: { params: Promise<Params> }) => {
    const auth = await getAuthSession()
    if (!auth.ok) return handleError(auth.error)
    const userId = auth.value.user.id

    const limit = await consume(uploadLimiter, `user:${userId}`)
    if (!limit.ok) return handleError(limit.error)

    const consent = await requireConsent(
      userId,
      'POST /api/workspaces/[id]/crm/sites/media',
    )
    if (!consent.ok) return handleError(consent.error)

    const contentType = request.headers.get('content-type')
    if (!contentType) {
      return handleError(badRequest('Content-Type é obrigatório'))
    }
    const contentLength = Number(request.headers.get('content-length') ?? '0')
    if (contentLength > MAX_BYTES) {
      return handleError(badRequest('Arquivo muito grande. Máximo 5 MB'))
    }

    const { id } = await ctx.params
    const stored = await SiteMediaService.upload(userId, id, {
      contentType,
      byteSize: contentLength,
      readBody: async () => Buffer.from(await request.arrayBuffer()),
    })
    if (!stored.ok) return handleError(stored.error)
    return successResponse(stored.value, 201)
  },
)

/** Deletes an uploaded image (`?id=<file name>`). */
export const DELETE = siteRoute<Params>(
  { consent: '/api/workspaces/[id]/crm/sites/media' },
  async ({ userId, params, request }) => {
    const query = RemoveSiteMediaSchema.safeParse({
      id: request.nextUrl.searchParams.get('id'),
    })
    if (!query.success) return err(validationError('Imagem inválida'))
    return SiteMediaService.remove(userId, params.id, query.data.id)
  },
)
