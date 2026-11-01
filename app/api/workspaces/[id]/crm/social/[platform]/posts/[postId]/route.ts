import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { badRequest, crmSocialNotConfigured } from '@/src/errors'
import { getAuthSession } from '@/src/lib/auth-session'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import { parseCrmPlatformSlug } from '@/src/schemas/crm-social.schema'
import * as CrmSocialFacebookService from '@/src/services/crm-social-facebook.service'
import * as CrmSocialInstagramService from '@/src/services/crm-social-instagram.service'
import * as CrmSocialYoutubeService from '@/src/services/crm-social-youtube.service'
import { handleError, successResponse } from '@/utils/http-response'

type Params = {
  params: Promise<{ id: string; platform: string; postId: string }>
}

/**
 * Exclui uma publicação já feita na plataforma. `postId` é o identificador
 * devolvido no publish (id do post/mídia/vídeo).
 *
 * TIKTOK fica fora: a Content Posting API não expõe endpoint de exclusão —
 * só é possível apagar pelo próprio app do TikTok.
 */
export const DELETE = withAxiom(async (request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const { id, platform: platformSlug, postId } = await ctx.params
  const platform = parseCrmPlatformSlug(platformSlug)
  if (!platform) {
    return handleError(badRequest('Plataforma inválida'))
  }

  const actorId = auth.value.user.id
  const connectionId =
    request.nextUrl.searchParams.get('connectionId') ?? undefined

  switch (platform) {
    case 'FACEBOOK': {
      const result = await CrmSocialFacebookService.deletePost(
        actorId,
        id,
        postId,
        connectionId,
      )
      if (!result.ok) return handleError(result.error)
      return successResponse(result.value)
    }
    case 'INSTAGRAM': {
      const result = await CrmSocialInstagramService.deleteMedia(
        actorId,
        id,
        postId,
        connectionId,
      )
      if (!result.ok) return handleError(result.error)
      return successResponse(result.value)
    }
    case 'YOUTUBE': {
      const result = await CrmSocialYoutubeService.deleteVideo(
        actorId,
        id,
        postId,
      )
      if (!result.ok) return handleError(result.error)
      return successResponse(result.value)
    }
    case 'TIKTOK':
      return handleError(
        badRequest(
          'O TikTok não permite excluir publicações pela API — exclua diretamente no app do TikTok.',
        ),
      )
    default:
      return handleError(crmSocialNotConfigured())
  }
})
