import type { CrmCadenceStep } from '@prisma/client'
import { logger } from '@/lib/axiom/logger'
import {
  cadenceDelayMs,
  cadenceTextToHtml,
  leadPhoneToWaId,
  renderCadenceText,
} from '@/src/lib/crm-cadence/merge'
import {
  isWithinSendWindow,
  nextSendWindowOpen,
} from '@/src/lib/crm-campaign/send-window'
import { sendEmail } from '@/src/lib/mail/send'
import { ok, type Result } from '@/src/lib/result'
import { checkCampaignSender } from '@/src/lib/sending-domain/campaign-sender'
import { WhatsAppSend } from '@/src/lib/whatsapp/send'
import { applyTemplateSendExtras } from '@/src/lib/whatsapp/template-send'
import {
  type CrmCadenceEnrollmentForRun,
  CrmCadenceEnrollmentRepository,
  CrmCadenceLookupRepository,
} from '@/src/repositories/crm-cadence.repository'
import { CrmCampaignLookupRepository } from '@/src/repositories/crm-campaign-lookup.repository'
import { CrmLeadRepository } from '@/src/repositories/crm-lead.repository'
import { CrmTaskRepository } from '@/src/repositories/crm-task.repository'

/**
 * Runs the due steps of the sales cadences (worker tick, slice
 * c1-sales-cadences). An enrollment is claimed (`FOR UPDATE SKIP LOCKED`),
 * its current step is executed and the enrollment moves to the next step in
 * one transaction. A step that cannot go out because of the lead (no e-mail,
 * opted out) is SKIPPED; one that fails for a lasting reason is FAILED; both
 * advance the cadence. Transient problems (rate limit, connection down)
 * keep the position and retry later. A crash between the send and the
 * bookkeeping makes the stale claim run the same step again, so a duplicate
 * message is possible in that rare case.
 */

export const CADENCE_TICK_LIMIT = 200
export const CADENCE_STALE_CLAIM_MS = 10 * 60 * 1000
export const CADENCE_RETRY_MS = 10 * 60 * 1000
export const CADENCE_CONNECTION_RETRY_MS = 30 * 60 * 1000

export interface CadenceTickResult {
  claimed: number
  sent: number
  skipped: number
  failed: number
  completed: number
  rescheduled: number
  stopped: number
  errors: number
}

type StepOutcome =
  | {
      kind: 'done'
      status: 'SENT' | 'SKIPPED' | 'FAILED'
      detail: string
      providerMessageId?: string
    }
  | { kind: 'retry'; delayMs: number; reason: string }

type Enrollment = CrmCadenceEnrollmentForRun

const isEmailLike = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)

const skipped = (detail: string): StepOutcome => ({
  kind: 'done',
  status: 'SKIPPED',
  detail,
})
const failed = (detail: string): StepOutcome => ({
  kind: 'done',
  status: 'FAILED',
  detail,
})

const isTransient = (message: string) =>
  /rate.?limit|429|too many|timeout|timed out|ECONN|ETIMEDOUT|fetch failed|socket|5\d\d|internal server/i.test(
    message,
  )

function mergeContext(enrollment: Enrollment) {
  const { lead } = enrollment
  return {
    name: lead.name,
    company: lead.company,
    jobTitle: lead.jobTitle,
    city: lead.city,
    ownerName: lead.owner?.name ?? null,
  }
}

async function runEmailStep(
  enrollment: Enrollment,
  step: CrmCadenceStep,
): Promise<StepOutcome> {
  const { cadence, lead } = enrollment
  const to = lead.emails.map((email) => email.trim()).find(isEmailLike)
  if (!to) return skipped('O lead não tem e-mail')

  const optedOut = await CrmCadenceLookupRepository.emailOptedOut(
    enrollment.workspaceId,
    to,
  )
  if (!optedOut.ok) {
    return {
      kind: 'retry',
      delayMs: CADENCE_RETRY_MS,
      reason: optedOut.error.code,
    }
  }
  if (optedOut.value) return skipped('O e-mail está descadastrado')

  if (!cadence.emailFrom)
    return failed('A cadência não tem remetente de e-mail')
  const sender = await checkCampaignSender(
    enrollment.workspaceId,
    cadence.emailFrom,
  )
  if (!sender.ok) {
    if (sender.error.code === 'DATABASE_ERROR') {
      return {
        kind: 'retry',
        delayMs: CADENCE_RETRY_MS,
        reason: sender.error.code,
      }
    }
    return failed(sender.error.message)
  }

  const context = mergeContext(enrollment)
  const subject = renderCadenceText(step.subject ?? '', context)
  const text = renderCadenceText(step.body, context)
  const footer =
    'Se não quiser receber mais mensagens, é só responder este e-mail avisando.'
  try {
    const sent = await sendEmail({
      from: cadence.emailFrom,
      to,
      subject,
      html: `${cadenceTextToHtml(text)}<p style="margin:24px 0 0;color:#6b7280;font-size:12px">${footer}</p>`,
      text: `${text}\n\n--\n${footer}`,
      replyTo: cadence.emailReplyTo ?? lead.owner?.email ?? undefined,
    })
    return {
      kind: 'done',
      status: 'SENT',
      providerMessageId: sent.id,
      detail: to,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Falha ao enviar'
    return isTransient(message)
      ? { kind: 'retry', delayMs: CADENCE_RETRY_MS, reason: message }
      : failed(message)
  }
}

async function runWhatsAppStep(
  enrollment: Enrollment,
  step: CrmCadenceStep,
): Promise<StepOutcome> {
  const { cadence, lead, workspaceId } = enrollment
  const waId = lead.phones
    .map((phone) => leadPhoneToWaId(phone))
    .find((value): value is string => value !== null)
  if (!waId) return skipped('O lead não tem telefone')
  if (!cadence.whatsappConnectionId) {
    return failed('A cadência não tem conexão de WhatsApp')
  }

  const optedOut = await CrmCadenceLookupRepository.whatsappOptedOut(
    workspaceId,
    waId,
  )
  if (!optedOut.ok) {
    return {
      kind: 'retry',
      delayMs: CADENCE_RETRY_MS,
      reason: optedOut.error.code,
    }
  }
  if (optedOut.value)
    return skipped('O contato pediu para não receber mensagens')

  const connection = await CrmCampaignLookupRepository.findConnection(
    workspaceId,
    cadence.whatsappConnectionId,
  )
  if (!connection.ok) {
    return {
      kind: 'retry',
      delayMs: CADENCE_RETRY_MS,
      reason: connection.error.code,
    }
  }
  if (!connection.value) return failed('A conexão de WhatsApp não existe mais')
  if (connection.value.status !== 'CONNECTED') {
    return {
      kind: 'retry',
      delayMs: CADENCE_CONNECTION_RETRY_MS,
      reason: 'connection not connected',
    }
  }

  const context = mergeContext(enrollment)
  const cost = { source: 'CRM_CAMPAIGN' } as const
  let sent: Result<{ providerMessageId: string }>
  if (connection.value.provider === 'META') {
    // Outside the 24 h window Meta only delivers approved templates.
    if (!step.whatsappTemplateId) {
      return failed('Na conexão da Meta o passo precisa de um template')
    }
    const template = await CrmCampaignLookupRepository.findWhatsAppTemplate(
      workspaceId,
      connection.value.id,
      step.whatsappTemplateId,
    )
    if (!template.ok) {
      return {
        kind: 'retry',
        delayMs: CADENCE_RETRY_MS,
        reason: template.error.code,
      }
    }
    if (template.value?.status !== 'APPROVED') {
      return failed('O template da Meta não está aprovado')
    }
    const variables = step.templateVariables.map((value) =>
      renderCadenceText(value, context),
    )
    const components =
      variables.length > 0
        ? [
            {
              type: 'body',
              parameters: variables.map((text) => ({ type: 'text', text })),
            },
          ]
        : []
    sent = await WhatsAppSend.template(
      connection.value,
      {
        to: waId,
        templateName: template.value.name,
        language: template.value.language,
        components: applyTemplateSendExtras(template.value, components)
          .components,
      },
      { cost: { ...cost, templateCategory: template.value.category } },
    )
  } else {
    sent = await WhatsAppSend.text(
      connection.value,
      { to: waId, text: renderCadenceText(step.body, context) },
      { cost },
    )
  }

  if (!sent.ok) {
    return sent.error.code === 'RATE_LIMITED' || isTransient(sent.error.message)
      ? { kind: 'retry', delayMs: CADENCE_RETRY_MS, reason: sent.error.message }
      : failed(sent.error.message)
  }
  return {
    kind: 'done',
    status: 'SENT',
    providerMessageId: sent.value.providerMessageId,
    detail: waId,
  }
}

async function runTaskStep(
  enrollment: Enrollment,
  step: CrmCadenceStep,
  now: Date,
): Promise<StepOutcome> {
  const context = mergeContext(enrollment)
  const { lead } = enrollment
  const created = await CrmTaskRepository.create({
    workspaceId: enrollment.workspaceId,
    createdById: enrollment.enrolledById,
    title: renderCadenceText(step.subject ?? '', context),
    body: [
      renderCadenceText(step.body, context),
      `Cadência "${enrollment.cadence.name}" · lead ${lead.name}`,
    ]
      .filter(Boolean)
      .join('\n\n'),
    dueDate: now,
    assigneeId: lead.ownerId ?? enrollment.enrolledById,
    personId: lead.convertedPersonId ?? undefined,
  })
  if (!created.ok) {
    return {
      kind: 'retry',
      delayMs: CADENCE_RETRY_MS,
      reason: created.error.code,
    }
  }
  return { kind: 'done', status: 'SENT', detail: created.value.id }
}

/** The lead's CRM history shows the cadence touch like any other attempt. */
async function recordContactAttempt(
  enrollment: Enrollment,
  step: CrmCadenceStep,
  contactedWith: string,
  now: Date,
): Promise<void> {
  if (step.type === 'TASK') return
  const recorded = await CrmLeadRepository.createContactAttempt({
    leadId: enrollment.leadId,
    workspaceId: enrollment.workspaceId,
    createdById: enrollment.enrolledById,
    contactedWith,
    channel: step.type === 'EMAIL' ? 'EMAIL' : 'WHATSAPP',
    outcome: 'ATTEMPTED',
    occurredAt: now,
    note: `Cadência "${enrollment.cadence.name}" — passo ${step.position + 1}`,
  })
  if (!recorded.ok) {
    logger.warn('crm.cadence.contact_attempt_failed', {
      component: 'CrmCadenceRunService',
      enrollmentId: enrollment.id,
      reason: recorded.error.code,
    })
  }
}

type EnrollmentResult =
  | 'sent'
  | 'skipped'
  | 'failed'
  | 'completed'
  | 'rescheduled'
  | 'stopped'

export const CrmCadenceRunService = {
  async processEnrollment(
    enrollment: Enrollment,
    now: Date,
  ): Promise<Result<EnrollmentResult>> {
    const R = CrmCadenceEnrollmentRepository
    const { cadence, lead } = enrollment

    if (lead.deletedAt || lead.stage === 'CLOSED') {
      const stopped = await R.finish(
        [enrollment.id],
        'STOPPED',
        lead.deletedAt ? 'LEAD_DELETED' : 'LEAD_CLOSED',
        null,
        now,
      )
      return stopped.ok ? ok('stopped') : stopped
    }

    const step = cadence.steps.find(
      (item) => item.position === enrollment.nextPosition,
    )
    if (!step) {
      const done = await R.complete(enrollment.id, now)
      return done.ok ? ok('completed') : done
    }

    if (step.type !== 'TASK') {
      const window = {
        startHour: cadence.windowStartHour,
        endHour: cadence.windowEndHour,
        weekdaysOnly: cadence.weekdaysOnly,
      }
      if (!isWithinSendWindow(now, window)) {
        const moved = await R.reschedule(
          enrollment.id,
          nextSendWindowOpen(now, window),
        )
        return moved.ok ? ok('rescheduled') : moved
      }
    }

    const outcome =
      step.type === 'EMAIL'
        ? await runEmailStep(enrollment, step)
        : step.type === 'WHATSAPP'
          ? await runWhatsAppStep(enrollment, step)
          : await runTaskStep(enrollment, step, now)

    if (outcome.kind === 'retry') {
      logger.warn('crm.cadence.step_retry', {
        component: 'CrmCadenceRunService',
        enrollmentId: enrollment.id,
        position: step.position,
        reason: outcome.reason,
      })
      const moved = await R.reschedule(
        enrollment.id,
        new Date(now.getTime() + outcome.delayMs),
      )
      return moved.ok ? ok('rescheduled') : moved
    }

    const following = cadence.steps.find(
      (item) => item.position === step.position + 1,
    )
    const applied = await R.completeStep({
      enrollmentId: enrollment.id,
      workspaceId: enrollment.workspaceId,
      cadenceId: cadence.id,
      stepId: step.id,
      position: step.position,
      type: step.type,
      status: outcome.status,
      detail: outcome.detail,
      providerMessageId: outcome.providerMessageId,
      next: following
        ? {
            position: following.position,
            runAt: new Date(
              now.getTime() +
                cadenceDelayMs(following.delayValue, following.delayUnit),
            ),
          }
        : null,
      now,
    })
    if (!applied.ok) return applied
    if (!applied.value) return ok('stopped')

    if (outcome.status === 'SENT') {
      await recordContactAttempt(enrollment, step, outcome.detail, now)
    }
    if (!following) return ok('completed')
    return ok(
      outcome.status === 'SENT'
        ? 'sent'
        : outcome.status === 'SKIPPED'
          ? 'skipped'
          : 'failed',
    )
  },

  /** Worker tick: runs up to CADENCE_TICK_LIMIT due enrollments. */
  async tick(now: Date = new Date()): Promise<Result<CadenceTickResult>> {
    const claimed = await CrmCadenceEnrollmentRepository.claimDue(
      now,
      new Date(now.getTime() - CADENCE_STALE_CLAIM_MS),
      CADENCE_TICK_LIMIT,
    )
    if (!claimed.ok) return claimed

    const total: CadenceTickResult = {
      claimed: claimed.value.length,
      sent: 0,
      skipped: 0,
      failed: 0,
      completed: 0,
      rescheduled: 0,
      stopped: 0,
      errors: 0,
    }
    for (const enrollment of claimed.value) {
      const result = await CrmCadenceRunService.processEnrollment(
        enrollment,
        now,
      )
      if (!result.ok) {
        // The claim goes stale and the enrollment is taken again later.
        logger.error('crm.cadence.enrollment_failed', {
          component: 'CrmCadenceRunService',
          enrollmentId: enrollment.id,
          reason: result.error.code,
        })
        total.errors += 1
        continue
      }
      total[result.value] += 1
    }
    return ok(total)
  },
}
