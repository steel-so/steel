import { CrmScheduledPostOptionsSchema } from '@/src/schemas/crm-social.schema'
import type { CrmSocialPlatformDTO } from '@/types/crm-social'
import * as CrmSocialFacebookService from './crm-social-facebook.service'
import * as CrmSocialInstagramService from './crm-social-instagram.service'
import * as CrmSocialTiktokService from './crm-social-tiktok.service'
import * as CrmSocialYoutubeService from './crm-social-youtube.service'

export type CrmSocialPublishResult =
  | { ok: true; externalPostId: string }
  | { ok: false; error: string }

export type CrmSocialPublishMedia = {
  bytes: ArrayBuffer
  contentType: string
}

/** Contexto de UM alvo — mídia já carregada do storage pelo scheduler. */
export type CrmSocialPublishContext = {
  actorId: string
  workspaceId: string
  content: string
  title: string | null
  options: unknown
  image: CrmSocialPublishMedia | null
  video: CrmSocialPublishMedia | null
}

/**
 * Publica UM alvo na plataforma, escolhendo o service certo. Facebook
 * aceita mídia opcional (imagem); Instagram/TikTok/YouTube exigem
 * mídia (imagem ou vídeo conforme o caso) — retornam erro com "exige mídia"
 * quando ausente, sem sequer tentar a chamada real à plataforma.
 */
export async function publishToSocialPlatform(
  platform: CrmSocialPlatformDTO,
  ctx: CrmSocialPublishContext,
): Promise<CrmSocialPublishResult> {
  const parsedOptions = CrmScheduledPostOptionsSchema.safeParse(
    ctx.options ?? {},
  )
  const options = parsedOptions.success ? parsedOptions.data : undefined

  switch (platform) {
    case 'FACEBOOK': {
      const media = ctx.video
        ? { ...ctx.video, kind: 'VIDEO' as const }
        : ctx.image
          ? { ...ctx.image, kind: 'IMAGE' as const }
          : null
      const result = await CrmSocialFacebookService.publishPost(
        ctx.actorId,
        ctx.workspaceId,
        { message: ctx.content, link: options?.facebook?.link ?? null },
        media,
      )
      if (!result.ok) return { ok: false, error: result.error.message }
      return { ok: true, externalPostId: result.value.postId }
    }
    case 'INSTAGRAM': {
      const postType = options?.instagram?.postType ?? 'FEED'
      const media =
        postType === 'REELS'
          ? ctx.video
            ? { ...ctx.video, kind: 'VIDEO' as const }
            : null
          : postType === 'STORIES'
            ? ctx.image
              ? { ...ctx.image, kind: 'IMAGE' as const }
              : ctx.video
                ? { ...ctx.video, kind: 'VIDEO' as const }
                : null
            : ctx.image
              ? { ...ctx.image, kind: 'IMAGE' as const }
              : null
      if (!media) {
        return {
          ok: false,
          error: `INSTAGRAM exige mídia (${postType === 'REELS' ? 'vídeo' : postType === 'STORIES' ? 'imagem ou vídeo' : 'imagem'}) para publicar.`,
        }
      }
      const result = await CrmSocialInstagramService.publishPost(
        ctx.actorId,
        ctx.workspaceId,
        { caption: ctx.content, postType },
        media,
      )
      if (!result.ok) return { ok: false, error: result.error.message }
      return { ok: true, externalPostId: result.value.postId }
    }
    case 'TIKTOK': {
      if (!ctx.video) {
        return { ok: false, error: 'TIKTOK exige mídia (vídeo) para publicar.' }
      }
      const result = await CrmSocialTiktokService.publishVideo(
        ctx.actorId,
        ctx.workspaceId,
        {
          title: ctx.title ?? ctx.content,
          privacyLevel: options?.tiktok?.privacy ?? 'SELF_ONLY',
          disableComment: options?.tiktok?.disableComment ?? false,
          disableDuet: options?.tiktok?.disableDuet ?? false,
          disableStitch: options?.tiktok?.disableStitch ?? false,
        },
        ctx.video,
      )
      if (!result.ok) return { ok: false, error: result.error.message }
      return { ok: true, externalPostId: result.value.publishId }
    }
    case 'YOUTUBE': {
      if (!ctx.video) {
        return {
          ok: false,
          error: 'YOUTUBE exige mídia (vídeo) para publicar.',
        }
      }
      const result = await CrmSocialYoutubeService.publishVideo(
        ctx.actorId,
        ctx.workspaceId,
        {
          title: ctx.title ?? (ctx.content.slice(0, 100) || 'Sem título'),
          description: ctx.content,
          privacyStatus: options?.youtube?.privacy ?? 'public',
          tags: options?.youtube?.tags ?? [],
        },
        ctx.video,
      )
      if (!result.ok) return { ok: false, error: result.error.message }
      return { ok: true, externalPostId: result.value.videoId }
    }
    default:
      return {
        ok: false,
        error: `Publicação agendada não suportada para ${platform}.`,
      }
  }
}
