import type { WhatsAppContact } from '@prisma/client'
import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import { badRequest, whatsappTeamNotFound } from '@/src/errors'
import {
  WhatsappButtonActionsJob,
  type WhatsappButtonActionsJobPayload,
} from '@/src/lib/queue/jobs'
import { getWhatsappButtonActionsQueue } from '@/src/lib/queue/queues'
import { err, ok, type Result } from '@/src/lib/result'
import {
  parseButtonPayload,
  type WhatsAppButtonPayload,
} from '@/src/lib/whatsapp/button-payload'
import {
  BUTTON_WEBHOOK_EVENT,
  type ButtonWebhookBody,
  postButtonWebhook,
} from '@/src/lib/whatsapp/button-webhook'
import { parseStoredButtons } from '@/src/lib/whatsapp/buttons'
import { publishWhatsAppEvent } from '@/src/lib/whatsapp/realtime'
import { WhatsAppSend } from '@/src/lib/whatsapp/send'
import { templateButtons } from '@/src/lib/whatsapp/template-send'
import { toWhatsAppConversationDTO } from '@/src/mappers/whatsapp-conversation.mapper'
import { toWhatsAppMessageDTO } from '@/src/mappers/whatsapp-message.mapper'
import { UserRepository } from '@/src/repositories/user.repository'
import { WhatsAppButtonActionRepository } from '@/src/repositories/whatsapp-button-action.repository'
import { WhatsAppContactRepository } from '@/src/repositories/whatsapp-contact.repository'
import {
  WhatsAppConversationRepository,
  type WhatsAppConversationWithConnection,
} from '@/src/repositories/whatsapp-conversation.repository'
import { WhatsAppConversationEventRepository } from '@/src/repositories/whatsapp-conversation-event.repository'
import { WhatsAppMessageRepository } from '@/src/repositories/whatsapp-message.repository'
import { WhatsAppQuickReplyRepository } from '@/src/repositories/whatsapp-quick-reply.repository'
import { WhatsAppTemplateRepository } from '@/src/repositories/whatsapp-template.repository'
import type { WhatsAppButtonAction } from '@/src/schemas/whatsapp-button.schema'
import type { WhatsAppButtonDTO } from '@/types/whatsapp-button'
import { assertMember } from './authz'
import { CrmWorkflowService } from './crm-workflow.service'
import { WhatsAppAiReplyService } from './whatsapp-ai-reply.service'
import { emitWhatsAppConversationWaiting } from './whatsapp-conversation-waiting'
import {
  notifyWhatsAppUsers,
  WHATSAPP_NOTIFY_ADMIN_CAP,
  whatsAppConversationPath,
} from './whatsapp-notify'

type ReplyButton = Extract<WhatsAppButtonDTO, { type: 'REPLY' }>
type ActionJob =
  WhatsappButtonActionsJobPayload[typeof WhatsappButtonActionsJob.RunButtonActions]

export interface WhatsAppButtonActionResult {
  kind: WhatsAppButtonAction['kind']
  ok: boolean
  /** Error code / reason when it failed. */
  detail?: string
}

export type WhatsAppButtonActionsOutcome =
  | {
      status: 'skipped'
      reason: 'conversation_not_found' | 'button_not_found' | 'no_contact'
    }
  | { status: 'ran'; results: WhatsAppButtonActionResult[] }

interface ActionContext {
  job: ActionJob
  conversation: WhatsAppConversationWithConnection
  contact: WhatsAppContact
  button: ReplyButton
}

/** The REPLY button a payload points to, read fresh from its source. */
async function loadReplyButton(
  workspaceId: string,
  payload: Pick<WhatsAppButtonPayload, 'sourceType' | 'sourceId' | 'buttonId'>,
): Promise<Result<ReplyButton | null>> {
  let buttons: WhatsAppButtonDTO[] = []
  if (payload.sourceType === 'TEMPLATE') {
    const template = await WhatsAppTemplateRepository.findById(
      payload.sourceId,
      workspaceId,
    )
    if (!template.ok) return template
    if (template.value) buttons = templateButtons(template.value)
  } else {
    const quickReply = await WhatsAppQuickReplyRepository.findById(
      payload.sourceId,
      workspaceId,
    )
    if (!quickReply.ok) return quickReply
    if (quickReply.value) buttons = parseStoredButtons(quickReply.value.buttons)
  }
  const button = buttons.find(
    (b): b is ReplyButton => b.type === 'REPLY' && b.id === payload.buttonId,
  )
  return ok(button ?? null)
}

async function publishConversationSnapshot(
  workspaceId: string,
  conversationId: string,
): Promise<void> {
  const fresh = await WhatsAppConversationRepository.findById(
    conversationId,
    workspaceId,
  )
  if (!fresh.ok || !fresh.value) return
  await publishWhatsAppEvent(workspaceId, {
    type: 'conversation.updated',
    conversation: toWhatsAppConversationDTO(fresh.value),
  })
}

function contactLabel(contact: WhatsAppContact): string {
  return contact.name ?? contact.waId
}

function webhookBody(ctx: ActionContext): ButtonWebhookBody {
  return {
    event: BUTTON_WEBHOOK_EVENT,
    workspaceId: ctx.job.workspaceId,
    conversationId: ctx.job.conversationId,
    contact: { waId: ctx.contact.waId, name: ctx.contact.name },
    button: { id: ctx.button.id, label: ctx.button.label },
    source: { type: ctx.job.sourceType, id: ctx.job.sourceId },
    clickedAt: ctx.job.clickedAt,
  }
}

async function recordEvent(
  ctx: ActionContext,
  kind: 'ASSIGNED' | 'TEAM_CHANGED' | 'CLOSED',
  reason: string | null,
): Promise<Result<void>> {
  const event = await WhatsAppConversationEventRepository.create({
    workspaceId: ctx.job.workspaceId,
    conversationId: ctx.job.conversationId,
    kind,
    source: 'BUTTON_ACTION',
    actorUserId: null,
    reason,
  })
  return event.ok ? ok(undefined) : event
}

async function runReply(
  ctx: ActionContext,
  text: string,
): Promise<Result<void>> {
  const { workspaceId, conversationId } = ctx.job
  const sent = await WhatsAppSend.text(ctx.conversation.connection, {
    to: ctx.contact.waId,
    text,
  })
  if (!sent.ok) return sent
  const message = await WhatsAppMessageRepository.create({
    workspaceId,
    conversationId,
    direction: 'OUT',
    type: 'TEXT',
    text,
    providerMessageId: sent.value.providerMessageId,
    status: 'SENT',
  })
  if (!message.ok) return message
  await WhatsAppConversationRepository.update(conversationId, {
    lastMessageAt: new Date(),
  })
  await publishWhatsAppEvent(workspaceId, {
    type: 'message.created',
    conversationId,
    message: toWhatsAppMessageDTO(message.value),
  })
  return ok(undefined)
}

async function runAssignUser(
  ctx: ActionContext,
  userId: string,
): Promise<Result<void>> {
  const { workspaceId, conversationId } = ctx.job
  const member = await assertMember(userId, workspaceId)
  if (!member.ok) {
    return err(badRequest('O atendente do botão não pertence ao workspace'))
  }
  const updated = await WhatsAppConversationRepository.update(conversationId, {
    assignedUserId: userId,
    status: 'IN_PROGRESS',
  })
  if (!updated.ok) return updated

  const user = await UserRepository.findById(userId)
  const event = await recordEvent(
    ctx,
    'ASSIGNED',
    user.ok ? user.value.name : null,
  )
  if (!event.ok) return event

  auditMutation({
    entity: 'whatsapp_conversation',
    action: 'assign',
    actorId: null,
    targetId: conversationId,
    meta: { assignedUserId: userId, source: 'BUTTON_ACTION', actor: 'system' },
  })
  if (ctx.conversation.assignedUserId !== userId) {
    await notifyWhatsAppUsers({
      workspaceId,
      kind: 'WHATSAPP_CONVERSATION_ASSIGNED',
      userIds: [userId],
      title: 'Conversa atribuída a você',
      body: `${contactLabel(ctx.contact)} clicou em "${ctx.button.label}".`,
      path: whatsAppConversationPath(conversationId),
      meta: { conversationId, source: 'BUTTON_ACTION' },
    })
  }
  return ok(undefined)
}

async function runAssignTeam(
  ctx: ActionContext,
  teamId: string,
): Promise<Result<void>> {
  const { workspaceId, conversationId } = ctx.job
  const team = await WhatsAppButtonActionRepository.findTeam(
    workspaceId,
    teamId,
  )
  if (!team.ok) return team
  if (!team.value) return err(whatsappTeamNotFound())

  // Into the team's queue: no assignee, waiting to be picked up.
  const updated = await WhatsAppConversationRepository.update(conversationId, {
    teamId,
    assignedUserId: null,
    status: 'NEW',
  })
  if (!updated.ok) return updated
  // An unassigned conversation was already waiting (the contact's message
  // put it there); only one taken from an agent enters the queue now.
  if (
    ctx.conversation.assignedUserId &&
    ctx.conversation.connection.module === 'COMMUNICATION'
  ) {
    emitWhatsAppConversationWaiting({
      conversation: updated.value,
      contact: ctx.contact,
      reason: 'returned_to_queue',
      actorId: null,
    })
  }
  const event = await recordEvent(ctx, 'TEAM_CHANGED', team.value.name)
  if (!event.ok) return event

  auditMutation({
    entity: 'whatsapp_conversation',
    action: 'assign',
    actorId: null,
    targetId: conversationId,
    meta: { teamId, source: 'BUTTON_ACTION', actor: 'system' },
  })
  await notifyWhatsAppUsers({
    workspaceId,
    kind: 'WHATSAPP_CONVERSATION_ASSIGNED',
    userIds: team.value.memberIds.slice(0, WHATSAPP_NOTIFY_ADMIN_CAP),
    title: `Nova conversa na fila da equipe ${team.value.name}`,
    body: `${contactLabel(ctx.contact)} clicou em "${ctx.button.label}".`,
    path: whatsAppConversationPath(conversationId),
    meta: { conversationId, teamId, source: 'BUTTON_ACTION' },
  })
  return ok(undefined)
}

async function runSetStatus(
  ctx: ActionContext,
  status: 'IN_PROGRESS' | 'CLOSED',
  reason: string | undefined,
): Promise<Result<void>> {
  const { conversationId } = ctx.job
  if (status === 'IN_PROGRESS') {
    const updated = await WhatsAppConversationRepository.update(
      conversationId,
      { status },
    )
    return updated.ok ? ok(undefined) : updated
  }
  const updated = await WhatsAppConversationRepository.update(conversationId, {
    status: 'CLOSED',
    closedAt: new Date(),
    closeReason: reason ?? null,
  })
  if (!updated.ok) return updated
  const event = await recordEvent(ctx, 'CLOSED', reason ?? null)
  if (!event.ok) return event
  auditMutation({
    entity: 'whatsapp_conversation',
    action: 'close',
    actorId: null,
    targetId: conversationId,
    meta: {
      workspaceId: ctx.job.workspaceId,
      source: 'BUTTON_ACTION',
      hasReason: Boolean(reason),
      actor: 'system',
    },
  })
  return ok(undefined)
}

async function runAiInstruction(
  ctx: ActionContext,
  instruction: string,
): Promise<Result<void>> {
  const result = await WhatsAppAiReplyService.generateReply({
    conversationId: ctx.job.conversationId,
    messageId: ctx.job.messageId,
    instruction,
  })
  if (!result.ok) return result
  if (result.value.status !== 'sent') {
    return err(badRequest(`ai_${result.value.reason}`))
  }
  return ok(undefined)
}

async function runAction(
  ctx: ActionContext,
  action: WhatsAppButtonAction,
): Promise<Result<void>> {
  switch (action.kind) {
    case 'REPLY':
      return runReply(ctx, action.text)
    case 'ASSIGN_USER':
      return runAssignUser(ctx, action.userId)
    case 'ASSIGN_TEAM':
      return runAssignTeam(ctx, action.teamId)
    case 'SET_STATUS':
      return runSetStatus(ctx, action.status, action.reason)
    case 'CRM_WORKFLOW': {
      const run = await CrmWorkflowService.triggerFromSystem(
        ctx.job.workspaceId,
        action.workflowId,
        webhookBody(ctx),
      )
      return run.ok ? ok(undefined) : run
    }
    case 'HTTP_WEBHOOK':
      await postButtonWebhook({
        url: action.url,
        secret: action.secret,
        body: webhookBody(ctx),
      })
      return ok(undefined)
    case 'AI_INSTRUCTION':
      return runAiInstruction(ctx, action.instruction)
  }
}

export const WhatsAppButtonActionService = {
  /**
   * Inbound click (Meta `button`/`interactive`, Z-API buttons response),
   * already stored as an IN message. A payload of ours that points to a
   * known reply button gets a `BUTTON_CLICKED` event and, when the button
   * has actions, a job that runs them. Foreign payloads: nothing to do.
   */
  async handleClick(input: {
    workspaceId: string
    conversationId: string
    messageId: string
    payload: string | null | undefined
  }): Promise<Result<{ matched: boolean; actions: number }>> {
    const parsed = parseButtonPayload(input.payload)
    if (!parsed) return ok({ matched: false, actions: 0 })

    const button = await loadReplyButton(input.workspaceId, parsed)
    if (!button.ok) return button
    if (!button.value) return ok({ matched: false, actions: 0 })

    const event = await WhatsAppConversationEventRepository.create({
      workspaceId: input.workspaceId,
      conversationId: input.conversationId,
      kind: 'BUTTON_CLICKED',
      source: 'CONTACT',
      actorUserId: null,
      reason: button.value.label,
    })
    if (!event.ok) return event

    const actions = button.value.actions.length
    if (actions > 0) {
      await getWhatsappButtonActionsQueue().add(
        WhatsappButtonActionsJob.RunButtonActions,
        {
          workspaceId: input.workspaceId,
          conversationId: input.conversationId,
          messageId: input.messageId,
          sourceType: parsed.sourceType,
          sourceId: parsed.sourceId,
          buttonId: parsed.buttonId,
          clickedAt: new Date().toISOString(),
        },
        // One run per click, even if the webhook is delivered twice.
        { jobId: `button-${input.messageId}` },
      )
    }

    logger.info('whatsapp.button.clicked', {
      workspaceId: input.workspaceId,
      conversationId: input.conversationId,
      sourceType: parsed.sourceType,
      sourceId: parsed.sourceId,
      buttonId: parsed.buttonId,
      actions,
    })
    return ok({ matched: true, actions })
  },

  /**
   * Worker side: runs the button's actions in order (re-read from the
   * template/quick reply, so the current configuration wins). A failing
   * action is logged and the next one still runs; only a database failure
   * loading the context returns an error (the job retries).
   */
  async runActions(
    job: ActionJob,
  ): Promise<Result<WhatsAppButtonActionsOutcome>> {
    const conversation =
      await WhatsAppConversationRepository.findByIdWithConnection(
        job.conversationId,
      )
    if (!conversation.ok) return conversation
    if (
      !conversation.value ||
      conversation.value.workspaceId !== job.workspaceId
    ) {
      return ok({ status: 'skipped', reason: 'conversation_not_found' })
    }

    const button = await loadReplyButton(job.workspaceId, job)
    if (!button.ok) return button
    if (!button.value) {
      return ok({ status: 'skipped', reason: 'button_not_found' })
    }

    const contact = await WhatsAppContactRepository.findById(
      conversation.value.contactId,
      job.workspaceId,
    )
    if (!contact.ok) return contact
    if (!contact.value) return ok({ status: 'skipped', reason: 'no_contact' })

    const ctx: ActionContext = {
      job,
      conversation: conversation.value,
      contact: contact.value,
      button: button.value,
    }
    const results: WhatsAppButtonActionResult[] = []
    for (const action of button.value.actions) {
      let outcome: Result<void>
      try {
        outcome = await runAction(ctx, action)
      } catch (error) {
        outcome = err(
          badRequest(error instanceof Error ? error.message : String(error)),
        )
      }
      if (outcome.ok) {
        results.push({ kind: action.kind, ok: true })
        continue
      }
      results.push({
        kind: action.kind,
        ok: false,
        detail: outcome.error.message,
      })
      logger.warn('whatsapp.button.action_failed', {
        workspaceId: job.workspaceId,
        conversationId: job.conversationId,
        buttonId: job.buttonId,
        kind: action.kind,
        code: outcome.error.code,
        reason: outcome.error.message,
      })
    }

    await publishConversationSnapshot(job.workspaceId, job.conversationId)
    return ok({ status: 'ran', results })
  },
}
