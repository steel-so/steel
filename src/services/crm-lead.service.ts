import type { CrmLead, CrmLeadStage, CrmPerson } from '@prisma/client'
import { auditMutation } from '@/lib/axiom/audit'
import {
  crmLeadAlreadyClosed,
  crmLeadDuplicate,
  crmLeadProposalNotFound,
  crmLeadReopenNotAllowed,
  crmLeadStageRequirementsNotMet,
  crmLeadStageTransitionInvalid,
  validationError,
} from '@/src/errors'
import {
  computeLeadScore,
  findLeadRoutingOwner,
} from '@/src/lib/crm-lead-rules'
import { err, ok, type Result } from '@/src/lib/result'
import { indexSearchDocument } from '@/src/lib/search/index-hooks'
import {
  crmLeadCreatedData,
  crmLeadDealData,
} from '@/src/lib/webhooks/payloads'
import {
  toCrmLeadContactAttemptDTO,
  toCrmLeadDTO,
  toCrmLeadMeetingDTO,
  toCrmLeadProposalPresentationDTO,
  toCrmLeadQualificationDTO,
  toCrmLeadReopeningDTO,
} from '@/src/mappers/crm-lead.mapper'
import { toCrmPersonDTO } from '@/src/mappers/crm-person.mapper'
import { toCrmProposalDTO } from '@/src/mappers/crm-proposal.mapper'
import { CrmLeadRepository } from '@/src/repositories/crm-lead.repository'
import { CrmLeadRoutingRuleRepository } from '@/src/repositories/crm-lead-routing-rule.repository'
import { CrmLeadScoringRuleRepository } from '@/src/repositories/crm-lead-scoring-rule.repository'
import { CrmPersonRepository } from '@/src/repositories/crm-person.repository'
import { CrmProposalRepository } from '@/src/repositories/crm-proposal.repository'
import {
  type CloseCrmLeadLostDTO,
  type CloseCrmLeadWonDTO,
  type CreateCrmLeadDTO,
  type CreateCrmLeadProposalDTO,
  CreateCrmLeadSchema,
  type CrmLeadIntakeInput,
  type ListCrmLeadsDTO,
  type RegisterCrmLeadContactAttemptDTO,
  type RegisterCrmLeadMeetingDTO,
  type RegisterCrmLeadProposalPresentationDTO,
  type ReopenCrmLeadDTO,
  type UpdateCrmLeadDTO,
  type UpsertCrmLeadQualificationDTO,
} from '@/src/schemas/crm-lead.schema'
import type { CrmWorkflowLeadEvent } from '@/src/schemas/crm-workflow.schema'
import type {
  CrmLeadContactAttemptDTO,
  CrmLeadDTO,
  CrmLeadMeetingDTO,
  CrmLeadProposalPresentationDTO,
  CrmLeadQualificationDTO,
  CrmLeadReopeningDTO,
} from '@/types/crm-lead'
import type { CrmPersonDTO } from '@/types/crm-person'
import type { CrmProposalDTO } from '@/types/crm-proposal'
import { assertModuleEnabled, assertModuleMember } from './authz'
import {
  notifyCrmDealClosed,
  notifyCrmLeadAssigned,
  notifyCrmLeadCreated,
} from './crm-notifications'
import { resolveProposalValidUntil } from './crm-proposal.service'
import { CrmSettingsService } from './crm-settings.service'
import { dispatchCrmWorkflowRecordEvent } from './crm-workflow-dispatcher'
import { dispatchSteelAgentEvent } from './steel-agent-dispatcher'
import { emitWebhookEvent } from './webhook-emitter'

/**
 * Quem está criando o lead. Canais públicos (API de integração, formulário)
 * não têm usuário autenticado: o registro é atribuído ao dono do canal
 * (`createdById` da chave/form) e a auditoria registra `actorId: null` com o
 * canal em `meta`, para não se passar por uma ação humana.
 */
export type CrmLeadIntakeActor =
  | { kind: 'user'; userId: string }
  | {
      kind: 'system'
      createdById: string
      via:
        | 'integration_api_key'
        | 'form'
        | 'apollo'
        | 'whatsapp_ad'
        | 'whatsapp_flow'
        | 'meeting'
        | 'whatsapp_catalog'
      refId: string
    }

/** Extras of the trusted internal channels (never accepted from the public). */
export interface CrmLeadIntakeOptions {
  /**
   * Bulk mode (imports): keeps scoring, routing, workflows and the search
   * index but skips the per-lead Slack message, outbound webhook and owner
   * notification — the importer sends one summary at the end.
   */
  quiet?: boolean
  /** Origin system and id, unique per workspace (`CrmLead.externalSource`). */
  external?: { source: string; id: string }
}

export interface CrmLeadIntakeResult {
  lead: CrmLeadDTO
  /** false = já existia um lead em aberto com o mesmo e-mail/telefone. */
  created: boolean
}

/** Chaves de comparação: e-mail sem caixa/espaços, telefone só com dígitos. */
function contactKeys(emails: string[], phones: string[]) {
  return {
    emails: [
      ...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean)),
    ],
    phones: [
      ...new Set(phones.map((p) => p.replace(/\D/g, '')).filter(Boolean)),
    ],
  }
}

/**
 * Pessoa que representa o lead convertido. Idempotente: reaproveita a já
 * vinculada ao lead; senão uma pessoa existente da workspace com o mesmo
 * e-mail/telefone; só então cria uma nova.
 */
async function resolvePersonForLead(
  workspaceId: string,
  actorId: string,
  lead: CrmLead,
): Promise<Result<{ person: CrmPerson; created: boolean }>> {
  if (lead.convertedPersonId) {
    const linked = await CrmPersonRepository.findById(
      lead.convertedPersonId,
      workspaceId,
    )
    if (linked.ok) return ok({ person: linked.value, created: false })
    // Pessoa vinculada foi excluída: segue para o dedupe/criação.
    if (linked.error.code !== 'RESOURCE_NOT_FOUND') return linked
  }

  const existing = await CrmPersonRepository.findFirstByContacts(
    workspaceId,
    contactKeys(lead.emails, lead.phones),
  )
  if (!existing.ok) return existing
  if (existing.value) return ok({ person: existing.value, created: false })

  const created = await CrmPersonRepository.create({
    workspaceId,
    createdById: actorId,
    name: lead.name,
    emails: lead.emails,
    phones: lead.phones,
    city: lead.city ?? undefined,
    jobTitle: lead.jobTitle ?? undefined,
    linkedin: lead.linkedin ?? undefined,
  })
  if (!created.ok) return created
  return ok({ person: created.value, created: true })
}

/** Ordem das etapas abertas do painel (índice = posição no funil). */
const OPEN_STAGE_ORDER: CrmLeadStage[] = [
  'RECEIVED',
  'IN_CONTACT',
  'QUALIFIED',
  'OPPORTUNITY',
  'PROPOSAL',
]

/**
 * Etapa mais avançada que os registros do lead sustentam — a mesma regra de
 * gate do avanço normal: IN_CONTACT exige uma tentativa de contato,
 * QUALIFIED um contato efetivo, OPPORTUNITY a qualificação e PROPOSAL uma
 * proposta vinculada. Reabrir nunca pula um gate.
 */
async function furthestReachableStage(
  workspaceId: string,
  leadId: string,
): Promise<Result<CrmLeadStage>> {
  const [attempts, qualification, proposal] = await Promise.all([
    CrmLeadRepository.listContactAttempts(leadId),
    CrmLeadRepository.findQualification(leadId),
    CrmProposalRepository.findLatestByLeadId(leadId, workspaceId),
  ])
  if (!attempts.ok) return attempts
  if (!qualification.ok) return qualification
  if (!proposal.ok) return proposal

  if (proposal.value && qualification.value) return ok('PROPOSAL')
  if (qualification.value) return ok('OPPORTUNITY')
  if (attempts.value.some((a) => a.outcome === 'REACHED')) {
    return ok('QUALIFIED')
  }
  if (attempts.value.length > 0) return ok('IN_CONTACT')
  return ok('RECEIVED')
}

/** Dispara os workflows de lead para um update (best-effort, não bloqueia). */
function emitLeadUpdated(
  workspaceId: string,
  actorUserId: string,
  before: CrmLead,
  after: CrmLead,
  changedFields: string[],
): void {
  const leadEvents: CrmWorkflowLeadEvent[] = []
  if (before.stage !== after.stage) leadEvents.push('stage-changed')
  if (before.closeResult !== after.closeResult) {
    if (after.closeResult === 'WON') leadEvents.push('won')
    if (after.closeResult === 'LOST') leadEvents.push('lost')
  }
  void dispatchCrmWorkflowRecordEvent({
    workspaceId,
    actorUserId,
    entity: 'lead',
    event: 'updated',
    record: toCrmLeadDTO(after),
    changedFields,
    leadEvents,
  })
}

export const CrmLeadService = {
  async list(
    actorId: string,
    workspaceId: string,
    filters: ListCrmLeadsDTO,
  ): Promise<Result<CrmLeadDTO[]>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'leads',
      action: 'VIEW',
    })
    if (!membership.ok) return membership

    const result = await CrmLeadRepository.listByWorkspace(workspaceId, {
      stage: filters.stage,
    })
    if (!result.ok) return result

    return ok(result.value.map(toCrmLeadDTO))
  },

  async getById(
    actorId: string,
    workspaceId: string,
    leadId: string,
  ): Promise<Result<CrmLeadDTO>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'leads',
      action: 'VIEW',
    })
    if (!membership.ok) return membership

    const result = await CrmLeadRepository.findById(leadId, workspaceId)
    if (!result.ok) return result

    return ok(toCrmLeadDTO(result.value))
  },

  /**
   * Porta de entrada única de leads — criação manual, API de integração e
   * formulário público. Aplica o mesmo contrato (`CreateCrmLeadSchema`),
   * dedupe contra leads em aberto, pontuação, roteamento de dono, auditoria
   * e workflows. Não checa membership (quem chama já autenticou o canal),
   * mas recusa quando o módulo CRM está desabilitado para a workspace.
   */
  async intake(
    workspaceId: string,
    actor: CrmLeadIntakeActor,
    input: CrmLeadIntakeInput,
    options: CrmLeadIntakeOptions = {},
  ): Promise<Result<CrmLeadIntakeResult>> {
    const parsed = CreateCrmLeadSchema.safeParse(input)
    if (!parsed.success) {
      return err(validationError('Dados inválidos', parsed.error.issues))
    }
    const dto: CreateCrmLeadDTO = parsed.data

    // Porta única de todos os canais (inclusive os públicos, sem sessão):
    // nenhum lead entra numa workspace com o CRM desabilitado.
    const moduleEnabled = await assertModuleEnabled(workspaceId, 'CRM')
    if (!moduleEnabled.ok) return moduleEnabled

    const createdById = actor.kind === 'user' ? actor.userId : actor.createdById
    const auditActorId = actor.kind === 'user' ? actor.userId : null
    const channelMeta =
      actor.kind === 'system'
        ? { actor: 'system', via: actor.via, refId: actor.refId }
        : {}

    const duplicate = await CrmLeadRepository.findOpenByContacts(
      workspaceId,
      contactKeys(dto.emails, dto.phones),
    )
    if (!duplicate.ok) return duplicate
    if (duplicate.value) {
      auditMutation({
        entity: 'crm_lead',
        action: 'create',
        actorId: auditActorId,
        targetId: duplicate.value.id,
        meta: { ...channelMeta, deduplicated: true },
      })
      return ok({ lead: toCrmLeadDTO(duplicate.value), created: false })
    }

    const subject = {
      name: dto.name,
      emails: dto.emails,
      phones: dto.phones,
      company: dto.company ?? null,
      jobTitle: dto.jobTitle ?? null,
      source: dto.source ?? null,
      city: dto.city ?? null,
    }

    const [scoringRules, routingRules] = await Promise.all([
      CrmLeadScoringRuleRepository.listActiveByWorkspace(workspaceId),
      CrmLeadRoutingRuleRepository.listActiveByWorkspace(workspaceId),
    ])
    if (!scoringRules.ok) return scoringRules
    if (!routingRules.ok) return routingRules

    const score = computeLeadScore(subject, scoringRules.value)
    const ownerId = findLeadRoutingOwner(subject, routingRules.value)

    const result = await CrmLeadRepository.create({
      workspaceId,
      createdById,
      name: dto.name,
      emails: dto.emails,
      phones: dto.phones,
      company: dto.company,
      jobTitle: dto.jobTitle,
      city: dto.city,
      linkedin: dto.linkedin,
      source: dto.source,
      channel: dto.channel,
      score,
      ownerId,
      externalSource: options.external?.source,
      externalId: options.external?.id,
    })

    if (!result.ok) {
      auditMutation({
        entity: 'crm_lead',
        action: 'create',
        actorId: auditActorId,
        outcome: 'failure',
        reason: result.error.code,
        meta: channelMeta,
      })
      return result
    }

    auditMutation({
      entity: 'crm_lead',
      action: 'create',
      actorId: auditActorId,
      targetId: result.value.id,
      meta: { ...channelMeta, score, ownerId },
    })

    const lead = toCrmLeadDTO(result.value)
    void dispatchCrmWorkflowRecordEvent({
      workspaceId,
      actorUserId: createdById,
      entity: 'lead',
      event: 'created',
      record: lead,
    })
    void dispatchSteelAgentEvent(workspaceId, 'crm.lead.created', {
      leadId: lead.id,
      name: lead.name,
    })
    if (!options.quiet) {
      void notifyCrmLeadCreated({ workspaceId, lead })
      void emitWebhookEvent(workspaceId, 'crm.lead.created', () =>
        crmLeadCreatedData(lead),
      )
    }
    if (ownerId && !options.quiet) {
      void notifyCrmLeadAssigned({
        workspaceId,
        lead: result.value,
        ownerId,
        actorId: auditActorId,
        routed: true,
      })
    }

    void indexSearchDocument('crm-lead', workspaceId, lead.id)
    return ok({ lead, created: true })
  },

  async create(
    actorId: string,
    workspaceId: string,
    dto: CrmLeadIntakeInput,
  ): Promise<Result<CrmLeadDTO>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'leads',
      action: 'CREATE',
    })
    if (!membership.ok) return membership

    const result = await CrmLeadService.intake(
      workspaceId,
      { kind: 'user', userId: actorId },
      dto,
    )
    if (!result.ok) return result
    // Na criação manual o usuário precisa saber que o lead já existe.
    if (!result.value.created) return err(crmLeadDuplicate())

    return ok(result.value.lead)
  },

  async update(
    actorId: string,
    workspaceId: string,
    leadId: string,
    dto: UpdateCrmLeadDTO,
  ): Promise<Result<CrmLeadDTO>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'leads',
      action: 'EDIT',
    })
    if (!membership.ok) return membership

    const existing = await CrmLeadRepository.findById(leadId, workspaceId)
    if (!existing.ok) return existing

    let score: number | undefined
    const scoreRelevantFields =
      dto.name !== undefined ||
      dto.emails !== undefined ||
      dto.phones !== undefined ||
      dto.company !== undefined ||
      dto.jobTitle !== undefined ||
      dto.source !== undefined ||
      dto.city !== undefined

    if (scoreRelevantFields) {
      const scoringRules =
        await CrmLeadScoringRuleRepository.listActiveByWorkspace(workspaceId)
      if (!scoringRules.ok) return scoringRules

      score = computeLeadScore(
        {
          name: dto.name ?? existing.value.name,
          emails: dto.emails ?? existing.value.emails,
          phones: dto.phones ?? existing.value.phones,
          company: dto.company ?? existing.value.company,
          jobTitle: dto.jobTitle ?? existing.value.jobTitle,
          source: dto.source ?? existing.value.source,
          city: dto.city ?? existing.value.city,
        },
        scoringRules.value,
      )
    }

    const result = await CrmLeadRepository.update(leadId, {
      name: dto.name,
      emails: dto.emails,
      phones: dto.phones,
      company: dto.company,
      jobTitle: dto.jobTitle,
      city: dto.city,
      linkedin: dto.linkedin,
      source: dto.source,
      channel: dto.channel,
      ownerId: dto.ownerId,
      score,
      updatedById: actorId,
    })
    if (!result.ok) return result

    auditMutation({
      entity: 'crm_lead',
      action: 'update',
      actorId,
      targetId: leadId,
      meta: { fields: Object.keys(dto) },
    })

    emitLeadUpdated(
      workspaceId,
      actorId,
      existing.value,
      result.value,
      Object.keys(dto),
    )
    if (
      result.value.ownerId &&
      result.value.ownerId !== existing.value.ownerId
    ) {
      void notifyCrmLeadAssigned({
        workspaceId,
        lead: result.value,
        ownerId: result.value.ownerId,
        actorId,
      })
    }

    void indexSearchDocument('crm-lead', workspaceId, leadId)
    return ok(toCrmLeadDTO(result.value))
  },

  async remove(
    actorId: string,
    workspaceId: string,
    leadId: string,
  ): Promise<Result<void>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'leads',
      action: 'DELETE',
    })
    if (!membership.ok) return membership

    const existing = await CrmLeadRepository.findById(leadId, workspaceId)
    if (!existing.ok) return existing

    const result = await CrmLeadRepository.softDelete(leadId)
    if (!result.ok) return result

    auditMutation({
      entity: 'crm_lead',
      action: 'delete',
      actorId,
      targetId: leadId,
    })

    void dispatchCrmWorkflowRecordEvent({
      workspaceId,
      actorUserId: actorId,
      entity: 'lead',
      event: 'deleted',
      record: toCrmLeadDTO(existing.value),
    })

    void indexSearchDocument('crm-lead', workspaceId, leadId)
    return ok(undefined)
  },

  async reorder(
    actorId: string,
    workspaceId: string,
    orderedIds: string[],
  ): Promise<Result<void>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'leads',
      action: 'EDIT',
    })
    if (!membership.ok) return membership

    return CrmLeadRepository.reorder(workspaceId, orderedIds)
  },

  /**
   * Rota legada `POST .../convert`. A conversão em pessoa faz parte do
   * pipeline: só acontece ao fechar como ganho (`closeWon`). Aqui apenas
   * devolvemos, de forma idempotente, a pessoa de um lead já ganho — para
   * leads ainda abertos o cliente recebe um erro explicando o caminho.
   */
  async convert(
    actorId: string,
    workspaceId: string,
    leadId: string,
  ): Promise<Result<CrmPersonDTO>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'leads',
      action: 'EDIT',
    })
    if (!membership.ok) return membership

    const lead = await CrmLeadRepository.findById(leadId, workspaceId)
    if (!lead.ok) return lead

    if (lead.value.closeResult !== 'WON') {
      return err(
        crmLeadStageTransitionInvalid(
          'A conversão em pessoa acontece ao fechar o lead como ganho na etapa "Proposta"',
        ),
      )
    }

    const resolved = await resolvePersonForLead(
      workspaceId,
      actorId,
      lead.value,
    )
    if (!resolved.ok) return resolved

    if (lead.value.convertedPersonId !== resolved.value.person.id) {
      const linked = await CrmLeadRepository.update(leadId, {
        convertedPersonId: resolved.value.person.id,
        updatedById: actorId,
      })
      if (!linked.ok) return linked

      auditMutation({
        entity: 'crm_lead',
        action: 'update',
        actorId,
        targetId: leadId,
        meta: {
          converted: true,
          personId: resolved.value.person.id,
          personCreated: resolved.value.created,
        },
      })
    }

    void indexSearchDocument('crm-lead', workspaceId, leadId)
    void indexSearchDocument(
      'crm-person',
      workspaceId,
      resolved.value.person.id,
    )
    return ok(toCrmPersonDTO(resolved.value.person))
  },

  async getActiveProposal(
    actorId: string,
    workspaceId: string,
    leadId: string,
  ): Promise<Result<CrmProposalDTO | null>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'documents',
      action: 'VIEW',
    })
    if (!membership.ok) return membership

    const lead = await CrmLeadRepository.findById(leadId, workspaceId)
    if (!lead.ok) return lead

    const result = await CrmProposalRepository.findLatestByLeadId(
      leadId,
      workspaceId,
    )
    if (!result.ok) return result

    return ok(result.value ? toCrmProposalDTO(result.value) : null)
  },

  // --- 01 Recebido -> 02 Em Contato / 02 -> 03 Qualificado ---

  async registerContactAttempt(
    actorId: string,
    workspaceId: string,
    leadId: string,
    dto: RegisterCrmLeadContactAttemptDTO,
  ): Promise<Result<{ lead: CrmLeadDTO; attempt: CrmLeadContactAttemptDTO }>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'leads',
      action: 'EDIT',
    })
    if (!membership.ok) return membership

    const lead = await CrmLeadRepository.findById(leadId, workspaceId)
    if (!lead.ok) return lead
    if (lead.value.stage === 'CLOSED') return err(crmLeadAlreadyClosed())

    const attempt = await CrmLeadRepository.createContactAttempt({
      leadId,
      workspaceId,
      createdById: actorId,
      contactedWith: dto.contactedWith,
      channel: dto.channel,
      outcome: dto.outcome,
      occurredAt: dto.occurredAt,
      note: dto.note,
    })
    if (!attempt.ok) return attempt

    let nextStage: CrmLeadStage | undefined
    if (lead.value.stage === 'RECEIVED') nextStage = 'IN_CONTACT'
    else if (lead.value.stage === 'IN_CONTACT' && dto.outcome === 'REACHED')
      nextStage = 'QUALIFIED'

    let updatedLead = lead.value
    if (nextStage) {
      const advanced = await CrmLeadRepository.update(leadId, {
        stage: nextStage,
        updatedById: actorId,
      })
      if (!advanced.ok) return advanced
      updatedLead = advanced.value
    }

    auditMutation({
      entity: 'crm_lead',
      action: 'update',
      actorId,
      targetId: leadId,
      meta: { contactAttempt: dto.outcome, stage: updatedLead.stage },
    })

    if (nextStage) {
      emitLeadUpdated(workspaceId, actorId, lead.value, updatedLead, ['stage'])
    }

    void indexSearchDocument('crm-lead', workspaceId, leadId)
    return ok({
      lead: toCrmLeadDTO(updatedLead),
      attempt: toCrmLeadContactAttemptDTO(attempt.value),
    })
  },

  async listContactAttempts(
    actorId: string,
    workspaceId: string,
    leadId: string,
  ): Promise<Result<CrmLeadContactAttemptDTO[]>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'leads',
      action: 'VIEW',
    })
    if (!membership.ok) return membership

    const lead = await CrmLeadRepository.findById(leadId, workspaceId)
    if (!lead.ok) return lead

    const result = await CrmLeadRepository.listContactAttempts(leadId)
    if (!result.ok) return result

    return ok(result.value.map(toCrmLeadContactAttemptDTO))
  },

  // --- 02: produtos/serviços de interesse ---

  async setInterestProducts(
    actorId: string,
    workspaceId: string,
    leadId: string,
    productIds: string[],
  ): Promise<Result<CrmLeadDTO>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'leads',
      action: 'EDIT',
    })
    if (!membership.ok) return membership

    const lead = await CrmLeadRepository.findById(leadId, workspaceId)
    if (!lead.ok) return lead

    const result = await CrmLeadRepository.setInterestProducts(
      leadId,
      productIds,
    )
    if (!result.ok) return result

    auditMutation({
      entity: 'crm_lead',
      action: 'update',
      actorId,
      targetId: leadId,
      meta: { interestProducts: productIds.length },
    })

    return ok(toCrmLeadDTO(lead.value))
  },

  // --- 03 Lead Qualificado -> 04 Interesse/Oportunidade ---

  async upsertQualification(
    actorId: string,
    workspaceId: string,
    leadId: string,
    dto: UpsertCrmLeadQualificationDTO,
  ): Promise<
    Result<{ lead: CrmLeadDTO; qualification: CrmLeadQualificationDTO }>
  > {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'leads',
      action: 'EDIT',
    })
    if (!membership.ok) return membership

    const lead = await CrmLeadRepository.findById(leadId, workspaceId)
    if (!lead.ok) return lead
    if (lead.value.stage === 'CLOSED') return err(crmLeadAlreadyClosed())

    const existing = await CrmLeadRepository.findQualification(leadId)
    if (!existing.ok) return existing
    if (!existing.value && lead.value.stage !== 'QUALIFIED') {
      return err(
        crmLeadStageTransitionInvalid(
          'Qualifique o lead somente a partir da etapa "Lead Qualificado"',
        ),
      )
    }

    const qualification = await CrmLeadRepository.upsertQualification({
      leadId,
      qualifiedById: actorId,
      expectedCloseAt: dto.expectedCloseAt,
      decisionMakerName: dto.decisionMakerName,
      decisionMakerRole: dto.decisionMakerRole,
    })
    if (!qualification.ok) return qualification

    let updatedLead = lead.value
    if (lead.value.stage === 'QUALIFIED') {
      const advanced = await CrmLeadRepository.update(leadId, {
        stage: 'OPPORTUNITY',
        updatedById: actorId,
      })
      if (!advanced.ok) return advanced
      updatedLead = advanced.value
    }

    auditMutation({
      entity: 'crm_lead',
      action: 'update',
      actorId,
      targetId: leadId,
      meta: { qualification: true, stage: updatedLead.stage },
    })

    if (updatedLead.stage !== lead.value.stage) {
      emitLeadUpdated(workspaceId, actorId, lead.value, updatedLead, ['stage'])
    }

    void indexSearchDocument('crm-lead', workspaceId, leadId)
    return ok({
      lead: toCrmLeadDTO(updatedLead),
      qualification: toCrmLeadQualificationDTO(qualification.value),
    })
  },

  async getQualification(
    actorId: string,
    workspaceId: string,
    leadId: string,
  ): Promise<Result<CrmLeadQualificationDTO | null>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'leads',
      action: 'VIEW',
    })
    if (!membership.ok) return membership

    const lead = await CrmLeadRepository.findById(leadId, workspaceId)
    if (!lead.ok) return lead

    const result = await CrmLeadRepository.findQualification(leadId)
    if (!result.ok) return result

    return ok(result.value ? toCrmLeadQualificationDTO(result.value) : null)
  },

  // --- 04 Interesse/Oportunidade ---

  async registerMeeting(
    actorId: string,
    workspaceId: string,
    leadId: string,
    dto: RegisterCrmLeadMeetingDTO,
  ): Promise<Result<{ lead: CrmLeadDTO; meeting: CrmLeadMeetingDTO }>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'leads',
      action: 'EDIT',
    })
    if (!membership.ok) return membership

    const lead = await CrmLeadRepository.findById(leadId, workspaceId)
    if (!lead.ok) return lead
    if (lead.value.stage !== 'OPPORTUNITY') {
      return err(
        crmLeadStageTransitionInvalid(
          'Registre reuniões somente na etapa "Interesse/Oportunidade"',
        ),
      )
    }

    const meeting = await CrmLeadRepository.createMeeting({
      leadId,
      workspaceId,
      createdById: actorId,
      scheduledAt: dto.scheduledAt,
      format: dto.format,
      contactPersonId: dto.contactPersonId,
      contactPersonName: dto.contactPersonName,
      interestDetails: dto.interestDetails,
      identifiedNeed: dto.identifiedNeed,
    })
    if (!meeting.ok) return meeting

    auditMutation({
      entity: 'crm_lead',
      action: 'update',
      actorId,
      targetId: leadId,
      meta: { meeting: true },
    })

    void indexSearchDocument('crm-lead', workspaceId, leadId)
    return ok({
      lead: toCrmLeadDTO(lead.value),
      meeting: toCrmLeadMeetingDTO(meeting.value),
    })
  },

  async listMeetings(
    actorId: string,
    workspaceId: string,
    leadId: string,
  ): Promise<Result<CrmLeadMeetingDTO[]>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'leads',
      action: 'VIEW',
    })
    if (!membership.ok) return membership

    const lead = await CrmLeadRepository.findById(leadId, workspaceId)
    if (!lead.ok) return lead

    const result = await CrmLeadRepository.listMeetings(leadId)
    if (!result.ok) return result

    return ok(result.value.map(toCrmLeadMeetingDTO))
  },

  // OPPORTUNITY -> PROPOSAL: criar a proposta é a transição.
  async createProposal(
    actorId: string,
    workspaceId: string,
    leadId: string,
    dto: CreateCrmLeadProposalDTO,
  ): Promise<Result<{ lead: CrmLeadDTO; proposal: CrmProposalDTO }>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'documents',
      action: 'CREATE',
    })
    if (!membership.ok) return membership

    const lead = await CrmLeadRepository.findById(leadId, workspaceId)
    if (!lead.ok) return lead
    if (lead.value.stage !== 'OPPORTUNITY') {
      return err(
        crmLeadStageTransitionInvalid(
          'Crie a proposta somente a partir da etapa "Interesse/Oportunidade"',
        ),
      )
    }

    const meetings = await CrmLeadRepository.listMeetings(leadId)
    if (!meetings.ok) return meetings
    if (meetings.value.length === 0) {
      return err(
        crmLeadStageRequirementsNotMet(
          'Registre ao menos uma reunião antes de criar a proposta',
        ),
      )
    }

    const validUntil = await resolveProposalValidUntil(
      workspaceId,
      dto.validUntil,
    )
    if (!validUntil.ok) return validUntil

    const proposal = await CrmProposalRepository.create({
      workspaceId,
      createdById: actorId,
      name: dto.name,
      templateId: dto.templateId,
      leadId,
      responsibleId: actorId,
      validUntil: validUntil.value,
      sections: [],
    })
    if (!proposal.ok) return proposal

    const advanced = await CrmLeadRepository.update(leadId, {
      stage: 'PROPOSAL',
      updatedById: actorId,
    })
    if (!advanced.ok) return advanced

    auditMutation({
      entity: 'crm_lead',
      action: 'update',
      actorId,
      targetId: leadId,
      meta: { proposalCreated: proposal.value.id },
    })

    emitLeadUpdated(workspaceId, actorId, lead.value, advanced.value, ['stage'])

    void indexSearchDocument('crm-lead', workspaceId, leadId)
    void indexSearchDocument('crm-proposal', workspaceId, proposal.value.id)
    return ok({
      lead: toCrmLeadDTO(advanced.value),
      proposal: toCrmProposalDTO(proposal.value),
    })
  },

  // --- 05 Proposta (inclui o Termômetro de Interesse) ---

  async registerProposalPresentation(
    actorId: string,
    workspaceId: string,
    leadId: string,
    proposalId: string,
    dto: RegisterCrmLeadProposalPresentationDTO,
  ): Promise<
    Result<{ lead: CrmLeadDTO; presentation: CrmLeadProposalPresentationDTO }>
  > {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'leads',
      action: 'EDIT',
    })
    if (!membership.ok) return membership

    const lead = await CrmLeadRepository.findById(leadId, workspaceId)
    if (!lead.ok) return lead
    if (lead.value.stage !== 'PROPOSAL') {
      return err(
        crmLeadStageTransitionInvalid(
          'Registre apresentações somente na etapa "Proposta"',
        ),
      )
    }

    const proposal = await CrmProposalRepository.findById(
      proposalId,
      workspaceId,
    )
    if (!proposal.ok) return proposal
    if (proposal.value.leadId !== leadId) {
      return err(crmLeadProposalNotFound())
    }

    const presentation = await CrmLeadRepository.createProposalPresentation({
      leadId,
      proposalId,
      createdById: actorId,
      presentedAt: dto.presentedAt,
      format: dto.format,
      amount: dto.amount,
      interestLevel: dto.interestLevel,
      interactionsCount: dto.interactionsCount,
    })
    if (!presentation.ok) return presentation

    auditMutation({
      entity: 'crm_lead',
      action: 'update',
      actorId,
      targetId: leadId,
      meta: { proposalPresentation: true, interestLevel: dto.interestLevel },
    })

    void indexSearchDocument('crm-lead', workspaceId, leadId)
    return ok({
      lead: toCrmLeadDTO(lead.value),
      presentation: toCrmLeadProposalPresentationDTO(presentation.value),
    })
  },

  async listProposalPresentations(
    actorId: string,
    workspaceId: string,
    leadId: string,
    proposalId: string,
  ): Promise<Result<CrmLeadProposalPresentationDTO[]>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'leads',
      action: 'VIEW',
    })
    if (!membership.ok) return membership

    const lead = await CrmLeadRepository.findById(leadId, workspaceId)
    if (!lead.ok) return lead

    const proposal = await CrmProposalRepository.findById(
      proposalId,
      workspaceId,
    )
    if (!proposal.ok) return proposal
    if (proposal.value.leadId !== leadId) {
      return err(crmLeadProposalNotFound())
    }

    const result = await CrmLeadRepository.listProposalPresentations(
      leadId,
      proposalId,
    )
    if (!result.ok) return result

    return ok(result.value.map(toCrmLeadProposalPresentationDTO))
  },

  // --- 06 Fechado/Encerrado ---

  async closeWon(
    actorId: string,
    workspaceId: string,
    leadId: string,
    dto: CloseCrmLeadWonDTO,
  ): Promise<Result<CrmPersonDTO>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'leads',
      action: 'EDIT',
    })
    if (!membership.ok) return membership

    const lead = await CrmLeadRepository.findById(leadId, workspaceId)
    if (!lead.ok) return lead
    if (lead.value.stage === 'CLOSED') return err(crmLeadAlreadyClosed())
    if (lead.value.stage !== 'PROPOSAL') {
      return err(
        crmLeadStageTransitionInvalid(
          'Só é possível fechar como ganho a partir da etapa "Proposta"',
        ),
      )
    }

    const presentations =
      await CrmLeadRepository.listProposalPresentations(leadId)
    if (!presentations.ok) return presentations
    if (presentations.value.length === 0) {
      return err(
        crmLeadStageRequirementsNotMet(
          'Registre a apresentação da proposta antes de fechar como ganho',
        ),
      )
    }

    const resolved = await resolvePersonForLead(
      workspaceId,
      actorId,
      lead.value,
    )
    if (!resolved.ok) return resolved
    const person = resolved.value.person

    const updated = await CrmLeadRepository.update(leadId, {
      stage: 'CLOSED',
      closeResult: 'WON',
      closedAt: new Date(),
      contractSignedAt: dto.contractSignedAt,
      billingType: dto.billingType,
      closedAmount: dto.closedAmount,
      convertedPersonId: person.id,
      updatedById: actorId,
    })
    if (!updated.ok) return updated

    auditMutation({
      entity: 'crm_lead',
      action: 'update',
      actorId,
      targetId: leadId,
      meta: {
        closed: 'WON',
        personId: person.id,
        personCreated: resolved.value.created,
      },
    })

    emitLeadUpdated(workspaceId, actorId, lead.value, updated.value, [
      'stage',
      'closeResult',
      'convertedPersonId',
    ])
    void notifyCrmDealClosed({
      workspaceId,
      lead: updated.value,
      result: 'WON',
      actorId,
    })
    void emitWebhookEvent(workspaceId, 'crm.deal.won', () =>
      crmLeadDealData({ lead: updated.value, actorId }),
    )

    void indexSearchDocument('crm-lead', workspaceId, leadId)
    void indexSearchDocument('crm-person', workspaceId, person.id)
    return ok(toCrmPersonDTO(person))
  },

  async closeLost(
    actorId: string,
    workspaceId: string,
    leadId: string,
    dto: CloseCrmLeadLostDTO,
  ): Promise<Result<CrmLeadDTO>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'leads',
      action: 'EDIT',
    })
    if (!membership.ok) return membership

    const lead = await CrmLeadRepository.findById(leadId, workspaceId)
    if (!lead.ok) return lead
    if (lead.value.stage === 'CLOSED') return err(crmLeadAlreadyClosed())

    if (lead.value.stage === 'PROPOSAL') {
      const presentations =
        await CrmLeadRepository.listProposalPresentations(leadId)
      if (!presentations.ok) return presentations
      if (presentations.value.length === 0) {
        return err(
          crmLeadStageRequirementsNotMet(
            'Registre a apresentação da proposta antes de registrar o resultado',
          ),
        )
      }
    }

    const updated = await CrmLeadRepository.update(leadId, {
      stage: 'CLOSED',
      closeResult: 'LOST',
      closedAt: new Date(),
      lostReason: dto.lostReason,
      lostNote: dto.lostNote,
      retryAt: dto.retryAt,
      updatedById: actorId,
    })
    if (!updated.ok) return updated

    auditMutation({
      entity: 'crm_lead',
      action: 'update',
      actorId,
      targetId: leadId,
      meta: { closed: 'LOST', reason: dto.lostReason },
    })

    emitLeadUpdated(workspaceId, actorId, lead.value, updated.value, [
      'stage',
      'closeResult',
      'lostReason',
    ])
    void notifyCrmDealClosed({
      workspaceId,
      lead: updated.value,
      result: 'LOST',
      actorId,
    })
    void emitWebhookEvent(workspaceId, 'crm.deal.lost', () =>
      crmLeadDealData({ lead: updated.value, actorId }),
    )

    void indexSearchDocument('crm-lead', workspaceId, leadId)
    return ok(toCrmLeadDTO(updated.value))
  },

  /**
   * Reabre um lead perdido: volta para a etapa configurada em CrmSettings
   * (padrão: a 1ª etapa), limitada à etapa mais avançada que os registros
   * do lead sustentam. Limpa motivo/data da perda no lead, mas guarda o
   * snapshot em `crm_lead_reopenings` (histórico) e na auditoria. Leads
   * ganhos não reabrem. Dispara o gatilho de workflow "stage changed".
   */
  async reopen(
    actorId: string,
    workspaceId: string,
    leadId: string,
    dto: ReopenCrmLeadDTO,
  ): Promise<Result<CrmLeadDTO>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'leads',
      action: 'EDIT',
    })
    if (!membership.ok) return membership

    const lead = await CrmLeadRepository.findById(leadId, workspaceId)
    if (!lead.ok) return lead
    if (lead.value.closeResult === 'WON') {
      return err(
        crmLeadReopenNotAllowed(
          'Leads ganhos não podem ser reabertos — o negócio já foi fechado',
        ),
      )
    }
    if (lead.value.closeResult !== 'LOST') return err(crmLeadReopenNotAllowed())

    const settings = await CrmSettingsService.resolve(workspaceId)
    if (!settings.ok) return settings
    const configuredStage = settings.value.leadReopenStage

    const reachable = await furthestReachableStage(workspaceId, leadId)
    if (!reachable.ok) return reachable

    const toStage =
      OPEN_STAGE_ORDER.indexOf(reachable.value) <
      OPEN_STAGE_ORDER.indexOf(configuredStage)
        ? reachable.value
        : configuredStage

    const reopened = await CrmLeadRepository.reopen(leadId, {
      workspaceId,
      toStage,
      reason: dto.reason,
      reopenedById: actorId,
    })

    if (!reopened.ok) {
      auditMutation({
        entity: 'crm_lead',
        action: 'update',
        actorId,
        targetId: leadId,
        outcome: 'failure',
        reason: reopened.error.code,
        meta: { reopened: true },
      })
      return reopened
    }

    auditMutation({
      entity: 'crm_lead',
      action: 'update',
      actorId,
      targetId: leadId,
      meta: {
        reopened: true,
        toStage,
        configuredStage,
        previousLostReason: lead.value.lostReason,
      },
    })

    emitLeadUpdated(workspaceId, actorId, lead.value, reopened.value, [
      'stage',
      'closeResult',
      'lostReason',
    ])

    void indexSearchDocument('crm-lead', workspaceId, leadId)
    return ok(toCrmLeadDTO(reopened.value))
  },

  async listReopenings(
    actorId: string,
    workspaceId: string,
    leadId: string,
  ): Promise<Result<CrmLeadReopeningDTO[]>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'leads',
      action: 'VIEW',
    })
    if (!membership.ok) return membership

    const lead = await CrmLeadRepository.findById(leadId, workspaceId)
    if (!lead.ok) return lead

    const result = await CrmLeadRepository.listReopenings(leadId)
    if (!result.ok) return result

    return ok(result.value.map(toCrmLeadReopeningDTO))
  },
}
