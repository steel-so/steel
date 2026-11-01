import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { crmSocialNotConfigured } from '@/src/errors'
import { getAuthSession } from '@/src/lib/auth-session'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import { parseCrmPlatformSlug } from '@/src/schemas/crm-social.schema'
import * as CrmSocialFacebookService from '@/src/services/crm-social-facebook.service'
import * as CrmSocialGoogleAdsService from '@/src/services/crm-social-google-ads.service'
import * as CrmSocialGoogleAnalyticsService from '@/src/services/crm-social-google-analytics.service'
import * as CrmSocialInstagramService from '@/src/services/crm-social-instagram.service'
import * as CrmSocialTiktokService from '@/src/services/crm-social-tiktok.service'
import * as CrmSocialYoutubeService from '@/src/services/crm-social-youtube.service'
import {
  handleError,
  standardError,
  successResponse,
} from '@/utils/http-response'

type Params = { params: Promise<{ id: string; platform: string }> }

/** Visão da conta conectada (formato específico por plataforma). */
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
      const result = await CrmSocialFacebookService.getOverview(
        actorId,
        id,
        connectionId,
      )
      if (!result.ok) return handleError(result.error)
      return successResponse(result.value)
    }
    case 'INSTAGRAM': {
      const result = await CrmSocialInstagramService.getOverview(
        actorId,
        id,
        connectionId,
      )
      if (!result.ok) return handleError(result.error)
      return successResponse(result.value)
    }
    case 'YOUTUBE': {
      const result = await CrmSocialYoutubeService.getOverview(actorId, id)
      if (!result.ok) return handleError(result.error)
      return successResponse(result.value)
    }
    case 'GOOGLE_ANALYTICS': {
      const result = await CrmSocialGoogleAnalyticsService.getOverview(
        actorId,
        id,
      )
      if (!result.ok) return handleError(result.error)
      return successResponse(result.value)
    }
    case 'GOOGLE_ADS': {
      const result = await CrmSocialGoogleAdsService.getOverview(actorId, id)
      if (!result.ok) return handleError(result.error)
      return successResponse(result.value)
    }
    case 'TIKTOK': {
      const result = await CrmSocialTiktokService.getOverview(actorId, id)
      if (!result.ok) return handleError(result.error)
      return successResponse(result.value)
    }
    default:
      return handleError(crmSocialNotConfigured())
  }
})
