import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { getAuthSession } from '@/src/lib/auth-session'
import { requireConsent } from '@/src/lib/consent'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import { sdConfigRoute } from '@/src/lib/servicedesk/config-route'
import { GoogleDeletePhotoSchema } from '@/src/schemas/crm-google-presence.schema'
import { CrmGoogleProfileService } from '@/src/services/crm-google-profile.service'
import {
  handleError,
  standardError,
  successResponse,
} from '@/utils/http-response'

type Params = { params: Promise<{ id: string }> }

export const GET = sdConfigRoute({
  handler: ({ userId, params }) =>
    CrmGoogleProfileService.listPhotos(userId, params.id),
})

/** Multipart upload: `file` (JPG/PNG) and `category`. */
export const POST = withAxiom(async (request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)
  const userId = auth.value.user.id

  const limit = await consume(apiLimiter, `user:${userId}`)
  if (!limit.ok) return handleError(limit.error)

  const consent = await requireConsent(
    userId,
    'POST /api/workspaces/[id]/crm/google/profile/photos',
  )
  if (!consent.ok) return handleError(consent.error)

  const form = await request.formData().catch(() => null)
  const file = form?.get('file')
  if (!form || !(file instanceof File)) {
    return standardError('VALIDATION_ERROR', 'Envie uma foto')
  }
  const category = form.get('category')

  const { id } = await ctx.params
  const result = await CrmGoogleProfileService.addPhoto(
    userId,
    id,
    { bytes: await file.arrayBuffer(), contentType: file.type },
    typeof category === 'string' ? category : 'ADDITIONAL',
  )
  if (!result.ok) return handleError(result.error)
  return successResponse(null, 201)
})

export const DELETE = sdConfigRoute({
  consent: 'DELETE /api/workspaces/[id]/crm/google/profile/photos',
  body: GoogleDeletePhotoSchema,
  handler: ({ userId, params, body }) =>
    CrmGoogleProfileService.deletePhoto(userId, params.id, body.name),
})
