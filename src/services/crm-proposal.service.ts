import { createHash } from 'node:crypto'
import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import { baseEmailUrl } from '@/lib/base-email-url'
import {
  conflict,
  crmProposalExpired,
  crmProposalNotAcceptable,
  forbidden,
  validationError,
} from '@/src/errors'
import {
  CRM_PROPOSAL_EXPIRABLE_STATUSES,
  defaultProposalValidUntil,
  formatProposalValidity,
  isCrmProposalExpired,
  isProposalValidityPast,
} from '@/src/lib/crm-proposal-validity'
import { sendCrmProposalExpiredEmail } from '@/src/lib/mail/crm/send-proposal-expired'
import { err, ok, type Result } from '@/src/lib/result'
import { indexSearchDocument } from '@/src/lib/search/index-hooks'
import {
  toCrmProposalDTO,
  toCrmProposalMetricsDTO,
  toCrmProposalPublicDTO,
} from '@/src/mappers/crm-proposal.mapper'
import { CrmCompanyRepository } from '@/src/repositories/crm-company.repository'
import { CrmOpportunityRepository } from '@/src/repositories/crm-opportunity.repository'
import { CrmPersonRepository } from '@/src/repositories/crm-person.repository'
import {
  CrmProposalRepository,
  CrmProposalViewRepository,
} from '@/src/repositories/crm-proposal.repository'
import { CrmProposalTemplateRepository } from '@/src/repositories/crm-proposal-template.repository'
import type {
  AcceptCrmProposalDTO,
  CreateCrmProposalDTO,
  ExtendCrmProposalValidityDTO,
  RecordCrmProposalViewDTO,
  UpdateCrmProposalDTO,
} from '@/src/schemas/crm-proposal.schema'
import type {
  CrmProposalDTO,
  CrmProposalMetricsDTO,
  CrmProposalPublicDTO,
} from '@/types/crm-proposal'
import {
  assertMember,
  assertModuleEnabled,
  assertModuleMember,
  assertModulePrivileged,
} from './authz'
import {
  notifyCrmProposalAccepted,
  notifyCrmProposalExpired,
  notifyCrmProposalViewed,
} from './crm-notifications'
import {
  CrmSettingsService,
  type ResolvedCrmSettings,
} from './crm-settings.service'
import { dispatchSteelAgentEvent } from './steel-agent-dispatcher'

function hashIp(ip: string): string {
  return createHash('sha256').update(ip).digest('hex')
}

/** Confere que company/contact/opportunity (quando informados) pertencem à workspace. */
async function assertRelatedEntities(
  workspaceId: string,
  refs: {
    companyId?: string | null
    contactId?: string | null
    opportunityId?: string | null
    responsibleId?: string
  },
): Promise<Result<true>> {
  if (refs.companyId) {
    const company = await CrmCompanyRepository.findById(
      refs.companyId,
      workspaceId,
    )
    if (!company.ok) return company
  }
  if (refs.contactId) {
    const contact = await CrmPersonRepository.findById(
      refs.contactId,
      workspaceId,
    )
    if (!contact.ok) return contact
  }
  if (refs.opportunityId) {
    const opportunity = await CrmOpportunityRepository.findById(
      refs.opportunityId,
      workspaceId,
    )
    if (!opportunity.ok) return opportunity
  }
  if (refs.responsibleId) {
    const membership = await assertMember(refs.responsibleId, workspaceId)
    if (!membership.ok) return membership
  }
  return ok(true)
}

/** Validade informada ou, sem ela, hoje + a validade padrão da workspace. */
export async function resolveProposalValidUntil(
  workspaceId: string,
  validUntil: Date | undefined,
): Promise<Result<Date>> {
  if (validUntil) return ok(validUntil)
  const settings = await CrmSettingsService.resolve(workspaceId)
  if (!settings.ok) return settings
  return ok(
    defaultProposalValidUntil(new Date(), settings.value.proposalValidityDays),
  )
}

function expiredMessage(validUntil: Date | null, action: string): string {
  const since = validUntil ? ` em ${formatProposalValidity(validUntil)}` : ''
  return `A validade desta proposta expirou${since}. ${action}`
}

/** Status de volta ao estender uma expirada: vista se já teve visita. */
async function statusAfterExtension(
  proposalId: string,
): Promise<Result<'SENT' | 'VIEWED'>> {
  const views = await CrmProposalViewRepository.countByProposal(proposalId)
  if (!views.ok) return views
  return ok(views.value > 0 ? 'VIEWED' : 'SENT')
}

const sameInstant = (a: Date | null, b: Date | null) =>
  (a?.getTime() ?? null) === (b?.getTime() ?? null)

export const CrmProposalService = {
  async list(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<CrmProposalDTO[]>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'documents',
      action: 'VIEW',
    })
    if (!membership.ok) return membership

    const result = await CrmProposalRepository.listByWorkspace(workspaceId)
    if (!result.ok) return result

    return ok(result.value.map(toCrmProposalDTO))
  },

  async getById(
    actorId: string,
    workspaceId: string,
    proposalId: string,
  ): Promise<Result<CrmProposalDTO>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'documents',
      action: 'VIEW',
    })
    if (!membership.ok) return membership

    const result = await CrmProposalRepository.findById(proposalId, workspaceId)
    if (!result.ok) return result

    return ok(toCrmProposalDTO(result.value))
  },

  async create(
    actorId: string,
    workspaceId: string,
    dto: CreateCrmProposalDTO,
  ): Promise<Result<CrmProposalDTO>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'documents',
      action: 'CREATE',
    })
    if (!membership.ok) return membership

    const related = await assertRelatedEntities(workspaceId, dto)
    if (!related.ok) return related

    let sections = dto.sections

    // Criação a partir de um template: copia as seções habilitadas por padrão
    // quando o payload não trouxe seções próprias.
    if (dto.templateId && sections.length === 0) {
      const template = await CrmProposalTemplateRepository.findById(
        dto.templateId,
        workspaceId,
      )
      if (!template.ok) return template

      sections = template.value.sections
        .filter(
          (section): section is typeof section & { defaultContent: object } =>
            section.enabled && section.defaultContent !== null,
        )
        .map((section) => ({
          type: section.type,
          order: section.order,
          enabled: true,
          content:
            section.defaultContent as CreateCrmProposalDTO['sections'][number]['content'],
        }))
    }

    const validUntil = await resolveProposalValidUntil(
      workspaceId,
      dto.validUntil,
    )
    if (!validUntil.ok) return validUntil

    const result = await CrmProposalRepository.create({
      workspaceId,
      createdById: actorId,
      name: dto.name,
      templateId: dto.templateId,
      companyId: dto.companyId,
      contactId: dto.contactId,
      opportunityId: dto.opportunityId,
      responsibleId: dto.responsibleId,
      validUntil: validUntil.value,
      sections,
    })

    if (!result.ok) {
      auditMutation({
        entity: 'crm_proposal',
        action: 'create',
        actorId,
        outcome: 'failure',
        reason: result.error.code,
      })
      return result
    }

    auditMutation({
      entity: 'crm_proposal',
      action: 'create',
      actorId,
      targetId: result.value.id,
    })

    void indexSearchDocument('crm-proposal', workspaceId, result.value.id)
    return ok(toCrmProposalDTO(result.value))
  },

  async update(
    actorId: string,
    workspaceId: string,
    proposalId: string,
    dto: UpdateCrmProposalDTO,
  ): Promise<Result<CrmProposalDTO>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'documents',
      action: 'EDIT',
    })
    if (!membership.ok) return membership

    const existing = await CrmProposalRepository.findById(
      proposalId,
      workspaceId,
    )
    if (!existing.ok) return existing

    const related = await assertRelatedEntities(workspaceId, {
      companyId: dto.companyId ?? undefined,
      contactId: dto.contactId ?? undefined,
      opportunityId: dto.opportunityId ?? undefined,
      responsibleId: dto.responsibleId,
    })
    if (!related.ok) return related

    const current = existing.value
    const validityChanged =
      dto.validUntil !== undefined &&
      !sameInstant(dto.validUntil, current.validUntil)
    const statusChanged =
      dto.status !== undefined && dto.status !== current.status
    const nextValidUntil =
      dto.validUntil !== undefined ? dto.validUntil : current.validUntil

    // Aceite fora da validade é bloqueado — estenda a validade antes.
    if (
      statusChanged &&
      dto.status === 'ACCEPTED' &&
      (current.status === 'EXPIRED' || isProposalValidityPast(nextValidUntil))
    ) {
      return err(
        crmProposalExpired(
          expiredMessage(
            current.validUntil,
            'Estenda a validade antes de marcá-la como aceita.',
          ),
        ),
      )
    }

    let status = dto.status
    let expiredAt: null | undefined
    // Mexer na validade/status de uma proposta expirada é "estender": só
    // OWNER/ADMIN (mesma regra de `extendValidity`).
    if (current.status === 'EXPIRED' && (validityChanged || statusChanged)) {
      if (!membership.value.isPrivileged) {
        return err(
          forbidden(
            'Só administradores do CRM podem alterar a validade de uma proposta expirada',
          ),
        )
      }
      if (isProposalValidityPast(nextValidUntil)) {
        return err(
          validationError('A nova validade precisa ser uma data futura'),
        )
      }
      if (!statusChanged) {
        const reopened = await statusAfterExtension(proposalId)
        if (!reopened.ok) return reopened
        status = reopened.value
      }
      expiredAt = null
    }

    const result = await CrmProposalRepository.update(proposalId, {
      name: dto.name,
      companyId: dto.companyId,
      contactId: dto.contactId,
      opportunityId: dto.opportunityId,
      responsibleId: dto.responsibleId,
      validUntil: dto.validUntil,
      status,
      expiredAt,
      sections: dto.sections,
      updatedById: actorId,
    })
    if (!result.ok) return result

    auditMutation({
      entity: 'crm_proposal',
      action: 'update',
      actorId,
      targetId: proposalId,
      meta: { fields: Object.keys(dto) },
    })

    void indexSearchDocument('crm-proposal', workspaceId, proposalId)
    return ok(toCrmProposalDTO(result.value))
  },

  async remove(
    actorId: string,
    workspaceId: string,
    proposalId: string,
  ): Promise<Result<void>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'documents',
      action: 'DELETE',
    })
    if (!membership.ok) return membership

    const existing = await CrmProposalRepository.findById(
      proposalId,
      workspaceId,
    )
    if (!existing.ok) return existing

    const result = await CrmProposalRepository.softDelete(proposalId)
    if (!result.ok) return result

    auditMutation({
      entity: 'crm_proposal',
      action: 'delete',
      actorId,
      targetId: proposalId,
    })

    void indexSearchDocument('crm-proposal', workspaceId, proposalId)
    return ok(undefined)
  },

  async reorder(
    actorId: string,
    workspaceId: string,
    orderedIds: string[],
  ): Promise<Result<void>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'documents',
      action: 'EDIT',
    })
    if (!membership.ok) return membership

    return CrmProposalRepository.reorder(workspaceId, orderedIds)
  },

  async getMetrics(
    actorId: string,
    workspaceId: string,
    proposalId: string,
  ): Promise<Result<CrmProposalMetricsDTO>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'documents',
      action: 'VIEW',
    })
    if (!membership.ok) return membership

    const existing = await CrmProposalRepository.findById(
      proposalId,
      workspaceId,
    )
    if (!existing.ok) return existing

    const metrics = await CrmProposalViewRepository.metricsFor(proposalId)
    if (!metrics.ok) return metrics

    return ok(toCrmProposalMetricsDTO(metrics.value))
  },

  async getPublicByShareToken(
    shareToken: string,
  ): Promise<Result<CrmProposalPublicDTO>> {
    const result = await CrmProposalRepository.findByShareToken(shareToken)
    if (!result.ok) return result

    // Rota pública: sem sessão, mas o módulo precisa estar habilitado.
    const moduleEnabled = await assertModuleEnabled(
      result.value.workspaceId,
      'CRM',
    )
    if (!moduleEnabled.ok) return moduleEnabled

    // A 1ª visualização pública marca a proposta como vista.
    if (result.value.status === 'SENT') {
      const viewed = await CrmProposalRepository.setStatus(
        result.value.id,
        'VIEWED',
      )
      if (viewed.ok) {
        void notifyCrmProposalViewed({
          workspaceId: result.value.workspaceId,
          proposal: result.value,
        })
        void dispatchSteelAgentEvent(
          result.value.workspaceId,
          'crm.proposal.viewed',
          {
            proposalId: result.value.id,
            name: result.value.name,
            responsibleId: result.value.responsibleId,
          },
        )
      }
    }

    return ok(toCrmProposalPublicDTO(result.value))
  },

  async recordView(
    shareToken: string,
    ip: string,
    dto: RecordCrmProposalViewDTO,
  ): Promise<Result<void>> {
    const proposal = await CrmProposalRepository.findByShareToken(shareToken)
    if (!proposal.ok) return proposal

    // Rota pública: sem sessão, mas o módulo precisa estar habilitado.
    const moduleEnabled = await assertModuleEnabled(
      proposal.value.workspaceId,
      'CRM',
    )
    if (!moduleEnabled.ok) return moduleEnabled

    const result = await CrmProposalViewRepository.record({
      proposalId: proposal.value.id,
      viewId: dto.viewId,
      ipHash: hashIp(ip),
      durationMs: dto.durationMs,
      reachedEnd: dto.reachedEnd,
      scrolledPct: dto.scrolledPct,
      referrer: dto.referrer,
    })
    if (!result.ok) return result

    return ok(undefined)
  },

  async send(
    actorId: string,
    workspaceId: string,
    proposalId: string,
  ): Promise<Result<CrmProposalDTO>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'documents',
      action: 'EDIT',
    })
    if (!membership.ok) return membership

    const existing = await CrmProposalRepository.findById(
      proposalId,
      workspaceId,
    )
    if (!existing.ok) return existing

    if (
      existing.value.status === 'EXPIRED' ||
      isProposalValidityPast(existing.value.validUntil)
    ) {
      return err(
        crmProposalExpired(
          expiredMessage(
            existing.value.validUntil,
            'Ajuste a data de validade antes de enviar.',
          ),
        ),
      )
    }

    const result = await CrmProposalRepository.setStatus(proposalId, 'SENT')
    if (!result.ok) return result

    auditMutation({
      entity: 'crm_proposal',
      action: 'update',
      actorId,
      targetId: proposalId,
      meta: { status: 'SENT' },
    })

    void indexSearchDocument('crm-proposal', workspaceId, proposalId)
    return ok(toCrmProposalDTO(result.value))
  },

  /**
   * OWNER/ADMIN estende a validade — inclusive de uma proposta já expirada,
   * que volta a SENT/VIEWED e pode ser aceita de novo. A nova data precisa
   * ser futura; propostas já respondidas (aceita/recusada) não mudam.
   */
  async extendValidity(
    actorId: string,
    workspaceId: string,
    proposalId: string,
    dto: ExtendCrmProposalValidityDTO,
  ): Promise<Result<CrmProposalDTO>> {
    const membership = await assertModulePrivileged(actorId, workspaceId, 'CRM')
    if (!membership.ok) return membership

    const existing = await CrmProposalRepository.findById(
      proposalId,
      workspaceId,
    )
    if (!existing.ok) return existing
    const current = existing.value

    if (current.status === 'ACCEPTED' || current.status === 'REJECTED') {
      return err(
        conflict(
          'Esta proposta já foi respondida pelo cliente — a validade não pode mais ser alterada',
        ),
      )
    }
    if (isProposalValidityPast(dto.validUntil)) {
      return err(validationError('A nova validade precisa ser uma data futura'))
    }

    let reopenedStatus: 'SENT' | 'VIEWED' | undefined
    if (current.status === 'EXPIRED') {
      const status = await statusAfterExtension(proposalId)
      if (!status.ok) return status
      reopenedStatus = status.value
    }

    const result = await CrmProposalRepository.update(proposalId, {
      validUntil: dto.validUntil,
      ...(reopenedStatus ? { status: reopenedStatus, expiredAt: null } : {}),
      updatedById: actorId,
    })
    if (!result.ok) return result

    auditMutation({
      entity: 'crm_proposal',
      action: 'update',
      actorId,
      targetId: proposalId,
      meta: {
        validityExtended: true,
        validUntil: dto.validUntil.toISOString(),
        previousValidUntil: current.validUntil?.toISOString() ?? null,
        reopenedFromExpired: reopenedStatus !== undefined,
      },
    })

    void indexSearchDocument('crm-proposal', workspaceId, proposalId)
    return ok(toCrmProposalDTO(result.value))
  },

  /**
   * Aceite do cliente pela página pública. Bloqueado após a validade (com a
   * data na mensagem) e para propostas que não estão mais aguardando
   * resposta. A escrita é condicional ao status, então aceites simultâneos
   * não gravam duas vezes.
   */
  async accept(
    shareToken: string,
    ip: string,
    dto: AcceptCrmProposalDTO,
  ): Promise<Result<CrmProposalPublicDTO>> {
    const proposal = await CrmProposalRepository.findByShareToken(shareToken)
    if (!proposal.ok) return proposal

    const moduleEnabled = await assertModuleEnabled(
      proposal.value.workspaceId,
      'CRM',
    )
    if (!moduleEnabled.ok) return moduleEnabled

    if (isCrmProposalExpired(proposal.value)) {
      return err(
        crmProposalExpired(
          expiredMessage(
            proposal.value.validUntil,
            'Ela não pode mais ser aceita — peça uma nova proposta ou a extensão da validade a quem a enviou.',
          ),
        ),
      )
    }
    if (
      !(CRM_PROPOSAL_EXPIRABLE_STATUSES as readonly string[]).includes(
        proposal.value.status,
      )
    ) {
      return err(
        crmProposalNotAcceptable(
          proposal.value.status === 'ACCEPTED'
            ? 'Esta proposta já foi aceita'
            : undefined,
        ),
      )
    }

    const accepted = await CrmProposalRepository.accept(proposal.value.id, {
      name: dto.name,
      at: new Date(),
    })
    if (!accepted.ok) return accepted
    if (!accepted.value) return err(crmProposalNotAcceptable())

    auditMutation({
      entity: 'crm_proposal',
      action: 'accept',
      actorId: null,
      targetId: proposal.value.id,
      meta: { via: 'public_link', ipHash: hashIp(ip) },
    })
    void notifyCrmProposalAccepted({
      workspaceId: proposal.value.workspaceId,
      proposal: proposal.value,
      acceptedByName: dto.name,
    })

    const updated = await CrmProposalRepository.findByShareToken(shareToken)
    if (!updated.ok) return updated

    void indexSearchDocument(
      'crm-proposal',
      updated.value.workspaceId,
      updated.value.id,
    )
    return ok(toCrmProposalPublicDTO(updated.value))
  },

  /**
   * Job diário: marca como EXPIRED as propostas enviadas/vistas cuja
   * validade terminou (vale até o fim do dia, São Paulo) e, se a workspace
   * mantiver o aviso ligado, manda e-mail ao responsável. Falha de e-mail
   * não interrompe o lote.
   */
  async expireDue(
    now: Date = new Date(),
  ): Promise<
    Result<{ candidates: number; expired: number; notified: number }>
  > {
    const candidates = await CrmProposalRepository.listExpirationCandidates(now)
    if (!candidates.ok) return candidates

    const settingsByWorkspace = new Map<string, ResolvedCrmSettings>()
    let expired = 0
    let notified = 0

    for (const proposal of candidates.value) {
      if (!isProposalValidityPast(proposal.validUntil, now)) continue

      const marked = await CrmProposalRepository.markExpired(proposal.id, now)
      if (!marked.ok) {
        logger.error('crm.proposal.expire_failed', {
          proposalId: proposal.id,
          workspaceId: proposal.workspaceId,
          reason: marked.error.code,
        })
        continue
      }
      if (!marked.value) continue
      expired += 1

      auditMutation({
        entity: 'crm_proposal',
        action: 'update',
        actorId: null,
        targetId: proposal.id,
        meta: { status: 'EXPIRED', via: 'crm-proposal-expiry' },
      })
      // In-app goes regardless of the workspace e-mail toggle below: each
      // user mutes it on their own notification preferences.
      await notifyCrmProposalExpired({
        workspaceId: proposal.workspaceId,
        proposal,
      })

      let settings = settingsByWorkspace.get(proposal.workspaceId)
      if (!settings) {
        const resolved = await CrmSettingsService.resolve(proposal.workspaceId)
        if (!resolved.ok) continue
        settings = resolved.value
        settingsByWorkspace.set(proposal.workspaceId, settings)
      }
      if (!settings.notifyProposalExpiry) continue

      try {
        await sendCrmProposalExpiredEmail({
          email: proposal.responsible.email,
          username: proposal.responsible.name,
          proposalName: proposal.name,
          workspaceName: proposal.workspace.name,
          validUntil: proposal.validUntil
            ? formatProposalValidity(proposal.validUntil)
            : '',
          proposalUrl: `${baseEmailUrl}/${proposal.workspace.slug}/crm/proposals/${proposal.id}`,
        })
        notified += 1
      } catch (error) {
        logger.warn('crm.proposal.expiry_email_failed', {
          proposalId: proposal.id,
          workspaceId: proposal.workspaceId,
          message: error instanceof Error ? error.message : String(error),
        })
      }
    }

    return ok({ candidates: candidates.value.length, expired, notified })
  },
}
