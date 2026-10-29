import {
  parseCrmWorkflowDefinition,
  triggerTypeToPrisma,
} from '@/src/mappers/crm-workflow.mapper'
import {
  CrmWorkflowRepository,
  CrmWorkflowRunRepository,
} from '@/src/repositories/crm-workflow.repository'
import type {
  CrmWorkflowLeadEvent,
  CrmWorkflowNewsletterSource,
  CrmWorkflowNewsletterTriggerType,
  CrmWorkflowTriggerEntity,
  CrmWorkflowTriggerType,
} from '@/src/schemas/crm-workflow.schema'
import { runCrmWorkflow } from '@/src/services/crm-workflow-runner'

type Event = 'created' | 'updated' | 'deleted'

const EVENT_TO_TRIGGER: Record<Event, CrmWorkflowTriggerType[]> = {
  created: ['record-is-created', 'record-is-created-or-updated'],
  updated: ['record-is-updated', 'record-is-created-or-updated'],
  deleted: ['record-is-deleted'],
}

/**
 * Disparado pelos services CRUD (Company/Person/Opportunity/Task/Note/Lead) após
 * commit — mesmo ponto de chamada de `recordCrmActivity`, mas para
 * automação em vez de timeline. Carrega workflows ACTIVE da workspace,
 * filtra pelos que casam com `(entity, event)` e dispara uma run por match.
 * Best-effort: nunca lança — erros do runner ficam persistidos no próprio
 * `CrmWorkflowRun`.
 */
export async function dispatchCrmWorkflowRecordEvent(params: {
  workspaceId: string
  actorUserId: string
  entity: CrmWorkflowTriggerEntity
  event: Event
  record: unknown
  changedFields?: string[]
  /** Eventos de domínio do lead carregados por este update (etapa, ganho,
   * perdido). Um trigger com `leadEvent` só casa se o evento estiver aqui. */
  leadEvents?: CrmWorkflowLeadEvent[]
}): Promise<void> {
  const candidates = EVENT_TO_TRIGGER[params.event]
  const wfList = await CrmWorkflowRepository.findActiveByWorkspace(
    params.workspaceId,
  )
  if (!wfList.ok || wfList.value.length === 0) return

  for (const wf of wfList.value) {
    if (!wf.activeVersion) continue
    const definition = parseCrmWorkflowDefinition(wf.activeVersion.definition)
    const trigger = definition.trigger.data
    if (!trigger) continue
    if (!candidates.includes(trigger.type)) continue
    if ('entity' in trigger && trigger.entity !== params.entity) continue
    if (
      'leadEvent' in trigger &&
      trigger.leadEvent &&
      !params.leadEvents?.includes(trigger.leadEvent)
    ) {
      continue
    }

    // Trigger update/created-or-updated com `fields` exige interseção.
    if (
      'fields' in trigger &&
      Array.isArray(trigger.fields) &&
      trigger.fields.length > 0 &&
      params.changedFields &&
      params.changedFields.length > 0
    ) {
      const hit = params.changedFields.some((f) => trigger.fields.includes(f))
      if (!hit) continue
    }

    const payload = {
      event: params.event,
      record: params.record,
      changedFields: params.changedFields ?? [],
      ...(params.leadEvents ? { leadEvents: params.leadEvents } : {}),
    }
    const run = await CrmWorkflowRunRepository.create({
      workflowId: wf.id,
      versionId: wf.activeVersion.id,
      triggerType: triggerTypeToPrisma(trigger.type),
      triggerPayload: payload as object,
      startedById: params.actorUserId,
    })
    if (!run.ok) continue

    // Não bloqueia o caller; o runner cuida do status. Erros ficam
    // persistidos no próprio run + steps.
    void runCrmWorkflow({
      runId: run.value.id,
      workspaceId: params.workspaceId,
      actingUserId: params.actorUserId,
      definition,
      triggerType: trigger.type,
      triggerPayload: payload,
      testMode: false,
    }).catch(() => {
      // erros já persistidos no CrmWorkflowRun pelo próprio runner.
    })
  }
}

/** Payload of a newsletter trigger: `record` is the subscriber, so
 * `{{trigger.record.email}}` works like in the record triggers. */
export type CrmWorkflowNewsletterPayload = {
  newsletter: { id: string; name: string }
  record: {
    id: string
    email: string
    name: string | null
    status: string
    personId: string | null
  }
  issue?: { id: string; subject: string; number: number | null }
  /** Opens and clicks: a regular issue or a welcome series e-mail. */
  source?: CrmWorkflowNewsletterSource
  /** Welcome series e-mail (`source: 'welcome'`); `position` is 1-based. */
  welcomeStep?: { id: string; subject: string; position: number }
  url?: string
}

/**
 * Newsletter bridge (ADR 0054 phase 2): fires the ACTIVE workflows whose
 * trigger is `type` and whose filters (newsletter, "URL contains", issue vs
 * welcome series) match.
 * The event comes from the public side (visitor, Resend webhook), so the run
 * has no starter and acts as the workflow's creator, like the webhook
 * trigger. Best-effort like `dispatchCrmWorkflowRecordEvent`: never throws.
 */
export async function dispatchCrmWorkflowNewsletterEvent(params: {
  workspaceId: string
  type: CrmWorkflowNewsletterTriggerType
  payload: CrmWorkflowNewsletterPayload
}): Promise<number> {
  const wfList = await CrmWorkflowRepository.findActiveByWorkspace(
    params.workspaceId,
  )
  if (!wfList.ok) return 0

  let started = 0
  for (const wf of wfList.value) {
    if (!wf.activeVersion) continue
    const definition = parseCrmWorkflowDefinition(wf.activeVersion.definition)
    const trigger = definition.trigger.data
    if (!trigger || trigger.type !== params.type) continue
    if (
      'newsletterId' in trigger &&
      trigger.newsletterId &&
      trigger.newsletterId !== params.payload.newsletter.id
    ) {
      continue
    }
    if (
      'source' in trigger &&
      trigger.source &&
      trigger.source !== (params.payload.source ?? 'issue')
    ) {
      continue
    }
    if ('urlContains' in trigger && trigger.urlContains) {
      const url = (params.payload.url ?? '').toLowerCase()
      if (!url.includes(trigger.urlContains.toLowerCase())) continue
    }

    const payload = { event: params.type, ...params.payload }
    const run = await CrmWorkflowRunRepository.create({
      workflowId: wf.id,
      versionId: wf.activeVersion.id,
      triggerType: triggerTypeToPrisma(trigger.type),
      triggerPayload: payload as object,
      startedById: null,
    })
    if (!run.ok) continue
    started++

    void runCrmWorkflow({
      runId: run.value.id,
      workspaceId: params.workspaceId,
      actingUserId: wf.createdById,
      definition,
      triggerType: trigger.type,
      triggerPayload: payload,
      testMode: false,
    }).catch(() => {
      // errors are persisted on the CrmWorkflowRun by the runner.
    })
  }
  return started
}
