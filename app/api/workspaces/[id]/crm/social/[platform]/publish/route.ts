import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { withAxiom } from '@/lib/axiom/server'
import { badRequest, crmSocialNotConfigured } from '@/src/errors'
import { getAuthSession } from '@/src/lib/auth-session'
import { CrmSocialPublishJob } from '@/src/lib/queue/jobs'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import { parseCrmPlatformSlug } from '@/src/schemas/crm-social.schema'
import { CrmPublishFacebookPostSchema } from '@/src/schemas/crm-social-facebook.schema'
import { CrmPublishInstagramPostSchema } from '@/src/schemas/crm-social-instagram.schema'
import { CrmPublishTiktokVideoSchema } from '@/src/schemas/crm-social-tiktok.schema'
import { CrmSocialYoutubePublishVideoSchema } from '@/src/schemas/crm-social-youtube.schema'
import * as CrmSocialFacebookService from '@/src/services/crm-social-facebook.service'
import {
  enqueuePublish,
  type QueuedPublishMedia,
} from '@/src/services/crm-social-publish-queue.service'
import {
  publishVideo as publishTiktokVideo,
  TIKTOK_SINGLE_CHUNK_MAX_BYTES,
} from '@/src/services/crm-social-tiktok.service'
import {
  handleError,
  standardError,
  successResponse,
} from '@/utils/http-response'

type Params = { params: Promise<{ id: string; platform: string }> }

const MAX_VIDEO_BYTES = 256 * 1024 * 1024 // 256 MB
const MAX_IMAGE_BYTES = 10 * 1024 * 1024 // 10 MB

async function toQueuedMedia(
  file: File,
  fallbackType: string,
): Promise<QueuedPublishMedia> {
  return {
    bytes: await file.arrayBuffer(),
    contentType: file.type || fallbackType,
  }
}

/** Publica conteúdo na conta. Corpo: `multipart/form-data` (varia por plataforma). */
export const POST = withAxiom(async (request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const { id, platform: platformSlug } = await ctx.params
  const platform = parseCrmPlatformSlug(platformSlug)
  if (!platform) {
    return standardError('VALIDATION_ERROR', 'Plataforma inválida')
  }

  if (
    platform !== 'FACEBOOK' &&
    platform !== 'INSTAGRAM' &&
    platform !== 'YOUTUBE' &&
    platform !== 'TIKTOK'
  ) {
    return handleError(crmSocialNotConfigured())
  }

  const actorId = auth.value.user.id

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return handleError(
      badRequest('Corpo inválido (esperado multipart/form-data)'),
    )
  }

  const rawConnectionId = form.get('connectionId')
  const connectionId =
    typeof rawConnectionId === 'string' && rawConnectionId
      ? rawConnectionId
      : undefined

  if (platform === 'YOUTUBE') {
    const file = form.get('file')
    if (!(file instanceof File) || file.size === 0) {
      return handleError(badRequest('Arquivo de vídeo ausente'))
    }
    if (file.size > MAX_VIDEO_BYTES) {
      return handleError(badRequest('Vídeo excede o tamanho máximo (256 MB)'))
    }

    const rawTags = form.get('tags')
    const tags =
      typeof rawTags === 'string' && rawTags.trim()
        ? rawTags
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean)
        : []

    const parsed = CrmSocialYoutubePublishVideoSchema.safeParse({
      title: form.get('title') ?? undefined,
      description: form.get('description') ?? undefined,
      privacyStatus: form.get('privacyStatus') ?? undefined,
      tags,
    })
    if (!parsed.success) {
      return standardError(
        'VALIDATION_ERROR',
        'Dados do vídeo inválidos',
        z.flattenError(parsed.error),
      )
    }

    const result = await enqueuePublish(
      actorId,
      id,
      CrmSocialPublishJob.PublishYoutubeVideo,
      parsed.data,
      await toQueuedMedia(file, 'video/*'),
    )
    if (!result.ok) return handleError(result.error)
    return successResponse(result.value, 202)
  }

  if (platform === 'TIKTOK') {
    const file = form.get('file')
    if (!(file instanceof File) || file.size === 0) {
      return handleError(badRequest('Arquivo de vídeo ausente'))
    }
    if (file.size > TIKTOK_SINGLE_CHUNK_MAX_BYTES) {
      return handleError(badRequest('Vídeo excede o tamanho máximo (64 MB)'))
    }

    const asBool = (value: FormDataEntryValue | null): boolean =>
      value === 'true' || value === 'on' || value === '1'

    const parsed = CrmPublishTiktokVideoSchema.safeParse({
      title: form.get('title') ?? undefined,
      privacyLevel: form.get('privacyLevel') ?? undefined,
      disableComment: asBool(form.get('disableComment')),
      disableDuet: asBool(form.get('disableDuet')),
      disableStitch: asBool(form.get('disableStitch')),
    })
    if (!parsed.success) {
      return standardError(
        'VALIDATION_ERROR',
        'Dados da publicação inválidos',
        z.flattenError(parsed.error),
      )
    }

    const result = await publishTiktokVideo(actorId, id, parsed.data, {
      bytes: await file.arrayBuffer(),
      contentType: file.type || 'video/mp4',
    })
    if (!result.ok) return handleError(result.error)
    return successResponse(result.value, 201)
  }

  if (platform === 'INSTAGRAM') {
    const parsed = CrmPublishInstagramPostSchema.safeParse({
      caption: form.get('caption') ?? undefined,
      postType: form.get('postType') ?? undefined,
    })
    if (!parsed.success) {
      return standardError(
        'VALIDATION_ERROR',
        'Dados da publicação inválidos',
        z.flattenError(parsed.error),
      )
    }

    // Reels exige vídeo; feed exige imagem; stories aceita os dois. A mídia
    // chega no campo `image` (imagem) ou `video` (vídeo).
    const imageField = form.get('image')
    const videoField = form.get('video')
    let mediaFile: File | null = null
    let kind: 'IMAGE' | 'VIDEO' | null = null

    if (videoField instanceof File && videoField.size > 0) {
      if (videoField.size > MAX_VIDEO_BYTES) {
        return handleError(badRequest('Vídeo excede o tamanho máximo (256 MB)'))
      }
      mediaFile = videoField
      kind = 'VIDEO'
    } else if (imageField instanceof File && imageField.size > 0) {
      if (imageField.size > MAX_IMAGE_BYTES) {
        return handleError(badRequest('Imagem excede o tamanho máximo (10 MB)'))
      }
      mediaFile = imageField
      kind = 'IMAGE'
    }

    if (!mediaFile || !kind) {
      return handleError(
        badRequest('Mídia obrigatória — o Instagram exige mídia para publicar'),
      )
    }
    if (parsed.data.postType === 'REELS' && kind !== 'VIDEO') {
      return handleError(badRequest('Reels exige um arquivo de vídeo'))
    }
    if (parsed.data.postType === 'FEED' && kind !== 'IMAGE') {
      return handleError(badRequest('Publicação no feed exige uma imagem'))
    }

    // Capa (opcional) — só faz sentido em Reels, a Meta aceita `cover_url`
    // como imagem de thumbnail alternativa ao frame padrão do vídeo.
    let cover: QueuedPublishMedia | undefined
    if (parsed.data.postType === 'REELS') {
      const coverField = form.get('cover')
      if (coverField instanceof File && coverField.size > 0) {
        if (coverField.size > MAX_IMAGE_BYTES) {
          return handleError(badRequest('Capa excede o tamanho máximo (10 MB)'))
        }
        cover = await toQueuedMedia(coverField, 'image/jpeg')
      }
    }

    const result = await enqueuePublish(
      actorId,
      id,
      CrmSocialPublishJob.PublishInstagramMedia,
      {
        connectionId,
        kind,
        caption: parsed.data.caption,
        postType: parsed.data.postType,
      },
      await toQueuedMedia(
        mediaFile,
        kind === 'VIDEO' ? 'video/mp4' : 'image/jpeg',
      ),
      cover,
    )
    if (!result.ok) return handleError(result.error)
    return successResponse(result.value, 202)
  }

  const parsed = CrmPublishFacebookPostSchema.safeParse({
    message: form.get('message') ?? undefined,
    link: form.get('link') ? form.get('link') : null,
  })
  if (!parsed.success) {
    return standardError(
      'VALIDATION_ERROR',
      'Dados da publicação inválidos',
      z.flattenError(parsed.error),
    )
  }

  // Vídeo é grande e pode demorar pra publicar (reencode + upload) — vai pra
  // fila, igual Instagram/YouTube. Imagem/texto continuam síncronos.
  const videoField = form.get('video')
  if (videoField instanceof File && videoField.size > 0) {
    if (videoField.size > MAX_VIDEO_BYTES) {
      return handleError(badRequest('Vídeo excede o tamanho máximo (256 MB)'))
    }

    const result = await enqueuePublish(
      actorId,
      id,
      CrmSocialPublishJob.PublishFacebookVideo,
      {
        connectionId,
        message: parsed.data.message,
        link: parsed.data.link,
      },
      await toQueuedMedia(videoField, 'video/mp4'),
    )
    if (!result.ok) return handleError(result.error)
    return successResponse(result.value, 202)
  }

  const imageField = form.get('image')
  let media: {
    bytes: ArrayBuffer
    contentType: string
    kind: 'IMAGE' | 'VIDEO'
  } | null = null
  if (imageField instanceof File && imageField.size > 0) {
    if (imageField.size > MAX_IMAGE_BYTES) {
      return handleError(badRequest('Imagem excede o tamanho máximo (10 MB)'))
    }
    media = {
      bytes: await imageField.arrayBuffer(),
      contentType: imageField.type || 'image/*',
      kind: 'IMAGE',
    }
  }

  const result = await CrmSocialFacebookService.publishPost(
    actorId,
    id,
    parsed.data,
    media,
    connectionId,
  )
  if (!result.ok) return handleError(result.error)
  return successResponse(result.value, 201)
})
