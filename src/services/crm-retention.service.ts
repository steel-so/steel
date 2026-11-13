import type { CrmRetentionSource, SatisfactionSurvey } from '@prisma/client'
import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import { phoneMatchKey } from '@/src/lib/pabx/recording'
import { normalizeDocument } from '@/src/lib/servicedesk/document'
import { ok, type Result } from '@/src/lib/result'
import { toCrmRetentionSettingsDTO } from '@/src/mappers/crm-retention.mapper'
import { CrmOpportunityRepository } from '@/src/repositories/crm-opportunity.repository'
import {
  CrmRetentionRepository,
  type RetentionPersonContext,
} from '@/src/repositories/crm-retention.repository'
import { CrmTaskRepository } from '@/src/repositories/crm-task.repository'
import { PhoneCallLinkRepository } from '@/src/repositories/phone-call-link.repository'
import type { UpdateCrmRetentionSettingsDTO } from '@/src/schemas/crm-retention.schema'
import type { CrmRetentionSettingsDTO } from '@/types/crm-retention'
import { assertModuleMember, assertModulePrivileged } from './authz'
import { notifyCrmRetentionTask } from './crm-notifications'

const DAY_MS = 24 * 60 * 60 * 1000

export type RetentionOutcome =
  | { status: 'created'; taskId: string; opportunityId: string | null }
  /** The same signal already opened a follow-up. */
  | { status: 'duplicate' }
  /** Switched off, or nothing to attach the task to. */
  | {
      status: 'skipped'
      reason: 'disabled' | 'no_record' | 'no_assignee'
    }

interface FollowUpInput {
  workspaceId: string
  source: CrmRetentionSource
  dedupeKey: string
  settings: CrmRetentionSettingsDTO
  title: string
  body: string
  companyId: string | null
  companyName: string | null
  personId: string | null
  ownerId: string | null
  now: Date
}

/** Opens the retention deal, best effort: the task is the contract. */
async function openRetentionDeal(
  input: FollowUpInput,
  authorId: string,
): Promise<string | null> {
  if (!input.settings.createOpportunity || !input.companyId) return null

  const existing = await CrmRetentionRepository.findOpenOpportunityOfCompany(
    input.workspaceId,
    input.companyId,
  )
  if (!existing.ok) return null
  if (existing.value) return existing.value.id

  const stage = await CrmRetentionRepository.findRetentionStage(
    input.workspaceId,
  )
  if (!stage.ok || !stage.value) {
    logger.warn('crm.retention.no_pipeline', { workspaceId: input.workspaceId })
    return null
  }

  const created = await CrmOpportunityRepository.create({
    workspaceId: input.workspaceId,
    createdById: authorId,
    name: `Retenção - ${input.companyName ?? 'cliente'}`,
    pipelineId: stage.value.pipelineId,
    stageId: stage.value.stageId,
    companyId: input.companyId,
    pointOfContactId: input.personId ?? undefined,
    ownerId: input.ownerId ?? authorId,
    source: 'retention',
  })
  if (!created.ok) {
    logger.warn('crm.retention.opportunity_failed', {
      workspaceId: input.workspaceId,
      reason: created.error.code,
    })
    return null
  }
  return created.value.id
}

/**
 * Claims the key, then opens the task (and optionally the deal) for the
 * account owner. The claim makes it idempotent; a failed task gives the key
 * back so the next signal can retry.
 */
async function createFollowUp(
  input: FollowUpInput,
): Promise<Result<RetentionOutcome>> {
  const claimed = await CrmRetentionRepository.claim(
    input.workspaceId,
    input.source,
    input.dedupeKey,
  )
  if (!claimed.ok) return claimed
  if (!claimed.value) return ok({ status: 'duplicate' })

  const release = () =>
    CrmRetentionRepository.release(input.workspaceId, input.dedupeKey)

  const fallback = input.ownerId
    ? null
    : await CrmRetentionRepository.findFallbackUserId(input.workspaceId)
  if (fallback && !fallback.ok) {
    await release()
    return fallback
  }
  const assigneeId = input.ownerId ?? fallback?.value ?? null
  if (!assigneeId) {
    await release()
    return ok({ status: 'skipped', reason: 'no_assignee' })
  }

  const opportunityId = await openRetentionDeal(input, assigneeId)
  const task = await CrmTaskRepository.create({
    workspaceId: input.workspaceId,
    createdById: assigneeId,
    title: input.title,
    body: input.body,
    dueDate: new Date(
      input.now.getTime() + input.settings.taskDueDays * DAY_MS,
    ),
    assigneeId,
    companyId: input.companyId ?? undefined,
    personId: input.personId ?? undefined,
    opportunityId: opportunityId ?? undefined,
  })
  if (!task.ok) {
    await release()
    return task
  }

  await CrmRetentionRepository.complete(input.workspaceId, input.dedupeKey, {
    taskId: task.value.id,
    opportunityId,
  })
  auditMutation({
    entity: 'crm_task',
    action: 'create',
    actorId: null,
    targetId: task.value.id,
    meta: {
      workspaceId: input.workspaceId,
      origin: 'retention',
      source: input.source,
      opportunityId,
    },
  })
  void notifyCrmRetentionTask({
    workspaceId: input.workspaceId,
    task: { id: task.value.id, title: input.title },
    assigneeId,
    reason: input.body,
    dedupeKey: input.dedupeKey,
  })
  return ok({ status: 'created', taskId: task.value.id, opportunityId })
}

/** Which CRM person a survey answer belongs to (phone first, then e-mail). */
async function findSurveyPersonId(
  survey: SatisfactionSurvey,
): Promise<string | null> {
  const phones: string[] = []
  if (survey.customerKey?.startsWith('contact:')) {
    const phone = await CrmRetentionRepository.findContactPhone(
      survey.workspaceId,
      survey.customerKey.slice('contact:'.length),
    )
    if (phone.ok && phone.value) phones.push(phone.value)
  }
  if (survey.recipientPhone) phones.push(survey.recipientPhone)

  for (const phone of phones) {
    const key = phoneMatchKey(phone)
    if (!key) continue
    const person = await PhoneCallLinkRepository.findPersonByPhoneKey(
      survey.workspaceId,
      key,
    )
    if (person.ok && person.value) return person.value
  }

  if (survey.recipientEmail) {
    const person = await CrmRetentionRepository.findPersonIdByEmail(
      survey.workspaceId,
      survey.recipientEmail,
    )
    if (person.ok && person.value) return person.value
  }
  return null
}

const contextOf = (
  person: RetentionPersonContext,
): Pick<
  FollowUpInput,
  'companyId' | 'companyName' | 'personId' | 'ownerId'
> => ({
  companyId: person.companyId,
  companyName: person.companyName,
  personId: person.personId,
  ownerId: person.accountOwnerId,
})

export const CrmRetentionService = {
  /** Any CRM member reads (defaults while the workspace never saved). */
  async get(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<CrmRetentionSettingsDTO>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM')
    if (!membership.ok) return membership

    const result = await CrmRetentionRepository.findSettings(workspaceId)
    if (!result.ok) return result
    return ok(toCrmRetentionSettingsDTO(workspaceId, result.value))
  },

  /** Only OWNER/ADMIN change the retention rules. */
  async update(
    actorId: string,
    workspaceId: string,
    dto: UpdateCrmRetentionSettingsDTO,
  ): Promise<Result<CrmRetentionSettingsDTO>> {
    const membership = await assertModulePrivileged(actorId, workspaceId, 'CRM')
    if (!membership.ok) return membership

    const result = await CrmRetentionRepository.upsertSettings(workspaceId, {
      ...dto,
      updatedById: actorId,
    })
    if (!result.ok) {
      auditMutation({
        entity: 'crm_retention_settings',
        action: 'update',
        actorId,
        outcome: 'failure',
        reason: result.error.code,
      })
      return result
    }
    auditMutation({
      entity: 'crm_retention_settings',
      action: 'update',
      actorId,
      targetId: workspaceId,
      meta: { ...dto },
    })
    return ok(toCrmRetentionSettingsDTO(workspaceId, result.value))
  },

  /**
   * A detractor survey answer: task for the owner of the customer's company
   * (idempotent per survey). Internal - the survey service already authorized
   * the answer.
   */
  async onSurveyDetractor(input: {
    survey: SatisfactionSurvey
    score: number
    comment?: string
    now?: Date
  }): Promise<Result<RetentionOutcome>> {
    const { survey, score, comment } = input
    const stored = await CrmRetentionRepository.findSettings(survey.workspaceId)
    if (!stored.ok) return stored
    const settings = toCrmRetentionSettingsDTO(survey.workspaceId, stored.value)
    if (!settings.onDetractor) {
      return ok({ status: 'skipped', reason: 'disabled' })
    }

    const personId = await findSurveyPersonId(survey)
    const context = personId
      ? await CrmRetentionRepository.findPersonContext(
          survey.workspaceId,
          personId,
        )
      : null
    if (context && !context.ok) return context
    if (!context?.value) {
      logger.info('crm.retention.survey_without_crm_record', {
        workspaceId: survey.workspaceId,
        surveyId: survey.id,
      })
      return ok({ status: 'skipped', reason: 'no_record' })
    }

    const who = survey.customerName ?? survey.recipientName ?? 'Cliente'
    const note = comment ? ` Comentário: "${comment.slice(0, 300)}"` : ''
    return createFollowUp({
      workspaceId: survey.workspaceId,
      source: 'SURVEY_DETRACTOR',
      dedupeKey: `survey:${survey.id}`,
      settings,
      title: `Retenção: ligar para ${who} (nota ${score})`,
      body: `${who} respondeu a pesquisa ${survey.kind} com nota ${score}.${note} Entre em contato para entender o problema e tentar reverter.`,
      ...contextOf(context.value),
      now: input.now ?? new Date(),
    })
  },

  /**
   * A ServiceDesk ticket breached its SLA: task for the owner of the CRM
   * company that matches the ticket's customer (CNPJ, else exact name), one
   * per ticket. Off by default (`onSlaBreach`). Internal - called by the SLA
   * monitor, which already scoped the ticket to the workspace.
   */
  async onSlaBreach(input: {
    workspaceId: string
    ticket: {
      id: string
      code: string
      title: string
      customer: {
        name: string
        tradeName: string | null
        document: string | null
      } | null
    }
    /** What was breached, e.g. "1ª resposta e resolução". */
    what: string
    now?: Date
  }): Promise<Result<RetentionOutcome>> {
    const { workspaceId, ticket, what } = input
    const stored = await CrmRetentionRepository.findSettings(workspaceId)
    if (!stored.ok) return stored
    const settings = toCrmRetentionSettingsDTO(workspaceId, stored.value)
    if (!settings.onSlaBreach) {
      return ok({ status: 'skipped', reason: 'disabled' })
    }
    if (!ticket.customer) return ok({ status: 'skipped', reason: 'no_record' })

    const document = ticket.customer.document
      ? normalizeDocument(ticket.customer.document)
      : null
    const company = await CrmRetentionRepository.findCompanyByIdentity(
      workspaceId,
      {
        document,
        names: [ticket.customer.name, ticket.customer.tradeName ?? ''],
      },
    )
    if (!company.ok) return company
    if (!company.value) {
      return ok({ status: 'skipped', reason: 'no_record' })
    }

    return createFollowUp({
      workspaceId,
      source: 'SLA_BREACH',
      dedupeKey: `sla:${ticket.id}`,
      settings,
      title: `SLA violado: ${ticket.code} de ${company.value.name}`,
      body: `O chamado ${ticket.code} ("${ticket.title.slice(0, 200)}") violou o SLA (${what}). Fale com o cliente antes que a insatisfação cresça.`,
      companyId: company.value.id,
      companyName: company.value.name,
      personId: null,
      ownerId: company.value.accountOwnerId,
      now: input.now ?? new Date(),
    })
  },

  /**
   * The churn risk of a company entered the high band or jumped: task for the
   * account owner (one per company per UTC day). Internal - called by the
   * health tick.
   */
  async onHealthDrop(input: {
    workspaceId: string
    company: { id: string; name: string; accountOwnerId: string | null }
    riskScore: number
    levelLabel: string
    reason: string | null
    nextAction: string
    now: Date
  }): Promise<Result<RetentionOutcome>> {
    const stored = await CrmRetentionRepository.findSettings(input.workspaceId)
    if (!stored.ok) return stored
    const settings = toCrmRetentionSettingsDTO(input.workspaceId, stored.value)
    if (!settings.onHealthDrop) {
      return ok({ status: 'skipped', reason: 'disabled' })
    }

    const reason = input.reason ? ` Motivo principal: ${input.reason}.` : ''
    return createFollowUp({
      workspaceId: input.workspaceId,
      source: 'HEALTH_DROP',
      dedupeKey: `health:${input.company.id}:${input.now.toISOString().slice(0, 10)}`,
      settings,
      title: `Retenção: cuidar de ${input.company.name}`,
      body: `${input.levelLabel}: nota de risco ${input.riskScore}/100.${reason} Próxima ação sugerida: ${input.nextAction}.`,
      companyId: input.company.id,
      companyName: input.company.name,
      personId: null,
      ownerId: input.company.accountOwnerId,
      now: input.now,
    })
  },
}

/**
 * Runs a retention hook without ever failing the caller: a follow-up must not
 * lose the survey answer or abort the health tick.
 */
export async function runRetentionSafely(
  label: string,
  run: () => Promise<Result<RetentionOutcome>>,
): Promise<RetentionOutcome | null> {
  try {
    const outcome = await run()
    if (!outcome.ok) {
      logger.warn('crm.retention.failed', {
        label,
        reason: outcome.error.code,
      })
      return null
    }
    return outcome.value
  } catch (error) {
    logger.warn('crm.retention.failed', {
      label,
      cause: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}
