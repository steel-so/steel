import type {
  Prisma,
  SdPhase,
  SdPhaseCategory,
  SdSettings,
  SdTicketChannel,
  SdTicketType,
} from '@prisma/client'
import { logger } from '@/lib/axiom/logger'
import {
  sdApprovalRequired,
  sdCategoryLevelInvalid,
  sdCategoryNotFound,
  sdConfigItemNotFound,
  sdConfigNotFound,
  sdContactNotFound,
  sdCustomerNotFound,
  sdDepartmentNotFound,
  sdPhaseNotFound,
  sdPhaseRequirementsUnmet,
  sdPhaseTransitionNotAllowed,
  sdSignatureRequired,
  sdTicketClosed,
  sdTicketNotFound,
  validationError,
} from '@/src/errors'
import type { AppError } from '@/src/errors/app-error'
import { err, ok, type Result } from '@/src/lib/result'
import { indexSearchDocument } from '@/src/lib/search/index-hooks'
import { enqueueSdAiTriage } from '@/src/lib/servicedesk/ai-queue'
import { evaluateSdConditions } from '@/src/lib/servicedesk/conditions'
import { sanitizeSdHtml } from '@/src/lib/servicedesk/html'
import { sdNotifyTicketOf } from '@/src/lib/servicedesk/notify'
import {
  publishSdTicketEvent,
  type SdTicketRealtimeEventType,
} from '@/src/lib/servicedesk/realtime'
import {
  addBusinessMinutes,
  businessMinutesBetween,
  parseSdCalendar,
  type SdCalendar,
} from '@/src/lib/servicedesk/sla'
import {
  formatSdTicketCode,
  parseSdTicketCode,
  resolveSdTicketPrefixes,
  type SdTicketPrefixes,
} from '@/src/lib/servicedesk/ticket-code'
import {
  sdTicketSnapshot,
  sdTicketWebhookChange,
} from '@/src/lib/webhooks/payloads'
import { SdAutomationRepository } from '@/src/repositories/sd-automation.repository'
import {
  type SdTicketCreateData,
  SdTicketRepository,
  type SdTicketWithRelations,
} from '@/src/repositories/sd-ticket.repository'
import {
  type SdCategoryNode,
  type SdSlaPolicyWithTargets,
  SdTicketContextRepository,
  type SdTicketRefField,
  type SdTicketRefs,
} from '@/src/repositories/sd-ticket-context.repository'
import { SdConditionsSchema } from '@/src/schemas/sd-rule.schema'
import type { CreateSdTicketDTO } from '@/src/schemas/sd-ticket.schema'
import type { SdChangeWarningDTO } from '@/types/sd-change'
import type { SdAccessContext } from './sd-access'
import { sdTicketApprovalSatisfied } from './sd-approval-gate'
import { sdAssertChangeSchedule } from './sd-change-schedule'
import { resolveSdTicketContractId } from './sd-contract-stamp'
import { notifySdEvent } from './sd-notification.service'
import {
  recordSdTicketEvent,
  type SdTicketEventInput,
  sdEventActorKind,
} from './sd-ticket-event-recorder'
import {
  applySdTemplateDefaults,
  buildSdTicketFacts,
  diffSdTickets,
  type SdFactSource,
  sdFieldLabel,
  sdMissingRequiredFields,
  sdTemplateTasks,
  validateSdTicketCustomFields,
} from './sd-ticket-rules'
import { dispatchSteelAgentEvent } from './steel-agent-dispatcher'
import { emitWebhookEvent } from './webhook-emitter'

/**
 * Núcleo do motor de chamados do ServiceDesk, **sem autorização**: quem
 * chama (service com `SdAccess`, motor de automação, worker) já decidiu que
 * a ação é permitida. Implementa as regras de "Abertura" e "Mudança de
 * fase" de `docs/servicedesk/README.md`, grava rastreabilidade, notifica e
 * publica no tempo real. Não dispara automações (evita laço): quem chama
 * decide rodar `runSdAutomations`.
 */

export type SdActor =
  | {
      kind: 'user'
      userId: string
      isAgent: boolean
      isAdmin: boolean
      departmentIds: string[]
    }
  | { kind: 'system'; source: string }
  /** Contato externo autenticado pelo portal por link mágico (`/suporte`). */
  | { kind: 'contact'; contactId: string; contactName: string }

export function sdUserActor(ctx: SdAccessContext): SdActor {
  return {
    kind: 'user',
    userId: ctx.userId,
    isAgent: ctx.isAgent,
    isAdmin: ctx.isAdmin,
    departmentIds: ctx.departmentIds,
  }
}

export function sdSystemActor(source: string): SdActor {
  return { kind: 'system', source }
}

/** Ator do portal externo: o contato, que não tem conta na plataforma. */
export function sdContactActor(contact: { id: string; name: string }): SdActor {
  return { kind: 'contact', contactId: contact.id, contactName: contact.name }
}

export function sdActorUserId(actor: SdActor): string | null {
  return actor.kind === 'user' ? actor.userId : null
}

export interface SdEngineConfig {
  settings: SdSettings
  prefixes: SdTicketPrefixes
}

const FINAL: SdPhaseCategory[] = ['RESOLVED', 'CLOSED', 'CANCELED']
const isFinal = (c: SdPhaseCategory) => FINAL.includes(c)

function eventActor(actor: SdActor) {
  return {
    actorKind: sdEventActorKind(actor),
    actorUserId: sdActorUserId(actor),
  }
}

export function sdTicketCode(
  t: { type: SdTicketType; number: number },
  prefixes: SdTicketPrefixes,
): string {
  return formatSdTicketCode(t.type, t.number, prefixes)
}

async function publish(
  t: SdTicketWithRelations,
  type: SdTicketRealtimeEventType,
  actor: SdActor,
  config: SdEngineConfig,
): Promise<void> {
  // Outbound webhooks (ADR 0036): created/updated, fire-and-forget.
  const webhook = sdTicketWebhookChange(type)
  if (webhook) {
    const ticket = () => sdTicketSnapshot(t, sdTicketCode(t, config.prefixes))
    const actorId = sdActorUserId(actor)
    void (webhook.type === 'servicedesk.ticket.created'
      ? emitWebhookEvent(t.workspaceId, webhook.type, () => ({
          ticket: ticket(),
          actorId,
        }))
      : emitWebhookEvent(t.workspaceId, webhook.type, () => ({
          ticket: ticket(),
          actorId,
          change: webhook.change,
        })))
  }
  await publishSdTicketEvent(
    t.workspaceId,
    {
      type,
      ticketId: t.id,
      number: t.number,
      at: new Date().toISOString(),
      actorId: sdActorUserId(actor),
    },
    {
      requesterId: t.requesterId,
      participantIds: t.participants.map((p) => p.userId),
      contactUserId: t.contact?.userId ?? null,
    },
  )
}

const REF_ERRORS: Record<SdTicketRefField, () => AppError> = {
  impactId: sdConfigNotFound,
  urgencyId: sdConfigNotFound,
  priorityId: sdConfigNotFound,
  severityId: sdConfigNotFound,
  classificationId: sdConfigNotFound,
  solutionClassificationId: sdConfigNotFound,
  customerId: sdCustomerNotFound,
  companyId: sdCustomerNotFound,
  contactId: sdContactNotFound,
  configItemId: sdConfigItemNotFound,
  departmentId: sdDepartmentNotFound,
  parentId: sdTicketNotFound,
}

async function validateRefs(
  workspaceId: string,
  refs: SdTicketRefs,
  userIds: (string | null | undefined)[],
): Promise<Result<true>> {
  const missing = await SdTicketContextRepository.findMissingRefs(
    workspaceId,
    refs,
  )
  if (!missing.ok) return missing
  if (missing.value.length > 0) return err(REF_ERRORS[missing.value[0]]())

  const ids = userIds.filter((id): id is string => !!id)
  const outsiders = await SdTicketContextRepository.findNonMembers(
    workspaceId,
    ids,
  )
  if (!outsiders.ok) return outsiders
  if (outsiders.value.length > 0) {
    return err(validationError('Usuário não é membro do workspace'))
  }
  return ok(true)
}

async function priorityLevelOf(
  workspaceId: string,
  priorityId: string | null,
): Promise<Result<number | null>> {
  if (!priorityId) return ok(null)
  return SdTicketContextRepository.findPriorityLevel(workspaceId, priorityId)
}

/**
 * Autor de registros que exigem usuário (tarefas) quando quem age é o
 * sistema: o próprio ator, senão o primeiro OWNER do workspace.
 */
export async function sdRecordAuthorId(
  workspaceId: string,
  actor: SdActor,
): Promise<string | null> {
  const userId = sdActorUserId(actor)
  if (userId) return userId
  const owner =
    await SdTicketContextRepository.findWorkspaceOwnerId(workspaceId)
  return owner.ok ? owner.value : null
}

/* ------------------------------------------------------------------ */
/* Catálogo (categoria > subcategoria > serviço)                        */
/* ------------------------------------------------------------------ */

interface CatalogSelection {
  categoryId: string | null
  subcategoryId: string | null
  serviceId: string | null
  /** Do mais específico ao mais geral (serviço → subcategoria → categoria). */
  chain: SdCategoryNode[]
}

async function loadNode(
  workspaceId: string,
  id: string,
  type: SdTicketType,
): Promise<Result<SdCategoryNode>> {
  const node = await SdTicketContextRepository.findCategory(workspaceId, id)
  if (!node.ok) return node
  if (!node.value?.active) return err(sdCategoryNotFound())
  if (
    node.value.ticketTypes.length > 0 &&
    !node.value.ticketTypes.includes(type)
  ) {
    return err(
      sdCategoryLevelInvalid('Categoria não disponível para este tipo'),
    )
  }
  return ok(node.value)
}

/**
 * Valida e completa a seleção do catálogo: níveis corretos, pai coerente e
 * ancestrais deduzidos (informar só o serviço preenche subcategoria e
 * categoria).
 */
async function resolveCatalog(
  workspaceId: string,
  type: SdTicketType,
  input: {
    categoryId?: string | null
    subcategoryId?: string | null
    serviceId?: string | null
  },
): Promise<Result<CatalogSelection>> {
  const chain: SdCategoryNode[] = []
  let service: SdCategoryNode | null = null
  let sub: SdCategoryNode | null = null
  let cat: SdCategoryNode | null = null

  if (input.serviceId) {
    const node = await loadNode(workspaceId, input.serviceId, type)
    if (!node.ok) return node
    if (node.value.level !== 'SERVICE') return err(sdCategoryLevelInvalid())
    service = node.value
  }
  const subId = input.subcategoryId ?? service?.parentId ?? null
  if (subId) {
    const node = await loadNode(workspaceId, subId, type)
    if (!node.ok) return node
    if (node.value.level !== 'SUBCATEGORY') return err(sdCategoryLevelInvalid())
    if (service && service.parentId !== node.value.id) {
      return err(sdCategoryLevelInvalid())
    }
    sub = node.value
  }
  const catId = input.categoryId ?? sub?.parentId ?? null
  if (catId) {
    const node = await loadNode(workspaceId, catId, type)
    if (!node.ok) return node
    if (node.value.level !== 'CATEGORY') return err(sdCategoryLevelInvalid())
    if (sub && sub.parentId !== node.value.id) {
      return err(sdCategoryLevelInvalid())
    }
    cat = node.value
  }
  for (const node of [service, sub, cat]) if (node) chain.push(node)
  return ok({
    categoryId: cat?.id ?? null,
    subcategoryId: sub?.id ?? null,
    serviceId: service?.id ?? null,
    chain,
  })
}

/* ------------------------------------------------------------------ */
/* SLA                                                                  */
/* ------------------------------------------------------------------ */

interface SlaAssignment {
  slaPolicyId: string | null
  firstResponseDueAt: Date | null
  resolutionDueAt: Date | null
}

/**
 * Política: 1ª ativa (por `position`, não padrão) cujas condições (não
 * vazias) casam → SLA do nó do catálogo (serviço → subcategoria →
 * categoria) → `settings.defaultSlaPolicyId` → política `isDefault`.
 */
export function selectSdSlaPolicy(
  policies: SdSlaPolicyWithTargets[],
  facts: ReturnType<typeof buildSdTicketFacts>,
  catalogChain: { slaPolicyId: string | null }[],
  defaultPolicyId: string | null,
): SdSlaPolicyWithTargets | null {
  for (const policy of policies) {
    if (policy.isDefault) continue
    const conditions = SdConditionsSchema.safeParse(policy.conditions)
    if (!conditions.success || conditions.data.length === 0) continue
    if (evaluateSdConditions(conditions.data, facts)) return policy
  }
  const byId = (id: string | null) =>
    id ? (policies.find((p) => p.id === id) ?? null) : null
  for (const node of catalogChain) {
    const policy = byId(node.slaPolicyId)
    if (policy) return policy
  }
  return byId(defaultPolicyId) ?? policies.find((p) => p.isDefault) ?? null
}

async function policyCalendar(
  workspaceId: string,
  policy: SdSlaPolicyWithTargets,
): Promise<Result<SdCalendar>> {
  if (policy.calendar) return ok(parseSdCalendar(policy.calendar))
  const fallback =
    await SdTicketContextRepository.findDefaultCalendar(workspaceId)
  if (!fallback.ok) return fallback
  return ok(parseSdCalendar(fallback.value))
}

async function assignSla(params: {
  workspaceId: string
  settings: SdSettings
  facts: ReturnType<typeof buildSdTicketFacts>
  catalogChain: { slaPolicyId: string | null }[]
  priorityId: string | null
  start: Date
  pausedMinutes: number
}): Promise<Result<SlaAssignment>> {
  const policies = await SdTicketContextRepository.listActiveSlaPolicies(
    params.workspaceId,
  )
  if (!policies.ok) return policies
  const policy = selectSdSlaPolicy(
    policies.value,
    params.facts,
    params.catalogChain,
    params.settings.defaultSlaPolicyId,
  )
  if (!policy) {
    return ok({
      slaPolicyId: null,
      firstResponseDueAt: null,
      resolutionDueAt: null,
    })
  }
  const target = policy.targets.find((t) => t.priorityId === params.priorityId)
  if (!target) {
    return ok({
      slaPolicyId: policy.id,
      firstResponseDueAt: null,
      resolutionDueAt: null,
    })
  }
  const cal = await policyCalendar(params.workspaceId, policy)
  if (!cal.ok) return cal
  return ok({
    slaPolicyId: policy.id,
    firstResponseDueAt: addBusinessMinutes(
      params.start,
      target.firstResponseMinutes + params.pausedMinutes,
      cal.value,
    ),
    resolutionDueAt: addBusinessMinutes(
      params.start,
      target.resolutionMinutes + params.pausedMinutes,
      cal.value,
    ),
  })
}

function ticketCalendar(t: SdTicketWithRelations): SdCalendar {
  return parseSdCalendar(t.slaPolicy?.calendar ?? null)
}

/* ------------------------------------------------------------------ */
/* Notificações                                                         */
/* ------------------------------------------------------------------ */

/** Aviso de um evento do catálogo sobre o chamado (motor de notificações). */
async function notifyEvent(
  event: string,
  t: SdTicketWithRelations,
  config: SdEngineConfig,
  actor: SdActor,
  payload: { title: string; body: string },
): Promise<void> {
  const code = sdTicketCode(t, config.prefixes)
  const sent = await notifySdEvent({
    workspaceId: t.workspaceId,
    event,
    ticket: sdNotifyTicketOf(t, code),
    actorId: sdActorUserId(actor),
    payload,
  })
  if (!sent.ok) {
    logger.warn('servicedesk.ticket.notify_failed', {
      workspaceId: t.workspaceId,
      ticketId: t.id,
      event,
      reason: sent.error.code,
    })
  }
}

async function notifyAssigned(
  t: SdTicketWithRelations,
  config: SdEngineConfig,
  actor: SdActor,
): Promise<void> {
  if (!t.assigneeId) return
  const code = sdTicketCode(t, config.prefixes)
  await notifyEvent('ticket.assigned', t, config, actor, {
    title: `${code} atribuído a você`,
    body: t.title,
  })
}

/**
 * Mudança de fase: resolvido e reaberto têm evento próprio no catálogo
 * (públicos e canais diferentes); as outras fases caem em
 * `ticket.phase_changed`.
 */
async function notifyPhaseChange(
  before: SdTicketWithRelations,
  after: SdTicketWithRelations,
  target: { name: string; category: SdPhaseCategory },
  config: SdEngineConfig,
  actor: SdActor,
  reopened: boolean,
): Promise<void> {
  const code = sdTicketCode(after, config.prefixes)
  if (target.category === 'RESOLVED') {
    await notifyEvent('ticket.resolved', after, config, actor, {
      title: `${code} resolvido`,
      body: after.solution?.trim() || after.title,
    })
    return
  }
  if (reopened) {
    await notifyEvent('ticket.reopened', after, config, actor, {
      title: `${code} reaberto`,
      body: `Voltou de "${before.phase.name}" para "${target.name}".`,
    })
    return
  }
  await notifyEvent('ticket.phase_changed', after, config, actor, {
    title: `${code} mudou de fase`,
    body: `${before.phase.name} → ${target.name}`,
  })
}

/* ------------------------------------------------------------------ */
/* API do motor                                                         */
/* ------------------------------------------------------------------ */

export interface SdEngineCreateInput extends CreateSdTicketDTO {
  channel: SdTicketChannel
  requesterId?: string | null
  /** Aberto pelo portal: modelo e catálogo precisam ser `portalVisible`. */
  portal?: boolean
}

export type SdEngineChanges = Partial<{
  title: string
  description: string | null
  channel: SdTicketChannel
  impactId: string | null
  urgencyId: string | null
  priorityId: string | null
  severityId: string | null
  categoryId: string | null
  subcategoryId: string | null
  serviceId: string | null
  classificationId: string | null
  solutionClassificationId: string | null
  solution: string | null
  customerId: string | null
  companyId: string | null
  contactId: string | null
  configItemId: string | null
  departmentId: string | null
  assigneeId: string | null
  requesterId: string | null
  parentId: string | null
  tags: string[]
  customFields: Record<string, unknown>
  changeType: 'STANDARD' | 'NORMAL' | 'EMERGENCY' | null
  changeRisk: 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH' | null
  plannedStartAt: Date | null
  plannedEndAt: Date | null
  implementationPlan: string | null
  rollbackPlan: string | null
  testPlan: string | null
  rootCause: string | null
  workaround: string | null
  knownError: boolean
  escalationLevel: number
  csatScore: number | null
  csatComment: string | null
}>

export interface SdEngineUpdateOptions {
  /** Atualiza `lastActivityAt` (padrão `true`; o worker desliga). */
  touchActivity?: boolean
  /** Ação do evento de rastreabilidade (padrão `field.changed`). */
  eventMeta?: Record<string, Prisma.InputJsonValue>
  /** Pula a recusa de chamado encerrado (automação/sistema). */
  allowClosed?: boolean
  /**
   * Agendamento da mudança confirmado pelo ator: segue mesmo com
   * congelamento ou conflito de janela (só admin; o que foi ignorado vira
   * evento de rastreabilidade). Ver `src/services/sd-change-schedule.ts`.
   */
  confirmChangeSchedule?: boolean
}

export interface SdPhaseChangeOptions {
  solution?: string
  solutionClassificationId?: string
  comment?: string
  /** Evento extra (ex.: `ticket.auto_closed`). */
  reason?: string
}

const CSAT_FIELDS = new Set(['csatScore', 'csatComment'])
const REF_FIELDS: SdTicketRefField[] = [
  'impactId',
  'urgencyId',
  'priorityId',
  'severityId',
  'classificationId',
  'solutionClassificationId',
  'customerId',
  'companyId',
  'contactId',
  'configItemId',
  'departmentId',
  'parentId',
]

export const SdTicketEngine = {
  /** Configuração do módulo (cria `sd_settings` se faltar) + prefixos. */
  async loadConfig(workspaceId: string): Promise<Result<SdEngineConfig>> {
    const settings = await SdTicketContextRepository.ensureSettings(workspaceId)
    if (!settings.ok) return settings
    return ok({
      settings: settings.value,
      prefixes: resolveSdTicketPrefixes(settings.value.ticketPrefixes),
    })
  },

  /** Chamado por id, número (`123`) ou código (`INC-000123`). */
  async resolveRef(
    workspaceId: string,
    ref: string,
    prefixes?: SdTicketPrefixes,
  ): Promise<Result<SdTicketWithRelations>> {
    const parsed = parseSdTicketCode(ref, prefixes)
    if (parsed) {
      const row = await SdTicketRepository.findByNumber(
        parsed.number,
        workspaceId,
      )
      if (!row.ok) return row
      if (parsed.type && parsed.type !== row.value.type) {
        return err(sdTicketNotFound())
      }
      return row
    }
    return SdTicketRepository.findById(ref, workspaceId)
  },

  async create(
    workspaceId: string,
    rawInput: SdEngineCreateInput,
    actor: SdActor,
    config: SdEngineConfig,
  ): Promise<Result<SdTicketWithRelations>> {
    const now = new Date()
    const { settings } = config
    let input = rawInput

    // 1. Modelo
    let templateTasks: ReturnType<typeof sdTemplateTasks> = []
    if (input.templateId) {
      const tpl = await SdTicketContextRepository.findTemplate(
        workspaceId,
        input.templateId,
      )
      if (!tpl.ok) return tpl
      if (
        !tpl.value?.active ||
        tpl.value.ticketType !== input.type ||
        (input.portal && !tpl.value.portalVisible)
      ) {
        return err(sdConfigNotFound())
      }
      input = applySdTemplateDefaults(input, tpl.value.defaults)
      templateTasks = sdTemplateTasks(tpl.value.tasks)
    }

    // 2. Catálogo
    const catalog = await resolveCatalog(workspaceId, input.type, input)
    if (!catalog.ok) return catalog
    if (input.portal && catalog.value.chain.some((n) => !n.portalVisible)) {
      return err(sdCategoryNotFound())
    }

    // 3. Prioridade: matriz impacto × urgência, senão a padrão
    let priorityId = input.priorityId ?? null
    if (input.priorityId === undefined && input.impactId && input.urgencyId) {
      const fromMatrix = await SdTicketContextRepository.findMatrixPriorityId(
        workspaceId,
        input.impactId,
        input.urgencyId,
      )
      if (!fromMatrix.ok) return fromMatrix
      priorityId = fromMatrix.value
    }
    if (!priorityId && input.priorityId === undefined) {
      const fallback =
        await SdTicketContextRepository.findDefaultPriorityId(workspaceId)
      if (!fallback.ok) return fallback
      priorityId = fallback.value
    }

    const refs = await validateRefs(
      workspaceId,
      {
        impactId: input.impactId,
        urgencyId: input.urgencyId,
        priorityId,
        severityId: input.severityId,
        classificationId: input.classificationId,
        customerId: input.customerId,
        companyId: input.companyId,
        contactId: input.contactId,
        configItemId: input.configItemId,
        departmentId: input.departmentId,
        parentId: input.parentId,
      },
      [input.assigneeId, input.requesterId],
    )
    if (!refs.ok) return refs

    // 4. Roteamento
    const departmentId =
      input.departmentId ??
      catalog.value.chain.find((n) => n.departmentId)?.departmentId ??
      settings.defaultDepartmentId ??
      null

    // 5. Fase inicial
    let phase: SdPhase | null
    if (input.phaseId) {
      const found = await SdTicketContextRepository.findPhase(
        workspaceId,
        input.phaseId,
      )
      if (!found.ok) return found
      phase = found.value
      if (phase && (phase.ticketType !== input.type || !phase.active))
        phase = null
    } else {
      const found = await SdTicketContextRepository.findInitialPhase(
        workspaceId,
        input.type,
      )
      if (!found.ok) return found
      phase = found.value
    }
    if (!phase) return err(sdPhaseNotFound())

    // 6. Campos customizados
    const defs =
      await SdTicketContextRepository.listTicketCustomFields(workspaceId)
    if (!defs.ok) return defs
    const customFields = validateSdTicketCustomFields(
      defs.value,
      input.customFields ?? {},
      {
        type: input.type,
        categoryIds: [
          catalog.value.categoryId,
          catalog.value.subcategoryId,
          catalog.value.serviceId,
        ],
        checkRequired: true,
      },
    )
    if (!customFields.ok) return customFields

    // 7. SLA
    const priorityLevel = await priorityLevelOf(workspaceId, priorityId)
    if (!priorityLevel.ok) return priorityLevel
    const sla = await assignSla({
      workspaceId,
      settings,
      facts: buildSdTicketFacts({
        ...input,
        ...catalog.value,
        priorityId,
        priorityLevel: priorityLevel.value,
        departmentId,
        phaseId: phase.id,
        phaseCategory: phase.category,
        customFields: customFields.value,
      }),
      catalogChain: catalog.value.chain,
      priorityId,
      start: now,
      pausedMinutes: 0,
    })
    if (!sla.ok) return sla

    // 8. Round-robin
    let assigneeId = input.assigneeId ?? null
    if (!assigneeId && settings.autoAssignRoundRobin && departmentId) {
      const picked = await SdTicketContextRepository.pickRoundRobinAssignee(
        departmentId,
        now,
      )
      if (!picked.ok) return picked
      assigneeId = picked.value
    }

    const data: SdTicketCreateData = {
      type: input.type,
      title: input.title,
      description: input.description ? sanitizeSdHtml(input.description) : null,
      channel: input.channel,
      phaseId: phase.id,
      completionPercent: phase.completionPercent,
      impactId: input.impactId ?? null,
      urgencyId: input.urgencyId ?? null,
      priorityId,
      severityId: input.severityId ?? null,
      categoryId: catalog.value.categoryId,
      subcategoryId: catalog.value.subcategoryId,
      serviceId: catalog.value.serviceId,
      classificationId: input.classificationId ?? null,
      customerId: input.customerId ?? null,
      // Contrato vigente do cliente (fatia de contratos e horas).
      contractId: await resolveSdTicketContractId(
        workspaceId,
        input.customerId,
        input.type,
        now,
      ),
      companyId: input.companyId ?? null,
      contactId: input.contactId ?? null,
      configItemId: input.configItemId ?? null,
      departmentId,
      assigneeId,
      requesterId: input.requesterId ?? null,
      templateId: input.templateId ?? null,
      parentId: input.parentId ?? null,
      tags: Array.from(new Set(input.tags ?? [])),
      customFields: customFields.value,
      slaPolicyId: sla.value.slaPolicyId,
      firstResponseDueAt: sla.value.firstResponseDueAt,
      resolutionDueAt: sla.value.resolutionDueAt,
      slaPausedAt: phase.pausesSla && !isFinal(phase.category) ? now : null,
      changeType: input.changeType ?? null,
      changeRisk: input.changeRisk ?? null,
      plannedStartAt: input.plannedStartAt ?? null,
      plannedEndAt: input.plannedEndAt ?? null,
      implementationPlan: input.implementationPlan ?? null,
      rollbackPlan: input.rollbackPlan ?? null,
      testPlan: input.testPlan ?? null,
      rootCause: input.rootCause ?? null,
      workaround: input.workaround ?? null,
      knownError: input.knownError ?? false,
      lastActivityAt: now,
      createdById: sdActorUserId(actor),
    }

    const created = await SdTicketRepository.createWithNumber(workspaceId, data)
    if (!created.ok) return created
    const ticket = created.value

    if (templateTasks.length > 0) {
      const authorId = await sdRecordAuthorId(workspaceId, actor)
      if (authorId) {
        await SdAutomationRepository.insertTasks(
          workspaceId,
          ticket.id,
          authorId,
          templateTasks,
        )
      }
    }

    await recordSdTicketEvent({
      workspaceId,
      ticketId: ticket.id,
      ...eventActor(actor),
      action: 'ticket.created',
      toValue: { id: ticket.id, label: sdTicketCode(ticket, config.prefixes) },
      meta: {
        channel: ticket.channel,
        phase: ticket.phase.name,
        ...(ticket.templateId ? { templateId: ticket.templateId } : {}),
        ...(assigneeId && !input.assigneeId ? { roundRobin: true } : {}),
      },
    })
    await notifyAssigned(ticket, config, actor)
    await notifyEvent('ticket.created_in_department', ticket, config, actor, {
      title: `Novo na fila: ${sdTicketCode(ticket, config.prefixes)}`,
      body: ticket.title,
    })
    await publish(ticket, 'ticket.created', actor, config)
    void dispatchSteelAgentEvent(workspaceId, 'sd.ticket.created', {
      ticketId: ticket.id,
      code: sdTicketCode(ticket, config.prefixes),
      title: ticket.title,
      type: ticket.type,
      channel: ticket.channel,
    })
    // Triagem por IA (fatia whatsapp-ai): só enfileira se estiver ligada.
    await enqueueSdAiTriage(settings, ticket.id)
    logger.info('servicedesk.ticket.created', {
      workspaceId,
      ticketId: ticket.id,
      number: ticket.number,
      type: ticket.type,
      channel: ticket.channel,
    })
    void indexSearchDocument('sd-ticket', workspaceId, ticket.id)
    return ok(ticket)
  },

  /** Atualiza campos (sem fase). Recalcula prioridade (matriz) e SLA. */
  async update(
    ticket: SdTicketWithRelations,
    changes: SdEngineChanges,
    actor: SdActor,
    config: SdEngineConfig,
    options: SdEngineUpdateOptions = {},
  ): Promise<Result<SdTicketWithRelations>> {
    const now = new Date()
    const fields = Object.keys(changes).filter(
      (k) => (changes as Record<string, unknown>)[k] !== undefined,
    )
    if (fields.length === 0) return ok(ticket)
    if (
      isFinal(ticket.phase.category) &&
      ticket.phase.category !== 'RESOLVED' &&
      !options.allowClosed &&
      fields.some((f) => !CSAT_FIELDS.has(f))
    ) {
      return err(sdTicketClosed())
    }

    const data: Prisma.SdTicketUncheckedUpdateInput = {}
    const next = { ...changes }

    // Catálogo: trocar um nível limpa os mais específicos não informados.
    if (
      changes.categoryId !== undefined ||
      changes.subcategoryId !== undefined ||
      changes.serviceId !== undefined
    ) {
      const selection = {
        categoryId:
          changes.categoryId !== undefined
            ? changes.categoryId
            : ticket.categoryId,
        subcategoryId:
          changes.subcategoryId !== undefined
            ? changes.subcategoryId
            : changes.categoryId !== undefined
              ? null
              : ticket.subcategoryId,
        serviceId:
          changes.serviceId !== undefined
            ? changes.serviceId
            : changes.categoryId !== undefined ||
                changes.subcategoryId !== undefined
              ? null
              : ticket.serviceId,
      }
      const catalog = await resolveCatalog(
        ticket.workspaceId,
        ticket.type,
        selection,
      )
      if (!catalog.ok) return catalog
      data.categoryId = catalog.value.categoryId
      data.subcategoryId = catalog.value.subcategoryId
      data.serviceId = catalog.value.serviceId
    }

    // Prioridade pela matriz quando impacto/urgência mudam sem prioridade manual.
    if (
      (changes.impactId !== undefined || changes.urgencyId !== undefined) &&
      changes.priorityId === undefined
    ) {
      const impactId =
        changes.impactId !== undefined ? changes.impactId : ticket.impactId
      const urgencyId =
        changes.urgencyId !== undefined ? changes.urgencyId : ticket.urgencyId
      if (impactId && urgencyId) {
        const fromMatrix = await SdTicketContextRepository.findMatrixPriorityId(
          ticket.workspaceId,
          impactId,
          urgencyId,
        )
        if (!fromMatrix.ok) return fromMatrix
        if (fromMatrix.value) next.priorityId = fromMatrix.value
      }
    }

    const refs: SdTicketRefs = {}
    for (const field of REF_FIELDS) {
      const value = next[field]
      if (value !== undefined) refs[field] = value
    }
    const valid = await validateRefs(ticket.workspaceId, refs, [
      next.assigneeId,
      next.requesterId,
    ])
    if (!valid.ok) return valid

    if (next.parentId) {
      const cycle = await SdTicketRepository.isDescendantOrSelf(
        ticket.id,
        next.parentId,
      )
      if (!cycle.ok) return cycle
      if (cycle.value) {
        return err(
          validationError(
            'O item pai não pode ser o próprio chamado ou um filho',
          ),
        )
      }
    }

    if (next.customFields !== undefined) {
      const defs = await SdTicketContextRepository.listTicketCustomFields(
        ticket.workspaceId,
      )
      if (!defs.ok) return defs
      const merged = {
        ...(ticket.customFields as Record<string, unknown>),
        ...next.customFields,
      }
      const validated = validateSdTicketCustomFields(defs.value, merged, {
        type: ticket.type,
        categoryIds: [
          (data.categoryId as string | null | undefined) ?? ticket.categoryId,
          (data.subcategoryId as string | null | undefined) ??
            ticket.subcategoryId,
          (data.serviceId as string | null | undefined) ?? ticket.serviceId,
        ],
        checkRequired: false,
      })
      if (!validated.ok) return validated
      data.customFields = validated.value
    }

    const rest = Object.fromEntries(
      Object.entries(next).filter(
        ([key, value]) => value !== undefined && !HANDLED_KEYS.has(key),
      ),
    )
    Object.assign(data, rest)
    if (next.description !== undefined) {
      data.description = next.description
        ? sanitizeSdHtml(next.description)
        : null
    }
    if (next.tags !== undefined) data.tags = Array.from(new Set(next.tags))

    // Trocar o cliente recarimba o contrato (fatia de contratos e horas).
    if (
      next.customerId !== undefined &&
      next.customerId !== ticket.customerId
    ) {
      data.contractId = await resolveSdTicketContractId(
        ticket.workspaceId,
        next.customerId,
        ticket.type,
        now,
      )
    }

    // SLA: nova prioridade → nova política/prazos (a partir da abertura).
    if (
      next.priorityId !== undefined &&
      next.priorityId !== ticket.priorityId
    ) {
      const catalog = await resolveCatalog(ticket.workspaceId, ticket.type, {
        categoryId:
          (data.categoryId as string | null | undefined) ?? ticket.categoryId,
        subcategoryId:
          (data.subcategoryId as string | null | undefined) ??
          ticket.subcategoryId,
        serviceId:
          (data.serviceId as string | null | undefined) ?? ticket.serviceId,
      })
      const level = await priorityLevelOf(ticket.workspaceId, next.priorityId)
      if (!level.ok) return level
      const sla = await assignSla({
        workspaceId: ticket.workspaceId,
        settings: config.settings,
        facts: buildSdTicketFacts({
          ...ticket,
          ...(rest as Partial<SdFactSource>),
          phaseCategory: ticket.phase.category,
          priorityLevel: level.value,
        }),
        catalogChain: catalog.ok ? catalog.value.chain : [],
        priorityId: next.priorityId,
        start: ticket.createdAt,
        pausedMinutes: ticket.slaPausedMinutes,
      })
      if (!sla.ok) return sla
      data.slaPolicyId = sla.value.slaPolicyId ?? ticket.slaPolicyId
      if (!ticket.firstRespondedAt) {
        data.firstResponseDueAt = sla.value.firstResponseDueAt
        data.firstResponseBreached =
          !!sla.value.firstResponseDueAt && sla.value.firstResponseDueAt < now
      }
      if (!ticket.resolvedAt) {
        data.resolutionDueAt = sla.value.resolutionDueAt
        data.resolutionBreached =
          !!sla.value.resolutionDueAt && sla.value.resolutionDueAt < now
      }
      data.slaAtRiskNotifiedAt = null
    }

    if (options.touchActivity !== false) data.lastActivityAt = now

    // Agenda da mudança: congelamento e conflito de janela avisam antes de
    // gravar; um admin confirma e o que foi ignorado vira evento.
    let forcedSchedule: SdChangeWarningDTO[] = []
    if (
      next.plannedStartAt !== undefined ||
      next.plannedEndAt !== undefined ||
      next.configItemId !== undefined
    ) {
      const guard = await sdAssertChangeSchedule(
        {
          workspaceId: ticket.workspaceId,
          ticketId: ticket.id,
          type: ticket.type,
          configItemId:
            next.configItemId !== undefined
              ? next.configItemId
              : ticket.configItemId,
          departmentId:
            next.departmentId !== undefined
              ? next.departmentId
              : ticket.departmentId,
          plannedStartAt:
            next.plannedStartAt !== undefined
              ? next.plannedStartAt
              : ticket.plannedStartAt,
          plannedEndAt:
            next.plannedEndAt !== undefined
              ? next.plannedEndAt
              : ticket.plannedEndAt,
        },
        {
          // Sistema (automação, worker, e-mail) nunca é bloqueado: registra
          // o aviso na rastreabilidade e segue — quem decide é gente.
          confirm: options.confirmChangeSchedule ?? actor.kind === 'system',
          isAdmin:
            actor.kind === 'user' ? actor.isAdmin : actor.kind === 'system',
        },
      )
      if (!guard.ok) return guard
      forcedSchedule = guard.value.forced
    }

    const updated = await SdTicketRepository.update(ticket.id, data)
    if (!updated.ok) return updated
    const after = updated.value

    if (forcedSchedule.length > 0) {
      await recordSdTicketEvent({
        workspaceId: after.workspaceId,
        ticketId: after.id,
        ...eventActor(actor),
        action: 'change.schedule_forced',
        field: 'plannedStartAt',
        toValue: forcedSchedule.map((w) => ({
          id: w.windowId ?? w.ticketId ?? w.kind,
          label: w.message,
        })),
        meta: { kinds: [...new Set(forcedSchedule.map((w) => w.kind))] },
      })
    }

    const diffFields = Array.from(
      new Set([...Object.keys(data)].filter((f) => !NON_DIFF.has(f))),
    )
    const changesList = diffSdTickets(ticket, after, diffFields)
    if (changesList.length > 0) {
      await recordSdTicketEvent(
        changesList.map(
          (c): SdTicketEventInput => ({
            workspaceId: after.workspaceId,
            ticketId: after.id,
            ...eventActor(actor),
            action: 'field.changed',
            field: c.field,
            fromValue: c.from,
            toValue: c.to,
            meta: {
              label: sdFieldLabel(c.field),
              ...(options.eventMeta ?? {}),
            },
          }),
        ),
      )
    }

    const assigneeChanged = after.assigneeId !== ticket.assigneeId
    if (assigneeChanged) await notifyAssigned(after, config, actor)
    if (changesList.length > 0) {
      await publish(
        after,
        assigneeChanged ? 'ticket.assigned' : 'ticket.updated',
        actor,
        config,
      )
    }
    void indexSearchDocument('sd-ticket', after.workspaceId, after.id)
    return ok(after)
  },

  /** Move de fase aplicando todas as regras da fase de destino. */
  async changePhase(
    ticket: SdTicketWithRelations,
    targetPhaseId: string,
    actor: SdActor,
    config: SdEngineConfig,
    options: SdPhaseChangeOptions = {},
  ): Promise<Result<SdTicketWithRelations>> {
    const now = new Date()
    const { settings } = config
    const found = await SdTicketContextRepository.findPhase(
      ticket.workspaceId,
      targetPhaseId,
    )
    if (!found.ok) return found
    const target = found.value
    if (!target?.active || target.ticketType !== ticket.type) {
      return err(sdPhaseNotFound())
    }
    if (target.id === ticket.phaseId) return ok(ticket)

    // Transições (sem nenhuma cadastrada para o tipo = fluxo livre)
    const transitions = await SdTicketContextRepository.listTransitions(
      ticket.workspaceId,
      ticket.type,
    )
    if (!transitions.ok) return transitions
    if (transitions.value.length > 0) {
      const rule = transitions.value.find(
        (t) => t.fromPhaseId === ticket.phaseId && t.toPhaseId === target.id,
      )
      if (!rule) return err(sdPhaseTransitionNotAllowed())
      if (
        rule.allowedDepartmentIds.length > 0 &&
        actor.kind === 'user' &&
        !actor.isAdmin &&
        !rule.allowedDepartmentIds.some((id) =>
          actor.departmentIds.includes(id),
        )
      ) {
        return err(
          sdPhaseTransitionNotAllowed(
            'Seu departamento não pode mover o chamado para esta fase',
          ),
        )
      }
    }

    const solution = options.solution ?? ticket.solution
    const solutionClassificationId =
      options.solutionClassificationId ?? ticket.solutionClassificationId
    if (options.solutionClassificationId) {
      const valid = await validateRefs(
        ticket.workspaceId,
        { solutionClassificationId: options.solutionClassificationId },
        [],
      )
      if (!valid.ok) return valid
    }

    const state = { ...ticket, solution, solutionClassificationId } as Record<
      string,
      unknown
    >
    const missing = sdMissingRequiredFields(target.requiredFields, state)
    if (missing.length > 0) {
      return err(
        sdPhaseRequirementsUnmet(
          `Preencha antes de mover: ${missing.map(sdFieldLabel).join(', ')}`,
        ),
      )
    }

    if (target.requiresApproval) {
      // Rodada do comitê aprovada **ou** pedido avulso aprovado.
      const approved = await sdTicketApprovalSatisfied(ticket.id)
      if (!approved.ok) return approved
      if (!approved.value) return err(sdApprovalRequired())
    }

    if (target.category === 'RESOLVED' && settings.requireSolutionOnResolve) {
      if (!solution || solution.trim() === '') {
        return err(
          sdPhaseRequirementsUnmet('Informe a solução para resolver o chamado'),
        )
      }
      if (!solutionClassificationId) {
        const count =
          await SdTicketContextRepository.countSolutionClassifications(
            ticket.workspaceId,
            ticket.type,
          )
        if (!count.ok) return count
        if (count.value > 0) {
          return err(
            sdPhaseRequirementsUnmet('Informe a classificação da solução'),
          )
        }
      }
    }

    if (target.category === 'CLOSED' && settings.requireSignatureOnClose) {
      const signatures = await SdTicketContextRepository.countSignatures(
        ticket.id,
      )
      if (!signatures.ok) return signatures
      if (signatures.value === 0) return err(sdSignatureRequired())
    }

    const data: Prisma.SdTicketUncheckedUpdateInput = {
      phaseId: target.id,
      completionPercent: target.completionPercent,
      lastActivityAt: now,
    }
    if (options.solution !== undefined) data.solution = options.solution
    if (options.solutionClassificationId !== undefined) {
      data.solutionClassificationId = options.solutionClassificationId
    }

    // Pausa do SLA
    const targetPauses = target.pausesSla && !isFinal(target.category)
    if (ticket.slaPausedAt && !targetPauses) {
      const cal = ticketCalendar(ticket)
      const paused = businessMinutesBetween(ticket.slaPausedAt, now, cal)
      data.slaPausedAt = null
      data.slaPausedMinutes = ticket.slaPausedMinutes + paused
      if (ticket.firstResponseDueAt && !ticket.firstRespondedAt) {
        data.firstResponseDueAt = addBusinessMinutes(
          ticket.firstResponseDueAt,
          paused,
          cal,
        )
      }
      if (ticket.resolutionDueAt && !ticket.resolvedAt) {
        data.resolutionDueAt = addBusinessMinutes(
          ticket.resolutionDueAt,
          paused,
          cal,
        )
      }
    } else if (!ticket.slaPausedAt && targetPauses) {
      data.slaPausedAt = now
    }

    const reopened = isFinal(ticket.phase.category) && !isFinal(target.category)
    if (target.category === 'RESOLVED') {
      data.resolvedAt = now
      data.closedAt = null
    } else if (target.category === 'CLOSED') {
      data.closedAt = now
      if (!ticket.resolvedAt) data.resolvedAt = now
    } else if (target.category === 'CANCELED') {
      data.closedAt = now
    } else if (reopened) {
      data.reopenCount = ticket.reopenCount + 1
      data.resolvedAt = null
      data.closedAt = null
    }

    const updated = await SdTicketRepository.update(ticket.id, data)
    if (!updated.ok) return updated
    const after = updated.value

    const events: SdTicketEventInput[] = [
      {
        workspaceId: after.workspaceId,
        ticketId: after.id,
        ...eventActor(actor),
        action: 'phase.changed',
        field: 'phaseId',
        fromValue: { id: ticket.phase.id, label: ticket.phase.name },
        toValue: { id: target.id, label: target.name },
        meta: {
          fromCategory: ticket.phase.category,
          toCategory: target.category,
          ...(options.comment ? { comment: options.comment } : {}),
          ...(options.reason ? { reason: options.reason } : {}),
        },
      },
    ]
    for (const c of diffSdTickets(ticket, after, [
      'solution',
      'solutionClassificationId',
    ])) {
      events.push({
        workspaceId: after.workspaceId,
        ticketId: after.id,
        ...eventActor(actor),
        action: 'field.changed',
        field: c.field,
        fromValue: c.from,
        toValue: c.to,
        meta: { label: sdFieldLabel(c.field) },
      })
    }
    if (reopened) {
      events.push({
        workspaceId: after.workspaceId,
        ticketId: after.id,
        ...eventActor(actor),
        action: 'ticket.reopened',
        meta: { reopenCount: after.reopenCount },
      })
    }
    await recordSdTicketEvent(events)
    await notifyPhaseChange(ticket, after, target, config, actor, reopened)
    await publish(after, 'ticket.phase_changed', actor, config)
    void indexSearchDocument('sd-ticket', after.workspaceId, after.id)
    return ok(after)
  },

  /** Round-robin no departamento (padrão: o do chamado). */
  async roundRobin(
    ticket: SdTicketWithRelations,
    actor: SdActor,
    config: SdEngineConfig,
    departmentId?: string | null,
  ): Promise<Result<SdTicketWithRelations>> {
    const department = departmentId ?? ticket.departmentId
    if (!department) return ok(ticket)
    const picked = await SdTicketContextRepository.pickRoundRobinAssignee(
      department,
      new Date(),
    )
    if (!picked.ok) return picked
    if (!picked.value) return ok(ticket)
    return SdTicketEngine.update(
      ticket,
      {
        assigneeId: picked.value,
        ...(department !== ticket.departmentId
          ? { departmentId: department }
          : {}),
      },
      actor,
      config,
      { eventMeta: { via: 'round_robin' }, allowClosed: true },
    )
  },

  /**
   * Carimba a 1ª resposta (1ª mensagem pública de agente — chamado pela
   * fatia de mensagens). Idempotente.
   */
  async markFirstResponse(
    ticketId: string,
    at = new Date(),
  ): Promise<Result<boolean>> {
    return SdTicketRepository.markFirstResponse(ticketId, at)
  },

  /** Atualiza `lastActivityAt` (mensagens, tarefas…). */
  async touchActivity(
    ticketId: string,
    at = new Date(),
  ): Promise<Result<void>> {
    return SdTicketRepository.touchActivity(ticketId, at)
  },

  /**
   * Reabre um chamado RESOLVED (ex.: resposta do solicitante com
   * `reopenOnRequesterReply`): vai para a 1ª fase IN_PROGRESS do tipo,
   * senão a inicial.
   */
  async reopen(
    ticket: SdTicketWithRelations,
    actor: SdActor,
    config: SdEngineConfig,
  ): Promise<Result<SdTicketWithRelations>> {
    if (!isFinal(ticket.phase.category)) return ok(ticket)
    const inProgress = await SdTicketContextRepository.findFirstPhaseByCategory(
      ticket.workspaceId,
      ticket.type,
      'IN_PROGRESS',
    )
    if (!inProgress.ok) return inProgress
    let target = inProgress.value
    if (!target) {
      const initial = await SdTicketContextRepository.findInitialPhase(
        ticket.workspaceId,
        ticket.type,
      )
      if (!initial.ok) return initial
      target = initial.value
    }
    if (!target) return err(sdPhaseNotFound())
    return SdTicketEngine.changePhase(ticket, target.id, actor, config, {
      reason: 'reopen',
    })
  },
}

/** Chaves de `SdEngineChanges` tratadas à parte no `update`. */
const HANDLED_KEYS = new Set([
  'categoryId',
  'subcategoryId',
  'serviceId',
  'customFields',
  'description',
  'tags',
])

/** Colunas técnicas que não viram evento de "campo alterado". */
const NON_DIFF = new Set([
  'lastActivityAt',
  'slaPolicyId',
  'firstResponseDueAt',
  'resolutionDueAt',
  'firstResponseBreached',
  'resolutionBreached',
  'slaAtRiskNotifiedAt',
])
