import type { CrmNewsletter } from '@prisma/client'
import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import { BETTER_AUTH_URL } from '@/lib/env/server'
import { crmNewsletterSlugTaken } from '@/src/errors'
import { err, ok, type Result } from '@/src/lib/result'
import { resolveVerifiedSender } from '@/src/lib/sending-domain/resolve-sender'
import { toCrmNewsletterDTO } from '@/src/mappers/crm-newsletter.mapper'
import { CrmNewsletterRepository } from '@/src/repositories/crm-newsletter.repository'
import { WorkspaceRepository } from '@/src/repositories/workspace.repository'
import type {
  CreateCrmNewsletterDTO,
  CrmNewsletterDTO,
  UpdateCrmNewsletterDTO,
} from '@/src/schemas/crm-newsletter.schema'
import { assertModuleMember } from './authz'

type Action = 'VIEW' | 'CREATE' | 'EDIT' | 'DELETE'

function gate(actorId: string, workspaceId: string, action: Action) {
  return assertModuleMember(actorId, workspaceId, 'CRM', {
    resource: 'email',
    action,
  })
}

/** "Novidades da Acme!" → "novidades-da-acme" (2–60 chars, kebab-case). */
export function slugifyNewsletterName(name: string): string {
  const slug = name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 56)
    .replace(/-+$/g, '')
  return slug.length >= 2 ? slug : 'newsletter'
}

/** First free slug: `base`, `base-2`, `base-3`… */
async function freeSlug(
  workspaceId: string,
  base: string,
): Promise<Result<string>> {
  for (let n = 1; n <= 50; n++) {
    const candidate = n === 1 ? base : `${base}-${n}`
    const taken = await CrmNewsletterRepository.slugExists(
      workspaceId,
      candidate,
    )
    if (!taken.ok) return taken
    if (!taken.value) return ok(candidate)
  }
  return err(crmNewsletterSlugTaken())
}

/** `{ sendingDomainId }` of the From address (null when not verified). */
async function senderDomain(
  workspaceId: string,
  fromEmail: string,
): Promise<Result<string | null>> {
  const resolved = await resolveVerifiedSender(workspaceId, fromEmail)
  if (resolved.ok) return ok(resolved.value.sendingDomainId)
  if (resolved.error.code === 'SENDING_DOMAIN_NOT_VERIFIED') return ok(null)
  return resolved
}

async function workspaceSlug(workspaceId: string): Promise<Result<string>> {
  const workspace = await WorkspaceRepository.findById(workspaceId)
  if (!workspace.ok) return workspace
  return ok(workspace.value.slug)
}

/**
 * Builds the DTOs, checking the sender live (a domain may be verified or
 * fail after the newsletter was saved). When the live answer differs from
 * the stored `sendingDomainId`, the row is brought up to date best-effort.
 */
async function toDTOs(
  workspaceId: string,
  newsletters: CrmNewsletter[],
): Promise<Result<CrmNewsletterDTO[]>> {
  const slug = await workspaceSlug(workspaceId)
  if (!slug.ok) return slug
  const stats = await CrmNewsletterRepository.statsFor(
    newsletters.map((n) => n.id),
  )
  if (!stats.ok) return stats

  const out: CrmNewsletterDTO[] = []
  for (const newsletter of newsletters) {
    const domain = await senderDomain(workspaceId, newsletter.fromEmail)
    if (!domain.ok) return domain
    if (domain.value !== newsletter.sendingDomainId) {
      const synced = await CrmNewsletterRepository.update(newsletter.id, {
        sendingDomainId: domain.value,
      })
      if (!synced.ok) {
        logger.warn('crm_newsletter.sender_sync_failed', {
          newsletterId: newsletter.id,
        })
      }
    }
    out.push(
      toCrmNewsletterDTO(
        { ...newsletter, sendingDomainId: domain.value },
        {
          baseUrl: BETTER_AUTH_URL,
          workspaceSlug: slug.value,
          stats: stats.value.get(newsletter.id),
          senderVerified: domain.value !== null,
        },
      ),
    )
  }
  return ok(out)
}

async function toDTO(
  workspaceId: string,
  newsletter: CrmNewsletter,
): Promise<Result<CrmNewsletterDTO>> {
  const list = await toDTOs(workspaceId, [newsletter])
  if (!list.ok) return list
  return ok(list.value[0])
}

/**
 * CRM newsletters (ADR 0054, docs/crm-newsletter/README.md): CRUD,
 * archive/reactivate (status) and soft delete. Permission resource `email`.
 */
export const CrmNewsletterService = {
  async list(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<CrmNewsletterDTO[]>> {
    const membership = await gate(actorId, workspaceId, 'VIEW')
    if (!membership.ok) return membership

    const rows = await CrmNewsletterRepository.listByWorkspace(workspaceId)
    if (!rows.ok) return rows
    return toDTOs(workspaceId, rows.value)
  },

  async get(
    actorId: string,
    workspaceId: string,
    newsletterId: string,
  ): Promise<Result<CrmNewsletterDTO>> {
    const membership = await gate(actorId, workspaceId, 'VIEW')
    if (!membership.ok) return membership

    const row = await CrmNewsletterRepository.findById(
      newsletterId,
      workspaceId,
    )
    if (!row.ok) return row
    return toDTO(workspaceId, row.value)
  },

  async create(
    actorId: string,
    workspaceId: string,
    dto: CreateCrmNewsletterDTO,
  ): Promise<Result<CrmNewsletterDTO>> {
    const membership = await gate(actorId, workspaceId, 'CREATE')
    if (!membership.ok) return membership

    let slug: string
    if (dto.slug) {
      const taken = await CrmNewsletterRepository.slugExists(
        workspaceId,
        dto.slug,
      )
      if (!taken.ok) return taken
      if (taken.value) return err(crmNewsletterSlugTaken())
      slug = dto.slug
    } else {
      const free = await freeSlug(workspaceId, slugifyNewsletterName(dto.name))
      if (!free.ok) return free
      slug = free.value
    }

    const fromEmail = dto.fromEmail.toLowerCase()
    const domain = await senderDomain(workspaceId, fromEmail)
    if (!domain.ok) return domain

    const created = await CrmNewsletterRepository.create({
      workspaceId,
      createdById: actorId,
      name: dto.name,
      slug,
      description: dto.description ?? null,
      cadenceLabel: dto.cadenceLabel ?? null,
      fromName: dto.fromName,
      fromEmail,
      replyTo: dto.replyTo?.toLowerCase() ?? null,
      sendingDomainId: domain.value,
      templateId: dto.templateId ?? null,
      doubleOptIn: dto.doubleOptIn,
      legalBasis: dto.legalBasis,
      archiveEnabled: dto.archiveEnabled,
    })
    if (!created.ok) {
      auditMutation({
        entity: 'crm_newsletter',
        action: 'create',
        actorId,
        outcome: 'failure',
        reason: created.error.code,
        meta: { workspaceId },
      })
      return created
    }

    auditMutation({
      entity: 'crm_newsletter',
      action: 'create',
      actorId,
      targetId: created.value.id,
      meta: { workspaceId, senderVerified: domain.value !== null },
    })
    return toDTO(workspaceId, created.value)
  },

  async update(
    actorId: string,
    workspaceId: string,
    newsletterId: string,
    dto: UpdateCrmNewsletterDTO,
  ): Promise<Result<CrmNewsletterDTO>> {
    const membership = await gate(actorId, workspaceId, 'EDIT')
    if (!membership.ok) return membership

    const existing = await CrmNewsletterRepository.findById(
      newsletterId,
      workspaceId,
    )
    if (!existing.ok) return existing

    if (dto.slug && dto.slug !== existing.value.slug) {
      const taken = await CrmNewsletterRepository.slugExists(
        workspaceId,
        dto.slug,
        newsletterId,
      )
      if (!taken.ok) return taken
      if (taken.value) return err(crmNewsletterSlugTaken())
    }

    const fromEmail = dto.fromEmail?.toLowerCase()
    let sendingDomainId: string | null | undefined
    if (fromEmail !== undefined) {
      const domain = await senderDomain(workspaceId, fromEmail)
      if (!domain.ok) return domain
      sendingDomainId = domain.value
    }

    const updated = await CrmNewsletterRepository.update(newsletterId, {
      name: dto.name,
      slug: dto.slug,
      description: dto.description,
      cadenceLabel: dto.cadenceLabel,
      fromName: dto.fromName,
      fromEmail,
      replyTo: dto.replyTo ? dto.replyTo.toLowerCase() : dto.replyTo,
      sendingDomainId,
      templateId: dto.templateId,
      doubleOptIn: dto.doubleOptIn,
      legalBasis: dto.legalBasis,
      archiveEnabled: dto.archiveEnabled,
      status: dto.status,
      updatedById: actorId,
    })
    if (!updated.ok) return updated

    const statusChanged =
      dto.status !== undefined && dto.status !== existing.value.status
    auditMutation({
      entity: 'crm_newsletter',
      action: statusChanged
        ? dto.status === 'ARCHIVED'
          ? 'archive'
          : 'reactivate'
        : 'update',
      actorId,
      targetId: newsletterId,
      meta: { workspaceId, fields: Object.keys(dto) },
    })
    return toDTO(workspaceId, updated.value)
  },

  async remove(
    actorId: string,
    workspaceId: string,
    newsletterId: string,
    now: Date = new Date(),
  ): Promise<Result<void>> {
    const membership = await gate(actorId, workspaceId, 'DELETE')
    if (!membership.ok) return membership

    const existing = await CrmNewsletterRepository.findById(
      newsletterId,
      workspaceId,
    )
    if (!existing.ok) return existing

    const deleted = await CrmNewsletterRepository.softDelete(newsletterId, now)
    if (!deleted.ok) return deleted

    auditMutation({
      entity: 'crm_newsletter',
      action: 'delete',
      actorId,
      targetId: newsletterId,
      meta: { workspaceId },
    })
    return ok(undefined)
  },
}
