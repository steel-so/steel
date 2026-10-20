import { createId } from '@paralleldrive/cuid2'
import type {
  WhatsAppAutoOutreach,
  WhatsAppConnection,
  WhatsAppTemplate,
} from '@prisma/client'
import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import {
  whatsappAutoOutreachNotReady,
  whatsappAutoOutreachRunning,
  whatsappConnectionNotFound,
  whatsappTemplateNotFound,
} from '@/src/errors'
import type { PermissionAction } from '@/src/lib/permissions'
import { WhatsappBroadcastJob } from '@/src/lib/queue/jobs'
import { getWhatsappBroadcastQueue } from '@/src/lib/queue/queues'
import { err, ok, type Result } from '@/src/lib/result'
import {
  autoOutreachTemplateProblem,
  buildAutoOutreachTemplate,
  WHATSAPP_AUTO_OUTREACH_DEFAULT_INTERVAL_SECONDS,
  WHATSAPP_AUTO_OUTREACH_MAX_QUEUE,
  WHATSAPP_AUTO_OUTREACH_SKIP_DELAY_MS,
} from '@/src/lib/whatsapp/auto-outreach'
import { publishWhatsAppEvent } from '@/src/lib/whatsapp/realtime'
import { WhatsAppSend } from '@/src/lib/whatsapp/send'
import { applyTemplateSendExtras } from '@/src/lib/whatsapp/template-send'
import { toWhatsAppConversationDTO } from '@/src/mappers/whatsapp-conversation.mapper'
import { toWhatsAppMessageDTO } from '@/src/mappers/whatsapp-message.mapper'
import { WhatsAppAiConfigRepository } from '@/src/repositories/whatsapp-ai-config.repository'
import {
  type WhatsAppAutoOutreachRecipientWithContact,
  WhatsAppAutoOutreachRepository,
} from '@/src/repositories/whatsapp-auto-outreach.repository'
import { WhatsAppConnectionRepository } from '@/src/repositories/whatsapp-connection.repository'
import { WhatsAppConversationRepository } from '@/src/repositories/whatsapp-conversation.repository'
import { WhatsAppMessageRepository } from '@/src/repositories/whatsapp-message.repository'
import { WhatsAppTemplateRepository } from '@/src/repositories/whatsapp-template.repository'
import type {
  ClearWhatsAppAutoOutreachDTO,
  ConfigureWhatsAppAutoOutreachDTO,
  QueueWhatsAppAutoOutreachDTO,
} from '@/src/schemas/whatsapp-auto-outreach.schema'
import type { WhatsAppAutoOutreachDTO } from '@/types/whatsapp-auto-outreach'
import { assertModuleMember } from './authz'
import { WhatsAppBusinessHoursService } from './whatsapp-business-hours.service'
import { reopenWhatsAppConversation } from './whatsapp-conversation.service'
import { WhatsAppUsageService } from './whatsapp-usage.service'

/** Errors that stop the run: retrying would fail again until someone acts. */
const PAUSING_ERRORS = new Set([
  'WHATSAPP_MESSAGE_LIMIT_REACHED',
  'WHATSAPP_CONVERSATION_LIMIT_REACHED',
])

export type WhatsAppAutoOutreachStepOutcome =
  | { status: 'stopped' }
  | { status: 'done' }
  | { status: 'paused'; reason: string }
  /** Outside business hours: the chain sleeps until the opening. */
  | { status: 'waiting'; resumeAt: Date }
  | { status: 'sent' | 'failed' | 'skipped' | 'retry'; nextDelayMs: number }

async function authorize(
  actorId: string,
  workspaceId: string,
  action: PermissionAction,
) {
  return assertModuleMember(actorId, workspaceId, 'COMMUNICATION', {
    resource: 'broadcasts',
    action,
  })
}

async function toDTO(
  outreach: WhatsAppAutoOutreach | null,
): Promise<Result<WhatsAppAutoOutreachDTO>> {
  if (!outreach) {
    return ok({
      status: 'IDLE',
      connectionId: null,
      templateId: null,
      intervalSeconds: WHATSAPP_AUTO_OUTREACH_DEFAULT_INTERVAL_SECONDS,
      pending: 0,
      sent: 0,
      failed: 0,
      skipped: 0,
      lastSentAt: null,
      lastError: null,
    })
  }
  const counts = await WhatsAppAutoOutreachRepository.countRecipients(
    outreach.id,
  )
  if (!counts.ok) return counts
  return ok({
    status: outreach.status,
    connectionId: outreach.connectionId,
    templateId: outreach.templateId,
    intervalSeconds: outreach.intervalSeconds,
    pending: counts.value.PENDING,
    sent: counts.value.SENT,
    failed: counts.value.FAILED,
    skipped: counts.value.SKIPPED,
    lastSentAt: outreach.lastSentAt?.toISOString() ?? null,
    lastError: outreach.lastError,
  })
}

/** Connection + template of the outreach, checked for automatic sending. */
async function loadSendable(
  workspaceId: string,
  connectionId: string | null,
  templateId: string | null,
): Promise<
  Result<{ connection: WhatsAppConnection; template: WhatsAppTemplate }>
> {
  if (!connectionId || !templateId) return err(whatsappAutoOutreachNotReady())
  const [connection, template] = await Promise.all([
    WhatsAppConnectionRepository.findById(connectionId, workspaceId),
    WhatsAppTemplateRepository.findById(templateId, workspaceId),
  ])
  if (!connection.ok) return connection
  if (!template.ok) return template
  if (!connection.value) return err(whatsappConnectionNotFound())
  if (!template.value || template.value.connectionId !== connectionId) {
    return err(whatsappTemplateNotFound())
  }
  const problem = autoOutreachTemplateProblem(connection.value, template.value)
  if (problem) return err(whatsappAutoOutreachNotReady(problem))
  return ok({ connection: connection.value, template: template.value })
}

async function enqueueNext(
  workspaceId: string,
  runToken: string,
  delayMs: number,
): Promise<void> {
  await getWhatsappBroadcastQueue().add(
    WhatsappBroadcastJob.SendAutoOutreachNext,
    { workspaceId, runToken },
    // No automatic retry of a send that may have reached the contact; the
    // chain itself moves on (and a DB failure retries via BullMQ).
    { delay: delayMs, jobId: `auto-outreach-${runToken}-${createId()}` },
  )
}

/**
 * Opens (or reopens) the contact's conversation for the template, with the
 * AI answering per the workspace AI config. A contact already in service
 * (open conversation) is skipped — `null`.
 */
async function conversationFor(
  recipient: WhatsAppAutoOutreachRecipientWithContact,
  connection: WhatsAppConnection,
): Promise<Result<{ id: string } | null>> {
  const workspaceId = connection.workspaceId
  const open = await WhatsAppConversationRepository.findActiveByContact(
    workspaceId,
    recipient.contactId,
  )
  if (!open.ok) return open
  if (open.value) return ok(null)

  const aiConfig = await WhatsAppAiConfigRepository.findByWorkspace(workspaceId)
  if (!aiConfig.ok) return aiConfig
  const aiActive = aiConfig.value?.active ?? false

  const allowed = await WhatsAppUsageService.assertCanSend(
    workspaceId,
    'conversations',
  )
  if (!allowed.ok) return allowed

  const closed = await WhatsAppConversationRepository.findLatestClosedByContact(
    workspaceId,
    recipient.contactId,
  )
  if (!closed.ok) return closed

  let conversationId: string
  if (closed.value) {
    const reopened = await reopenWhatsAppConversation(closed.value, {
      actorUserId: null,
      source: 'AUTO_OUTREACH',
      extra: { aiActive, aiHandoff: false },
    })
    if (!reopened.ok) return reopened
    conversationId = reopened.value.id
  } else {
    const created = await WhatsAppConversationRepository.create({
      workspaceId,
      connectionId: connection.id,
      contactId: recipient.contactId,
      status: 'NEW',
      aiActive,
      aiHandoff: false,
    })
    if (!created.ok) return created
    conversationId = created.value.id
  }
  await WhatsAppUsageService.record(workspaceId, 'conversations')
  return ok({ id: conversationId })
}

/** Records the sent template in the conversation (as sent by the AI). */
async function recordOutboundTemplate(input: {
  workspaceId: string
  conversationId: string
  providerMessageId: string
  text: string
}): Promise<void> {
  const message = await WhatsAppMessageRepository.create({
    workspaceId: input.workspaceId,
    conversationId: input.conversationId,
    direction: 'OUT',
    type: 'TEMPLATE',
    text: input.text,
    providerMessageId: input.providerMessageId,
    status: 'SENT',
    sentByAi: true,
  })
  if (!message.ok) return
  await WhatsAppConversationRepository.update(input.conversationId, {
    lastMessageAt: new Date(),
  })
  await publishWhatsAppEvent(input.workspaceId, {
    type: 'message.created',
    conversationId: input.conversationId,
    message: toWhatsAppMessageDTO(message.value),
  })
  const fresh = await WhatsAppConversationRepository.findById(
    input.conversationId,
    input.workspaceId,
  )
  if (fresh.ok && fresh.value) {
    await publishWhatsAppEvent(input.workspaceId, {
      type: 'conversation.updated',
      conversation: toWhatsAppConversationDTO(fresh.value),
    })
  }
}

export const WhatsAppAutoOutreachService = {
  async get(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<WhatsAppAutoOutreachDTO>> {
    const membership = await authorize(actorId, workspaceId, 'VIEW')
    if (!membership.ok) return membership

    const outreach =
      await WhatsAppAutoOutreachRepository.findByWorkspace(workspaceId)
    if (!outreach.ok) return outreach
    return toDTO(outreach.value)
  },

  /**
   * Picks the connection and the approved template (stopped only) and/or
   * the aggressiveness (interval between sends), which the next step of a
   * running outreach already uses.
   */
  async configure(
    actorId: string,
    workspaceId: string,
    dto: ConfigureWhatsAppAutoOutreachDTO,
  ): Promise<Result<WhatsAppAutoOutreachDTO>> {
    const membership = await authorize(actorId, workspaceId, 'EDIT')
    if (!membership.ok) return membership

    const existing =
      await WhatsAppAutoOutreachRepository.findByWorkspace(workspaceId)
    if (!existing.ok) return existing

    const changesTemplate = dto.connectionId !== undefined
    if (changesTemplate) {
      if (existing.value?.status === 'RUNNING') {
        return err(whatsappAutoOutreachRunning())
      }
      const sendable = await loadSendable(
        workspaceId,
        dto.connectionId ?? null,
        dto.templateId ?? null,
      )
      if (!sendable.ok) return sendable
    }

    const saved = await WhatsAppAutoOutreachRepository.upsert(workspaceId, {
      ...(changesTemplate
        ? {
            connectionId: dto.connectionId,
            templateId: dto.templateId,
            lastError: null,
          }
        : {}),
      ...(dto.intervalSeconds !== undefined
        ? { intervalSeconds: dto.intervalSeconds }
        : {}),
      updatedById: actorId,
    })
    if (!saved.ok) return saved

    auditMutation({
      entity: 'whatsapp_auto_outreach',
      action: 'update',
      actorId,
      targetId: saved.value.id,
      meta: {
        workspaceId,
        templateId: dto.templateId,
        intervalSeconds: dto.intervalSeconds,
      },
    })
    return toDTO(saved.value)
  },

  /** Queues contacts (selected or all); opted-out ones are left out. */
  async queue(
    actorId: string,
    workspaceId: string,
    dto: QueueWhatsAppAutoOutreachDTO,
  ): Promise<Result<WhatsAppAutoOutreachDTO & { added: number }>> {
    const membership = await authorize(actorId, workspaceId, 'EDIT')
    if (!membership.ok) return membership

    const existing =
      await WhatsAppAutoOutreachRepository.findByWorkspace(workspaceId)
    if (!existing.ok) return existing
    let row = existing.value
    if (!row) {
      const created = await WhatsAppAutoOutreachRepository.upsert(workspaceId, {
        updatedById: actorId,
      })
      if (!created.ok) return created
      row = created.value
    }

    const contactIds =
      await WhatsAppAutoOutreachRepository.listQueueableContactIds(
        workspaceId,
        dto.all ? null : (dto.contactIds ?? []),
        WHATSAPP_AUTO_OUTREACH_MAX_QUEUE,
      )
    if (!contactIds.ok) return contactIds

    const added = await WhatsAppAutoOutreachRepository.addRecipients(
      row.id,
      contactIds.value,
    )
    if (!added.ok) return added

    // A finished run picks up the new contacts on the next play.
    if (row.status === 'DONE' && added.value > 0) {
      const reset = await WhatsAppAutoOutreachRepository.update(row.id, {
        status: 'PAUSED',
      })
      if (!reset.ok) return reset
      row = reset.value
    }

    auditMutation({
      entity: 'whatsapp_auto_outreach',
      action: 'update',
      actorId,
      targetId: row.id,
      meta: { workspaceId, queued: added.value, all: dto.all === true },
    })
    const dtoResult = await toDTO(row)
    if (!dtoResult.ok) return dtoResult
    return ok({ ...dtoResult.value, added: added.value })
  },

  async clear(
    actorId: string,
    workspaceId: string,
    dto: ClearWhatsAppAutoOutreachDTO,
  ): Promise<Result<WhatsAppAutoOutreachDTO>> {
    const membership = await authorize(actorId, workspaceId, 'EDIT')
    if (!membership.ok) return membership

    const existing =
      await WhatsAppAutoOutreachRepository.findByWorkspace(workspaceId)
    if (!existing.ok) return existing
    if (!existing.value) return toDTO(null)
    if (existing.value.status === 'RUNNING') {
      return err(whatsappAutoOutreachRunning())
    }

    const cleared = await WhatsAppAutoOutreachRepository.clearRecipients(
      existing.value.id,
      dto.all ?? false,
    )
    if (!cleared.ok) return cleared

    auditMutation({
      entity: 'whatsapp_auto_outreach',
      action: 'delete',
      actorId,
      targetId: existing.value.id,
      meta: { workspaceId, cleared: cleared.value, all: dto.all ?? false },
    })
    return toDTO(existing.value)
  },

  /** Play: starts a new job chain (the previous one, if any, dies). */
  async play(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<WhatsAppAutoOutreachDTO>> {
    const membership = await authorize(actorId, workspaceId, 'EDIT')
    if (!membership.ok) return membership

    const existing =
      await WhatsAppAutoOutreachRepository.findByWorkspace(workspaceId)
    if (!existing.ok) return existing
    if (!existing.value) return err(whatsappAutoOutreachNotReady())
    if (existing.value.status === 'RUNNING') return toDTO(existing.value)

    const sendable = await loadSendable(
      workspaceId,
      existing.value.connectionId,
      existing.value.templateId,
    )
    if (!sendable.ok) return sendable

    const counts = await WhatsAppAutoOutreachRepository.countRecipients(
      existing.value.id,
    )
    if (!counts.ok) return counts
    if (counts.value.PENDING === 0) {
      return err(
        whatsappAutoOutreachNotReady(
          'Adicione contatos à fila antes de iniciar o disparo',
        ),
      )
    }

    const runToken = createId()
    const started = await WhatsAppAutoOutreachRepository.update(
      existing.value.id,
      { status: 'RUNNING', runToken, lastError: null, updatedById: actorId },
    )
    if (!started.ok) return started
    await enqueueNext(workspaceId, runToken, 0)

    auditMutation({
      entity: 'whatsapp_auto_outreach',
      action: 'start',
      actorId,
      targetId: existing.value.id,
      meta: { workspaceId, pending: counts.value.PENDING },
    })
    return toDTO(started.value)
  },

  async pause(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<WhatsAppAutoOutreachDTO>> {
    const membership = await authorize(actorId, workspaceId, 'EDIT')
    if (!membership.ok) return membership

    const existing =
      await WhatsAppAutoOutreachRepository.findByWorkspace(workspaceId)
    if (!existing.ok) return existing
    if (!existing.value || existing.value.status !== 'RUNNING') {
      return toDTO(existing.value)
    }

    const paused = await WhatsAppAutoOutreachRepository.update(
      existing.value.id,
      { status: 'PAUSED', runToken: null, updatedById: actorId },
    )
    if (!paused.ok) return paused

    auditMutation({
      entity: 'whatsapp_auto_outreach',
      action: 'pause',
      actorId,
      targetId: existing.value.id,
      meta: { workspaceId },
    })
    return toDTO(paused.value)
  },

  /**
   * One step of the run (worker): sends the template to the next queued
   * contact and chains the next step after the interval. A stale `runToken`
   * (paused, or played again) stops silently.
   */
  async sendNext(
    workspaceId: string,
    runToken: string,
  ): Promise<Result<WhatsAppAutoOutreachStepOutcome>> {
    const found =
      await WhatsAppAutoOutreachRepository.findByWorkspace(workspaceId)
    if (!found.ok) return found
    const outreach = found.value
    if (
      !outreach ||
      outreach.status !== 'RUNNING' ||
      outreach.runToken !== runToken
    ) {
      return ok({ status: 'stopped' })
    }

    const stop = async (
      status: 'PAUSED' | 'DONE',
      reason: string | null,
    ): Promise<Result<WhatsAppAutoOutreachStepOutcome>> => {
      const stopped = await WhatsAppAutoOutreachRepository.stopRun(
        outreach.id,
        runToken,
        { status, lastError: reason },
      )
      if (!stopped.ok) return stopped
      if (status === 'DONE') return ok({ status: 'done' })
      return ok({ status: 'paused', reason: reason ?? '' })
    }

    // Business hours lock automatic sends too: sleep until the opening.
    const hours = await WhatsAppBusinessHoursService.check(workspaceId)
    if (!hours.ok) return hours
    if (!hours.value.open) {
      const resumeAt = hours.value.nextOpeningAt
      if (!resumeAt) {
        return stop('PAUSED', 'O horário de atendimento não tem dias liberados')
      }
      await enqueueNext(
        workspaceId,
        runToken,
        Math.max(0, resumeAt.getTime() - Date.now()),
      )
      return ok({ status: 'waiting', resumeAt })
    }

    const sendable = await loadSendable(
      workspaceId,
      outreach.connectionId,
      outreach.templateId,
    )
    if (!sendable.ok) {
      if (sendable.error.code === 'DATABASE_ERROR') return sendable
      return stop('PAUSED', sendable.error.message)
    }
    const { connection, template } = sendable.value

    const next = await WhatsAppAutoOutreachRepository.findNextPending(
      outreach.id,
    )
    if (!next.ok) return next
    const recipient = next.value
    if (!recipient) return stop('DONE', null)

    const interval = outreach.intervalSeconds * 1000
    const skip = async (
      reason: string,
    ): Promise<Result<WhatsAppAutoOutreachStepOutcome>> => {
      const skipped = await WhatsAppAutoOutreachRepository.updateRecipient(
        recipient.id,
        { status: 'SKIPPED', errorMessage: reason },
      )
      if (!skipped.ok) return skipped
      await enqueueNext(
        workspaceId,
        runToken,
        WHATSAPP_AUTO_OUTREACH_SKIP_DELAY_MS,
      )
      return ok({
        status: 'skipped',
        nextDelayMs: WHATSAPP_AUTO_OUTREACH_SKIP_DELAY_MS,
      })
    }

    if (recipient.contact.broadcastOptedOutAt) {
      return skip('Contato descadastrado das mensagens automáticas')
    }

    const conversation = await conversationFor(recipient, connection)
    if (!conversation.ok) {
      if (PAUSING_ERRORS.has(conversation.error.code)) {
        return stop('PAUSED', conversation.error.message)
      }
      return conversation
    }
    if (!conversation.value) return skip('Contato já está em atendimento')

    const built = buildAutoOutreachTemplate(template, recipient.contact.name)
    const sent = await WhatsAppSend.template(connection, {
      to: recipient.contact.waId,
      templateName: template.name,
      language: template.language,
      components: applyTemplateSendExtras(template, built.components)
        .components,
    })

    if (!sent.ok) {
      if (PAUSING_ERRORS.has(sent.error.code)) {
        return stop('PAUSED', sent.error.message)
      }
      // Provider throttle: the same contact goes again after the interval.
      if (sent.error.code === 'RATE_LIMITED') {
        await enqueueNext(workspaceId, runToken, interval)
        return ok({ status: 'retry', nextDelayMs: interval })
      }
      const failed = await WhatsAppAutoOutreachRepository.updateRecipient(
        recipient.id,
        { status: 'FAILED', errorMessage: sent.error.message },
      )
      if (!failed.ok) return failed
      logger.warn('whatsapp.auto_outreach.send_failed', {
        component: 'WhatsAppAutoOutreachService',
        workspaceId,
        recipientId: recipient.id,
        reason: sent.error.code,
      })
      await enqueueNext(workspaceId, runToken, interval)
      return ok({ status: 'failed', nextDelayMs: interval })
    }

    // Already sent: bookkeeping failures are logged, never retried (a retry
    // would message the contact twice).
    const marked = await WhatsAppAutoOutreachRepository.updateRecipient(
      recipient.id,
      {
        status: 'SENT',
        providerMessageId: sent.value.providerMessageId,
        sentAt: new Date(),
      },
    )
    if (!marked.ok) {
      logger.error('whatsapp.auto_outreach.recipient_update_failed', {
        component: 'WhatsAppAutoOutreachService',
        recipientId: recipient.id,
        reason: marked.error.code,
      })
    }
    await WhatsAppAutoOutreachRepository.update(outreach.id, {
      lastSentAt: new Date(),
    })
    await recordOutboundTemplate({
      workspaceId,
      conversationId: conversation.value.id,
      providerMessageId: sent.value.providerMessageId,
      text: built.text || template.name,
    })

    await enqueueNext(workspaceId, runToken, interval)
    return ok({ status: 'sent', nextDelayMs: interval })
  },
}
