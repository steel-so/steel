import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { crmSocialNotConfigured } from '@/src/errors'
import { getAuthSession } from '@/src/lib/auth-session'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import { parseCrmPlatformSlug } from '@/src/schemas/crm-social.schema'
import * as CrmSocialFacebookService from '@/src/services/crm-social-facebook.service'
import * as CrmSocialInstagramService from '@/src/services/crm-social-instagram.service'
import * as CrmSocialTiktokService from '@/src/services/crm-social-tiktok.service'
import * as CrmSocialYoutubeService from '@/src/services/crm-social-youtube.service'
import {
  handleError,
  standardError,
  successResponse,
} from '@/utils/http-response'

type Params = { params: Promise<{ id: string; platform: string }> }

/**
 * Conteúdo recente da conta. Cada plataforma mapeia para uma fonte diferente:
 * - FACEBOOK   → Graph API (/{id}/posts)
 * - INSTAGRAM  → Graph API (/{id}/media)
 * - YOUTUBE    → Data API (playlistItems da playlist de uploads)
 * - TIKTOK     → Display API (video/list)
 */
export const GET = withAxiom(async (request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const { id, platform: platformSlug } = await ctx.params
  const platform = parseCrmPlatformSlug(platformSlug)
  if (!platform) {
    return standardError('VALIDATION_ERROR', 'Plataforma inválida')
  }

  const actorId = auth.value.user.id
  const connectionId =
    request.nextUrl.searchParams.get('connectionId') ?? undefined

  switch (platform) {
    case 'FACEBOOK': {
      const result = await CrmSocialFacebookService.getRecentPosts(
        actorId,
        id,
        connectionId,
      )
      if (!result.ok) return handleError(result.error)
      return successResponse(result.value)
    }
    case 'INSTAGRAM': {
      const result = await CrmSocialInstagramService.getRecentMedia(
        actorId,
        id,
        connectionId,
      )
      if (!result.ok) return handleError(result.error)
      return successResponse(result.value)
    }
    case 'YOUTUBE': {
      const result = await CrmSocialYoutubeService.getRecentVideos(actorId, id)
      if (!result.ok) return handleError(result.error)
      return successResponse(result.value)
    }
    case 'TIKTOK': {
      const result = await CrmSocialTiktokService.getVideos(actorId, id)
      if (!result.ok) return handleError(result.error)
      return successResponse(result.value)
    }
    default:
      return handleError(crmSocialNotConfigured())
  }
})
