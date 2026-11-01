import { auditMutation } from '@/lib/axiom/audit'
import {
  crmScheduledPostAlreadyPublished,
  crmScheduledPostInvalid,
  crmSocialNotConfigured,
  crmSocialOauthFailed,
  crmSocialStateInvalid,
} from '@/src/errors'
import { err, ok, type Result } from '@/src/lib/result'
import { encryptToken, isTokenCryptoConfigured } from '@/src/lib/social/crypto'
import {
  createOauthState,
  verifyOauthState,
} from '@/src/lib/social/oauth-state'
import { createPkcePair } from '@/src/lib/social/pkce'
import { getProvider } from '@/src/lib/social/providers'
import { socialCallbackUrl } from '@/src/lib/social/redirect'
import { ensureBucket, putObject } from '@/src/lib/storage/s3'
import {
  toCrmScheduledPostDTO,
  toCrmSocialConnectionDTO,
} from '@/src/mappers/crm-social.mapper'
import {
  type CrmScheduledMediaSeed,
  CrmScheduledPostMediaRepository,
  CrmScheduledPostRepository,
  CrmScheduledPostTargetRepository,
  CrmSocialConnectionRepository,
} from '@/src/repositories/crm-social.repository'
import { WorkspaceRepository } from '@/src/repositories/workspace.repository'
import {
  CRM_INSTAGRAM_POST_TYPE_MEDIA,
  CRM_PLATFORM_MEDIA_REQUIREMENT,
  CRM_PLATFORM_TEXT_LIMIT,
  type CRM_SOCIAL_PLATFORMS,
  type CreateCrmScheduledPostDTO,
  type CreateCrmSocialConnectionDTO,
  type CrmPublishablePlatform,
  type UpdateCrmScheduledPostDTO,
} from '@/src/schemas/crm-social.schema'
import type {
  CrmScheduledPostDTO,
  CrmSocialConnectionDTO,
} from '@/types/crm-social'
import { assertModuleMember } from './authz'
import {
  CRM_SCHEDULED_POST_BUCKET,
  publishScheduledPost,
} from './crm-social-scheduler'
import { assertFeature } from './feature-flag.service'

/** Mídia recebida na criação (já lida como bytes, antes de ir ao MinIO). */
export type CrmScheduledUploadMedia = {
  kind: 'IMAGE' | 'VIDEO'
  bytes: ArrayBuffer
  contentType: string
}

/**
 * Valida que cada plataforma escolhida tem o que precisa (mídia + texto).
 * Roda antes de persistir: erra cedo com mensagem clara em vez de falhar no
 * publish.
 */
function validateScheduledPostRequirements(
  platforms: CrmPublishablePlatform[],
  content: string,
  title: string | null,
  media: { kind: 'IMAGE' | 'VIDEO' }[],
  igPostType: 'FEED' | 'REELS' | 'STORIES',
): Result<true> {
  const hasImage = media.some((m) => m.kind === 'IMAGE')
  const hasVideo = media.some((m) => m.kind === 'VIDEO')

  for (const platform of platforms) {
    if (platform === 'INSTAGRAM') {
      const igReq = CRM_INSTAGRAM_POST_TYPE_MEDIA[igPostType]
      if (igReq === 'image' && !hasImage) {
        return err(
          crmScheduledPostInvalid('Publicação no Instagram exige uma imagem.', {
            platform,
          }),
        )
      }
      if (igReq === 'video' && !hasVideo) {
        return err(
          crmScheduledPostInvalid('Reels do Instagram exige um vídeo.', {
            platform,
          }),
        )
      }
      if (igReq === 'either' && !hasImage && !hasVideo) {
        return err(
          crmScheduledPostInvalid(
            'Stories do Instagram exige uma imagem ou vídeo.',
            { platform },
          ),
        )
      }
      if (content.length > CRM_PLATFORM_TEXT_LIMIT.INSTAGRAM) {
        return err(
          crmScheduledPostInvalid(
            `O texto excede o limite de ${CRM_PLATFORM_TEXT_LIMIT.INSTAGRAM} caracteres do INSTAGRAM.`,
            { platform },
          ),
        )
      }
      continue
    }

    const requirement = CRM_PLATFORM_MEDIA_REQUIREMENT[platform]
    if (requirement === 'image' && !hasImage) {
      return err(
        crmScheduledPostInvalid(`${platform} exige ao menos uma imagem.`, {
          platform,
        }),
      )
    }
    if (requirement === 'video' && !hasVideo) {
      return err(
        crmScheduledPostInvalid(`${platform} exige um vídeo.`, { platform }),
      )
    }
    if (content.length > CRM_PLATFORM_TEXT_LIMIT[platform]) {
      return err(
        crmScheduledPostInvalid(
          `O texto excede o limite de ${CRM_PLATFORM_TEXT_LIMIT[platform]} caracteres do ${platform}.`,
          { platform },
        ),
      )
    }

    if (
      platform === 'FACEBOOK' &&
      content.trim().length === 0 &&
      !hasImage &&
      !hasVideo
    ) {
      return err(
        crmScheduledPostInvalid(
          'Facebook exige um texto, uma imagem ou um vídeo.',
          { platform },
        ),
      )
    }
    if (platform === 'YOUTUBE' && !title && content.trim().length === 0) {
      return err(
        crmScheduledPostInvalid(
          'YouTube exige um título (ou ao menos um texto para usar como título).',
          { platform },
        ),
      )
    }
  }
  return ok(true)
}

export const CrmSocialConnectionService = {
  async list(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<CrmSocialConnectionDTO[]>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'social',
      action: 'VIEW',
    })
    if (!membership.ok) return membership

    const result =
      await CrmSocialConnectionRepository.listByWorkspace(workspaceId)
    if (!result.ok) return result

    return ok(result.value.map(toCrmSocialConnectionDTO))
  },

  async create(
    actorId: string,
    workspaceId: string,
    dto: CreateCrmSocialConnectionDTO,
  ): Promise<Result<CrmSocialConnectionDTO>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'social',
      action: 'CREATE',
    })
    if (!membership.ok) return membership

    const result = await CrmSocialConnectionRepository.create({
      workspaceId,
      createdById: actorId,
      platform: dto.platform,
      externalAccountId: dto.externalAccountId,
      accountName: dto.accountName,
    })

    if (!result.ok) {
      auditMutation({
        entity: 'crm_social_connection',
        action: 'create',
        actorId,
        outcome: 'failure',
        reason: result.error.code,
      })
      return result
    }

    auditMutation({
      entity: 'crm_social_connection',
      action: 'create',
      actorId,
      targetId: result.value.id,
      meta: { platform: dto.platform },
    })

    return ok(toCrmSocialConnectionDTO(result.value))
  },

  async remove(
    actorId: string,
    workspaceId: string,
    connectionId: string,
  ): Promise<Result<void>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'social',
      action: 'DELETE',
    })
    if (!membership.ok) return membership

    const existing = await CrmSocialConnectionRepository.findById(
      connectionId,
      workspaceId,
    )
    if (!existing.ok) return existing

    const result = await CrmSocialConnectionRepository.remove(connectionId)
    if (!result.ok) return result

    auditMutation({
      entity: 'crm_social_connection',
      action: 'delete',
      actorId,
      targetId: connectionId,
    })

    return ok(undefined)
  },

  /** Monta a URL de autorização OAuth do provedor. */
  async beginConnect(
    actorId: string,
    workspaceId: string,
    platform: (typeof CRM_SOCIAL_PLATFORMS)[number],
  ): Promise<Result<{ authorizeUrl: string; pkceVerifier: string | null }>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'social',
      action: 'CREATE',
    })
    if (!membership.ok) return membership

    if (!isTokenCryptoConfigured()) return err(crmSocialNotConfigured())

    const provider = getProvider(platform)
    if (!provider.isConfigured()) return err(crmSocialNotConfigured())

    const workspace = await WorkspaceRepository.findById(workspaceId)
    if (!workspace.ok) return workspace
    if (!workspace.value) return err(crmSocialOauthFailed())

    const state = createOauthState(workspaceId, workspace.value.slug, platform)
    const redirectUri = socialCallbackUrl(platform)

    const pkce = provider.usesPkce ? createPkcePair() : null

    const authorizeUrl = provider.buildAuthorizeUrl({
      redirectUri,
      state,
      codeChallenge: pkce?.challenge,
    })

    return ok({ authorizeUrl, pkceVerifier: pkce?.verifier ?? null })
  },

  /** Troca o code por tokens, resolve as contas concedidas e persiste uma conexão por conta. */
  async completeConnect(
    actorId: string,
    state: string,
    code: string,
    pkceVerifier: string | null,
  ): Promise<
    Result<{
      workspaceSlug: string
      platform: (typeof CRM_SOCIAL_PLATFORMS)[number]
      connected: number
    }>
  > {
    const verified = verifyOauthState(state)
    if (!verified.ok) return err(crmSocialStateInvalid())
    const { workspaceId, slug, platform } = verified.value

    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'social',
      action: 'CREATE',
    })
    if (!membership.ok) return membership

    const provider = getProvider(platform)
    if (!provider.isConfigured()) return err(crmSocialNotConfigured())

    const redirectUri = socialCallbackUrl(platform)

    const tokens = await provider.exchangeCode({
      code,
      redirectUri,
      codeVerifier: pkceVerifier ?? undefined,
    })
    if (!tokens.ok) return tokens

    const accounts = await provider.fetchAccounts(tokens.value)
    if (!accounts.ok) return accounts

    const workspace = await WorkspaceRepository.findById(workspaceId)
    if (!workspace.ok) return workspace
    if (!workspace.value) return err(crmSocialOauthFailed())

    const existing = await CrmSocialConnectionRepository.listByPlatform(
      workspaceId,
      platform,
    )
    if (!existing.ok) return existing
    const hasPrimaryAlready = existing.value.some((c) => c.isPrimary)

    let connected = 0
    for (const [index, account] of accounts.value.entries()) {
      const override = account.accessTokenOverride

      const result = await CrmSocialConnectionRepository.upsertOAuthConnection({
        workspaceId,
        createdById: actorId,
        platform,
        externalAccountId: account.externalId,
        accountName: account.name,
        accessToken: encryptToken(
          override ? override.accessToken : tokens.value.accessToken,
        ),
        refreshToken: tokens.value.refreshToken
          ? encryptToken(tokens.value.refreshToken)
          : null,
        tokenExpiresAt: override ? override.expiresAt : tokens.value.expiresAt,
        scope: tokens.value.scope,
        isPrimary: !hasPrimaryAlready && index === 0,
      })
      if (!result.ok) return result
      connected += 1

      auditMutation({
        entity: 'crm_social_connection',
        action: 'update',
        actorId,
        targetId: result.value.id,
        meta: { platform, via: 'oauth', externalAccountId: account.externalId },
      })
    }

    return ok({ workspaceSlug: slug, platform, connected })
  },

  /** Define qual conta conectada de uma plataforma é usada por padrão (agendamentos, leituras sem connectionId explícito). */
  async setPrimary(
    actorId: string,
    workspaceId: string,
    connectionId: string,
  ): Promise<Result<CrmSocialConnectionDTO>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'social',
      action: 'EDIT',
    })
    if (!membership.ok) return membership

    const existing = await CrmSocialConnectionRepository.findById(
      connectionId,
      workspaceId,
    )
    if (!existing.ok) return existing

    const result = await CrmSocialConnectionRepository.setPrimary(
      workspaceId,
      existing.value.platform,
      connectionId,
    )
    if (!result.ok) return result

    auditMutation({
      entity: 'crm_social_connection',
      action: 'update',
      actorId,
      targetId: connectionId,
      meta: { isPrimary: true },
    })

    return ok(toCrmSocialConnectionDTO(result.value))
  },
}

export const CrmScheduledPostService = {
  async list(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<CrmScheduledPostDTO[]>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'social',
      action: 'VIEW',
    })
    if (!membership.ok) return membership

    const result = await CrmScheduledPostRepository.listByWorkspace(workspaceId)
    if (!result.ok) return result

    return ok(result.value.map((post) => toCrmScheduledPostDTO(post)))
  },

  async getById(
    actorId: string,
    workspaceId: string,
    postId: string,
  ): Promise<Result<CrmScheduledPostDTO>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'social',
      action: 'VIEW',
    })
    if (!membership.ok) return membership

    const result = await CrmScheduledPostRepository.findById(
      postId,
      workspaceId,
    )
    if (!result.ok) return result

    return ok(toCrmScheduledPostDTO(result.value))
  },

  async create(
    actorId: string,
    workspaceId: string,
    dto: CreateCrmScheduledPostDTO,
    media: CrmScheduledUploadMedia[] = [],
  ): Promise<Result<CrmScheduledPostDTO>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'social',
      action: 'CREATE',
    })
    if (!membership.ok) return membership
    const feature = await assertFeature(workspaceId, 'crm.socialPublishing')
    if (!feature.ok) return feature

    const title = dto.title?.trim() ? dto.title.trim() : undefined

    const valid = validateScheduledPostRequirements(
      dto.platforms,
      dto.content,
      title ?? null,
      media,
      dto.options.instagram?.postType ?? 'FEED',
    )
    if (!valid.ok) return valid

    const seeds: CrmScheduledMediaSeed[] = []
    if (media.length > 0) {
      await ensureBucket(CRM_SCHEDULED_POST_BUCKET)
      const { randomBytes } = await import('node:crypto')
      for (let i = 0; i < media.length; i++) {
        const item = media[i]
        const ext = item.contentType.split('/')[1] ?? 'bin'
        const key = `${workspaceId}/scheduled/${randomBytes(16).toString('hex')}.${ext}`
        await putObject({
          bucket: CRM_SCHEDULED_POST_BUCKET,
          key,
          body: Buffer.from(item.bytes),
          contentType: item.contentType,
        })
        seeds.push({
          kind: item.kind,
          storageKey: key,
          contentType: item.contentType,
          sizeBytes: item.bytes.byteLength,
          order: i,
        })
      }
    }

    const isNow = dto.mode === 'now'
    const scheduledFor = isNow ? new Date() : dto.scheduledFor

    const result = await CrmScheduledPostRepository.create({
      workspaceId,
      createdById: actorId,
      content: dto.content,
      title,
      options: dto.options,
      status: isNow ? 'PUBLISHING' : 'SCHEDULED',
      scheduledFor,
    })
    if (!result.ok) return result

    const targets = await CrmScheduledPostTargetRepository.createMany(
      result.value.id,
      dto.platforms,
    )
    if (!targets.ok) return targets

    if (seeds.length > 0) {
      const mediaResult = await CrmScheduledPostMediaRepository.createMany(
        result.value.id,
        seeds,
      )
      if (!mediaResult.ok) return mediaResult
    }

    auditMutation({
      entity: 'crm_scheduled_post',
      action: 'create',
      actorId,
      targetId: result.value.id,
      meta: { platforms: dto.platforms, mode: dto.mode },
    })

    if (isNow) {
      const reloaded = await CrmScheduledPostRepository.findById(
        result.value.id,
        workspaceId,
      )
      if (!reloaded.ok) return reloaded
      await publishScheduledPost(reloaded.value)
    }

    const withRelations = await CrmScheduledPostRepository.findById(
      result.value.id,
      workspaceId,
    )
    if (!withRelations.ok) return withRelations

    return ok(toCrmScheduledPostDTO(withRelations.value))
  },

  async update(
    actorId: string,
    workspaceId: string,
    postId: string,
    dto: UpdateCrmScheduledPostDTO,
  ): Promise<Result<CrmScheduledPostDTO>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'social',
      action: 'EDIT',
    })
    if (!membership.ok) return membership

    const existing = await CrmScheduledPostRepository.findById(
      postId,
      workspaceId,
    )
    if (!existing.ok) return existing
    if (
      existing.value.status === 'PUBLISHED' ||
      existing.value.status === 'PUBLISHING'
    ) {
      return err(crmScheduledPostAlreadyPublished())
    }

    const result = await CrmScheduledPostRepository.update(postId, {
      content: dto.content,
      title: dto.title,
      scheduledFor: dto.scheduledFor,
    })
    if (!result.ok) return result

    auditMutation({
      entity: 'crm_scheduled_post',
      action: 'update',
      actorId,
      targetId: postId,
      meta: { fields: Object.keys(dto) },
    })

    return ok(toCrmScheduledPostDTO(result.value))
  },

  async remove(
    actorId: string,
    workspaceId: string,
    postId: string,
  ): Promise<Result<void>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'social',
      action: 'DELETE',
    })
    if (!membership.ok) return membership

    const existing = await CrmScheduledPostRepository.findById(
      postId,
      workspaceId,
    )
    if (!existing.ok) return existing

    const result = await CrmScheduledPostRepository.softDelete(postId)
    if (!result.ok) return result

    auditMutation({
      entity: 'crm_scheduled_post',
      action: 'delete',
      actorId,
      targetId: postId,
    })

    return ok(undefined)
  },

  /** Cancela um agendamento pendente ou que falhou — não desfaz publicações. */
  async cancel(
    actorId: string,
    workspaceId: string,
    postId: string,
  ): Promise<Result<CrmScheduledPostDTO>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'social',
      action: 'EDIT',
    })
    if (!membership.ok) return membership

    const existing = await CrmScheduledPostRepository.findById(
      postId,
      workspaceId,
    )
    if (!existing.ok) return existing
    if (
      existing.value.status !== 'SCHEDULED' &&
      existing.value.status !== 'FAILED' &&
      existing.value.status !== 'PARTIALLY_FAILED'
    ) {
      return err(
        crmScheduledPostInvalid(
          'Só é possível cancelar posts agendados ou que falharam.',
        ),
      )
    }

    const result = await CrmScheduledPostRepository.cancel(postId)
    if (!result.ok) return result

    auditMutation({
      entity: 'crm_scheduled_post',
      action: 'update',
      actorId,
      targetId: postId,
      meta: { canceled: true },
    })

    const withRelations = await CrmScheduledPostRepository.findById(
      postId,
      workspaceId,
    )
    if (!withRelations.ok) return withRelations
    return ok(toCrmScheduledPostDTO(withRelations.value))
  },

  /** Reagenda um post ainda não publicado para uma nova data/hora futura. */
  async reschedule(
    actorId: string,
    workspaceId: string,
    postId: string,
    scheduledFor: Date,
  ): Promise<Result<CrmScheduledPostDTO>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'social',
      action: 'EDIT',
    })
    if (!membership.ok) return membership
    const feature = await assertFeature(workspaceId, 'crm.socialPublishing')
    if (!feature.ok) return feature

    const existing = await CrmScheduledPostRepository.findById(
      postId,
      workspaceId,
    )
    if (!existing.ok) return existing
    if (
      existing.value.status === 'PUBLISHED' ||
      existing.value.status === 'PUBLISHING'
    ) {
      return err(
        crmScheduledPostInvalid(
          'Não é possível reagendar um post já publicado.',
        ),
      )
    }

    const result = await CrmScheduledPostRepository.reschedule(
      postId,
      scheduledFor,
    )
    if (!result.ok) return result

    auditMutation({
      entity: 'crm_scheduled_post',
      action: 'update',
      actorId,
      targetId: postId,
      meta: { rescheduled: true },
    })

    const withRelations = await CrmScheduledPostRepository.findById(
      postId,
      workspaceId,
    )
    if (!withRelations.ok) return withRelations
    return ok(toCrmScheduledPostDTO(withRelations.value))
  },

  async publish(
    actorId: string,
    workspaceId: string,
    postId: string,
  ): Promise<Result<CrmScheduledPostDTO>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'social',
      action: 'CREATE',
    })
    if (!membership.ok) return membership
    const feature = await assertFeature(workspaceId, 'crm.socialPublishing')
    if (!feature.ok) return feature

    const existing = await CrmScheduledPostRepository.findById(
      postId,
      workspaceId,
    )
    if (!existing.ok) return existing
    if (existing.value.status === 'PUBLISHED') {
      return err(crmScheduledPostAlreadyPublished())
    }

    await publishScheduledPost(existing.value)

    auditMutation({
      entity: 'crm_scheduled_post',
      action: 'update',
      actorId,
      targetId: postId,
      meta: { publishTriggeredManually: true },
    })

    const withRelations = await CrmScheduledPostRepository.findById(
      postId,
      workspaceId,
    )
    if (!withRelations.ok) return withRelations

    return ok(toCrmScheduledPostDTO(withRelations.value))
  },
}
