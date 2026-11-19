import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import { MINIO_ENDPOINT, MINIO_PUBLIC_URL } from '@/lib/env/_server'
import { badRequest, crmTextAiFailed, storageError } from '@/src/errors'
import { err, ok, type Result } from '@/src/lib/result'
import {
  toCrmBannerDTO,
  toCrmBannerListItemDTO,
} from '@/src/mappers/crm-banner.mapper'
import { CrmBannerRepository } from '@/src/repositories/crm-banner.repository'
import {
  BANNER_AI_JSON_SCHEMA,
  BANNER_AI_TONE_LABELS,
  BANNER_COPY_LIMITS,
  BANNER_OBJECTIVE_LABELS,
  type BannerAiCopy,
  BannerAiOutputSchema,
  type CreateCrmBannerDTO,
  type CrmBannerAiBriefDTO,
  type UpdateCrmBannerDTO,
} from '@/src/schemas/crm-banner.schema'
import { parseSdAiJson } from '@/src/schemas/sd-ai.schema'
import type {
  CrmBannerAiResultDTO,
  CrmBannerDTO,
  CrmBannerListItemDTO,
} from '@/types/crm-banner'
import { AiUsageService } from './ai-usage.service'
import { assertModuleMember } from './authz'
import { assertFeature } from './feature-flag.service'

const RESOURCE = 'social'
const AI_MAX_TOKENS = 1500
/** Images pulled through the proxy are banner assets: keep them bounded. */
const PROXY_MAX_BYTES = 10 * 1024 * 1024

/** Cuts `text` to `max` characters on a word boundary. */
export function fitCopy(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (clean.length <= max) return clean
  const cut = clean.slice(0, max)
  const lastSpace = cut.lastIndexOf(' ')
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()
}

export function normalizeCopy(copy: BannerAiCopy): BannerAiCopy {
  return {
    headline: fitCopy(copy.headline, BANNER_COPY_LIMITS.headline),
    subheadline: fitCopy(copy.subheadline, BANNER_COPY_LIMITS.subheadline),
    cta: fitCopy(copy.cta, BANNER_COPY_LIMITS.cta),
    badge: fitCopy(copy.badge, BANNER_COPY_LIMITS.badge),
  }
}

/** Pure: the system prompt of the banner copywriter. */
export function buildBannerAiSystem(brief: CrmBannerAiBriefDTO): string {
  const lines = [
    'Você é um redator de anúncios display (Google Display, Meta, TikTok, YouTube) que escreve textos curtos para banners.',
    'Responda sempre em português do Brasil. Texto de banner é lido em um segundo: frases curtas, verbo no início do CTA, sem pontuação exagerada, sem emojis e sem hashtags.',
    'Não invente preços, descontos, prazos nem garantias que não estejam no briefing.',
    'Devolva JSON com "variants" (lista de opções) e "imageIdea" (uma frase descrevendo a imagem principal ideal, em pt-BR).',
    'Cada opção tem: "headline" (a chamada principal), "subheadline" (apoio, pode ser string vazia), "cta" (texto do botão) e "badge" (selo curto como "Novo" ou "-20%", string vazia se não houver).',
    `Limites de caracteres: headline ${BANNER_COPY_LIMITS.headline}, subheadline ${BANNER_COPY_LIMITS.subheadline}, cta ${BANNER_COPY_LIMITS.cta}, badge ${BANNER_COPY_LIMITS.badge}.`,
    `Devolva exatamente ${brief.mode === 'BANNER' ? 1 : brief.count} opç${brief.mode === 'BANNER' ? 'ão' : 'ões'}.`,
    `Tom: ${BANNER_AI_TONE_LABELS[brief.tone]}.`,
  ]
  if (brief.mode === 'VARIANTS') {
    lines.push(
      'As opções são variações para teste A/B do texto atual: cada uma deve abordar um ângulo diferente (benefício, urgência, prova, curiosidade), sem repetir as outras.',
    )
  }
  if (brief.objective) {
    lines.push(
      `Objetivo da campanha: ${BANNER_OBJECTIVE_LABELS[brief.objective]}.`,
    )
  }
  if (brief.companyName) lines.push(`Empresa: ${brief.companyName}.`)
  if (brief.description) lines.push(`O que divulgar: ${brief.description}`)
  if (brief.offer) lines.push(`Oferta: ${brief.offer}`)
  if (brief.headline) lines.push(`Headline sugerida: ${brief.headline}`)
  if (brief.cta) lines.push(`CTA desejado: ${brief.cta}`)
  if (brief.imageIdea) lines.push(`Imagem pensada: ${brief.imageIdea}`)
  if (brief.current) {
    lines.push(
      `Texto atual do banner:\n"""\nheadline: ${brief.current.headline}\nsubheadline: ${brief.current.subheadline}\ncta: ${brief.current.cta}\n"""`,
    )
  }
  return lines.join('\n')
}

function resolveMediaBase(): string | null {
  const base = MINIO_PUBLIC_URL ?? MINIO_ENDPOINT
  return base ? base.replace(/\/+$/, '') : null
}

export const CrmBannerService = {
  async list(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<CrmBannerListItemDTO[]>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: RESOURCE,
      action: 'VIEW',
    })
    if (!membership.ok) return membership

    const result = await CrmBannerRepository.listByWorkspace(workspaceId)
    if (!result.ok) return result
    return ok(result.value.map(toCrmBannerListItemDTO))
  },

  async get(
    actorId: string,
    workspaceId: string,
    bannerId: string,
  ): Promise<Result<CrmBannerDTO>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: RESOURCE,
      action: 'VIEW',
    })
    if (!membership.ok) return membership

    const result = await CrmBannerRepository.findById(bannerId, workspaceId)
    if (!result.ok) return result
    return ok(toCrmBannerDTO(result.value))
  },

  async create(
    actorId: string,
    workspaceId: string,
    dto: CreateCrmBannerDTO,
  ): Promise<Result<CrmBannerDTO>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: RESOURCE,
      action: 'CREATE',
    })
    if (!membership.ok) return membership

    const result = await CrmBannerRepository.create({
      workspaceId,
      createdById: actorId,
      name: dto.name,
      folder: dto.folder,
      tags: dto.tags,
      objective: dto.objective,
      document: dto.document,
    })
    if (!result.ok) {
      auditMutation({
        entity: 'crm_banner',
        action: 'create',
        actorId,
        outcome: 'failure',
        reason: result.error.code,
      })
      return result
    }

    auditMutation({
      entity: 'crm_banner',
      action: 'create',
      actorId,
      targetId: result.value.id,
    })
    return ok(toCrmBannerDTO(result.value))
  },

  async update(
    actorId: string,
    workspaceId: string,
    bannerId: string,
    dto: UpdateCrmBannerDTO,
  ): Promise<Result<CrmBannerDTO>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: RESOURCE,
      action: 'EDIT',
    })
    if (!membership.ok) return membership

    const existing = await CrmBannerRepository.findById(bannerId, workspaceId)
    if (!existing.ok) return existing

    const result = await CrmBannerRepository.update(bannerId, {
      updatedById: actorId,
      name: dto.name,
      folder: dto.folder,
      tags: dto.tags,
      objective: dto.objective,
      document: dto.document,
    })
    if (!result.ok) return result

    auditMutation({
      entity: 'crm_banner',
      action: 'update',
      actorId,
      targetId: bannerId,
      meta: { fields: Object.keys(dto) },
    })
    return ok(toCrmBannerDTO(result.value))
  },

  async duplicate(
    actorId: string,
    workspaceId: string,
    bannerId: string,
    name?: string,
  ): Promise<Result<CrmBannerDTO>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: RESOURCE,
      action: 'CREATE',
    })
    if (!membership.ok) return membership

    const existing = await CrmBannerRepository.findById(bannerId, workspaceId)
    if (!existing.ok) return existing

    const source = toCrmBannerDTO(existing.value)
    const result = await CrmBannerRepository.create({
      workspaceId,
      createdById: actorId,
      name: (name ?? `${source.name} (cópia)`).slice(0, 120),
      folder: source.folder,
      tags: source.tags,
      objective: source.objective,
      document: source.document,
    })
    if (!result.ok) return result

    auditMutation({
      entity: 'crm_banner',
      action: 'create',
      actorId,
      targetId: result.value.id,
      meta: { sourceId: bannerId },
    })
    return ok(toCrmBannerDTO(result.value))
  },

  async remove(
    actorId: string,
    workspaceId: string,
    bannerId: string,
  ): Promise<Result<void>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: RESOURCE,
      action: 'DELETE',
    })
    if (!membership.ok) return membership

    const existing = await CrmBannerRepository.findById(bannerId, workspaceId)
    if (!existing.ok) return existing

    const result = await CrmBannerRepository.softDelete(bannerId, actorId)
    if (!result.ok) return result

    auditMutation({
      entity: 'crm_banner',
      action: 'delete',
      actorId,
      targetId: bannerId,
    })
    return ok(undefined)
  },

  /**
   * Copy for a banner (one option) or A/B variants of the current text. Same
   * gate, model and monthly quota as the other CRM AI features (ADR 0007):
   * only the briefing goes to the provider, never CRM data.
   */
  async generateCopy(
    actorId: string,
    workspaceId: string,
    brief: CrmBannerAiBriefDTO,
  ): Promise<Result<CrmBannerAiResultDTO>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: RESOURCE,
      action: 'CREATE',
    })
    if (!membership.ok) return membership
    const feature = await assertFeature(workspaceId, 'crm.aiAssistant')
    if (!feature.ok) return feature

    const call = await AiUsageService.prepare(
      workspaceId,
      'CRM_ASSISTANT',
      actorId,
    )
    if (!call.ok) return call

    let text: string
    try {
      const response = await call.value.provider.chat({
        model: call.value.model.model,
        system: buildBannerAiSystem(brief),
        messages: [
          {
            role: 'user' as const,
            content:
              brief.mode === 'BANNER'
                ? 'Escreva o texto do banner.'
                : 'Escreva as variações para teste A/B.',
          },
        ],
        jsonSchema: { name: 'crm_banner_copy', schema: BANNER_AI_JSON_SCHEMA },
        maxTokens: AI_MAX_TOKENS,
      })
      await AiUsageService.record(call.value, {
        workspaceId,
        userId: actorId,
        usage: response.usage,
        scope: { module: 'CRM' },
      })
      text = response.text
    } catch (error) {
      logger.error('crm_banner_ai.provider_failed', {
        component: 'CrmBannerService',
        workspaceId,
        provider: call.value.model.provider,
        model: call.value.model.model,
        message: error instanceof Error ? error.message : String(error),
      })
      return err(crmTextAiFailed())
    }

    const parsed = parseSdAiJson(BannerAiOutputSchema, text)
    const variants = (parsed?.variants ?? [])
      .map(normalizeCopy)
      .filter((variant) => variant.headline)
      .slice(0, brief.mode === 'BANNER' ? 1 : brief.count)
    if (!parsed || variants.length === 0) {
      logger.warn('crm_banner_ai.invalid_output', {
        component: 'CrmBannerService',
        workspaceId,
        model: call.value.model.key,
      })
      return err(crmTextAiFailed())
    }

    auditMutation({
      entity: 'crm_banner',
      action: 'generate',
      actorId,
      meta: { mode: brief.mode, variants: variants.length },
    })
    return ok({ variants, imageIdea: fitCopy(parsed.imageIdea, 200) })
  },

  /**
   * Bytes of a workspace image for the export canvas. The media bucket may
   * not send CORS headers, which would taint the canvas, so the browser asks
   * this proxy. Only the media origin is served (never an arbitrary URL).
   */
  async fetchImage(
    actorId: string,
    workspaceId: string,
    url: string,
  ): Promise<Result<{ body: Buffer; contentType: string }>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: RESOURCE,
      action: 'VIEW',
    })
    if (!membership.ok) return membership

    const base = resolveMediaBase()
    if (!base || !url.startsWith(`${base}/`) || url.includes('..')) {
      return err(badRequest('Imagem fora da biblioteca de mídia'))
    }

    try {
      const response = await fetch(url, { redirect: 'error' })
      const contentType = response.headers.get('content-type') ?? ''
      if (!response.ok || !contentType.startsWith('image/')) {
        return err(badRequest('Não foi possível carregar a imagem'))
      }
      const buffer = Buffer.from(await response.arrayBuffer())
      if (buffer.length > PROXY_MAX_BYTES) {
        return err(badRequest('Imagem muito grande'))
      }
      return ok({ body: buffer, contentType })
    } catch (error) {
      logger.error('crm_banner.image_proxy_failed', {
        component: 'CrmBannerService',
        workspaceId,
        message: error instanceof Error ? error.message : String(error),
      })
      return err(storageError('Não foi possível carregar a imagem'))
    }
  },
}
