import type {
  Prisma,
  WhatsAppChatbotSession,
  WhatsAppContact,
  WhatsAppMessage,
} from '@prisma/client'
import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import { WhatsappAiReplyJob, WhatsappChatbotJob } from '@/src/lib/queue/jobs'
import {
  getWhatsappAiReplyQueue,
  getWhatsappChatbotQueue,
} from '@/src/lib/queue/queues'
import { err, ok, type Result } from '@/src/lib/result'
import {
  type ChatbotContext,
  type ChatbotOutput,
  type ChatbotRunResult,
  type ChatbotState,
  initialChatbotState,
  parseChatbotState,
  resumeFlow,
  startFlow,
} from '@/src/lib/whatsapp/chatbot/engine'
import { shouldStartBot } from '@/src/lib/whatsapp/chatbot/trigger'
import { callChatbotWebhook } from '@/src/lib/whatsapp/chatbot/webhook-call'
import { queueEntry } from '@/src/lib/whatsapp/queue-entry'
import { publishWhatsAppEvent } from '@/src/lib/whatsapp/realtime'
import { WhatsAppSend } from '@/src/lib/whatsapp/send'
import { parseStoredFlow } from '@/src/mappers/whatsapp-chatbot.mapper'
import { toWhatsAppConversationDTO } from '@/src/mappers/whatsapp-conversation.mapper'
import { toWhatsAppMessageDTO } from '@/src/mappers/whatsapp-message.mapper'
import { dbError } from '@/src/repositories/db-error'
import { WhatsAppAiConfigRepository } from '@/src/repositories/whatsapp-ai-config.repository'
import { WhatsAppButtonActionRepository } from '@/src/repositories/whatsapp-button-action.repository'
import { WhatsAppChatbotRepository } from '@/src/repositories/whatsapp-chatbot.repository'
import {
  type ChatbotNodeCount,
  WhatsAppChatbotNodeStatRepository,
} from '@/src/repositories/whatsapp-chatbot-node-stat.repository'
import { WhatsAppChatbotSessionRepository } from '@/src/repositories/whatsapp-chatbot-session.repository'
import { WhatsAppContactRepository } from '@/src/repositories/whatsapp-contact.repository'
import {
  WhatsAppConversationRepository,
  type WhatsAppConversationWithConnection,
} from '@/src/repositories/whatsapp-conversation.repository'
import { WhatsAppConversationEventRepository } from '@/src/repositories/whatsapp-conversation-event.repository'
import { WhatsAppMessageRepository } from '@/src/repositories/whatsapp-message.repository'
import { assertMember } from './authz'
import { WhatsAppBusinessHoursService } from './whatsapp-business-hours.service'
import { emitWhatsAppConversationWaiting } from './whatsapp-conversation-waiting'
import { WhatsAppDistributionService } from './whatsapp-distribution.service'
import {
  notifyWhatsAppUsers,
  WHATSAPP_NOTIFY_ADMIN_CAP,
  whatsAppConversationPath,
} from './whatsapp-notify'
import { WhatsAppSlaService } from './whatsapp-sla.service'

/**
 * Runtime of the visual chatbot (Z2). Two entry points:
 *
 * - `claimInbound`, called by the webhook for every inbound message of the
 *   Comunicação module: decides whether a bot owns the message (so the AI
 *   stays quiet), creating the session when a bot starts, and queues a step.
 * - `runStep`, called by the `whatsapp-chatbot` worker: advances the flow
 *   with the engine and performs the I/O (sends, handoffs, closing).
 */

export type ChatbotClaimResult = { engaged: boolean }

export type ChatbotStepOutcome =
  | { status: 'skipped'; reason: string }
  | {
      status: 'ran'
      sessionStatus: WhatsAppChatbotSession['status']
      sent: number
    }

type ConversationWithConnection = WhatsAppConversationWithConnection

async function publishConversation(
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

async function persistOutbound(input: {
  conversation: ConversationWithConnection
  text: string
  providerMessageId: string
  buttons?: Array<{ id: string; label: string }>
}): Promise<Result<WhatsAppMessage>> {
  const { conversation } = input
  const message = await WhatsAppMessageRepository.create({
    workspaceId: conversation.workspaceId,
    conversationId: conversation.id,
    direction: 'OUT',
    type: 'TEXT',
    text: input.text,
    providerMessageId: input.providerMessageId,
    status: 'SENT',
    ...(input.buttons
      ? {
          buttons: input.buttons.map((button) => ({
            id: button.id,
            type: 'REPLY',
            label: button.label,
          })),
        }
      : {}),
  })
  if (!message.ok) return message
  await WhatsAppConversationRepository.update(conversation.id, {
    lastMessageAt: new Date(),
  })
  await publishWhatsAppEvent(conversation.workspaceId, {
    type: 'message.created',
    conversationId: conversation.id,
    message: toWhatsAppMessageDTO(message.value),
  })
  return message
}

async function sendText(
  conversation: ConversationWithConnection,
  contact: WhatsAppContact,
  text: string,
): Promise<Result<void>> {
  const sent = await WhatsAppSend.text(
    conversation.connection,
    { to: contact.waId, text },
    { cost: { source: 'OTHER', conversationId: conversation.id } },
  )
  if (!sent.ok) return sent
  const saved = await persistOutbound({
    conversation,
    text,
    providerMessageId: sent.value.providerMessageId,
  })
  return saved.ok ? ok(undefined) : saved
}

/**
 * Reply buttons when the menu fits them; on Meta an interactive list (up to
 * 10 rows) when it does not; numbered text otherwise, which is also the
 * fallback whenever the provider refuses the richer message.
 */
async function sendMenu(
  conversation: ConversationWithConnection,
  contact: WhatsAppContact,
  output: Extract<ChatbotOutput, { kind: 'menu' }>,
): Promise<Result<void>> {
  if (output.buttons) {
    const sent = await WhatsAppSend.buttons(
      conversation.connection,
      {
        to: contact.waId,
        text: output.text,
        buttons: output.buttons.map((button) => ({
          type: 'REPLY' as const,
          id: button.id,
          label: button.label,
        })),
      },
      { cost: { source: 'OTHER', conversationId: conversation.id } },
    )
    if (sent.ok) {
      const saved = await persistOutbound({
        conversation,
        text: output.text,
        providerMessageId: sent.value.providerMessageId,
        buttons: output.buttons,
      })
      return saved.ok ? ok(undefined) : saved
    }
    // The provider refused the buttons (e.g. Z-API without the feature):
    // the numbered list reaches the contact anyway.
    logger.warn('whatsapp.chatbot.buttons_fallback', {
      conversationId: conversation.id,
      reason: sent.error.code,
    })
  }
  if (output.list && conversation.connection.provider === 'META') {
    const sent = await WhatsAppSend.list(
      conversation.connection,
      {
        to: contact.waId,
        text: output.text,
        buttonLabel: output.list.buttonLabel,
        rows: output.list.rows.map((row) => ({
          id: row.id,
          title: row.label,
        })),
      },
      { cost: { source: 'OTHER', conversationId: conversation.id } },
    )
    if (sent.ok) {
      const saved = await persistOutbound({
        conversation,
        text: output.text,
        providerMessageId: sent.value.providerMessageId,
        buttons: output.list.rows,
      })
      return saved.ok ? ok(undefined) : saved
    }
    logger.warn('whatsapp.chatbot.list_fallback', {
      conversationId: conversation.id,
      reason: sent.error.code,
    })
  }
  return sendText(conversation, contact, output.numbered)
}

async function dispatchOutputs(
  conversation: ConversationWithConnection,
  contact: WhatsAppContact,
  outputs: ChatbotOutput[],
): Promise<Result<number>> {
  let sent = 0
  for (const output of outputs) {
    const result =
      output.kind === 'text'
        ? await sendText(conversation, contact, output.text)
        : await sendMenu(conversation, contact, output)
    if (!result.ok) return result
    sent += 1
  }
  return ok(sent)
}

async function recordHandoffEvent(
  workspaceId: string,
  conversationId: string,
  reason: string,
): Promise<void> {
  const event = await WhatsAppConversationEventRepository.create({
    workspaceId,
    conversationId,
    kind: 'CHATBOT_HANDOFF',
    source: 'CHATBOT',
    actorUserId: null,
    reason,
  })
  if (!event.ok) {
    logger.warn('whatsapp.chatbot.event_failed', {
      conversationId,
      reason: event.error.code,
    })
  }
}

/**
 * Hands the conversation to a person: a specific agent, a team queue or the
 * general queue. The AI is switched off (a person owns the conversation now).
 */
async function handoffToHuman(
  conversation: ConversationWithConnection,
  contact: WhatsAppContact,
  target: { teamId?: string; userId?: string },
): Promise<Result<void>> {
  const { workspaceId } = conversation
  const label = contact.name ?? contact.waId

  if (target.userId) {
    const member = await assertMember(target.userId, workspaceId)
    if (member.ok) {
      const updated = await WhatsAppConversationRepository.update(
        conversation.id,
        {
          assignedUserId: target.userId,
          status: 'IN_PROGRESS',
          aiActive: false,
          aiHandoff: true,
        },
      )
      if (!updated.ok) return updated
      await recordHandoffEvent(workspaceId, conversation.id, 'Atendente')
      await notifyWhatsAppUsers({
        workspaceId,
        kind: 'WHATSAPP_CONVERSATION_ASSIGNED',
        userIds: [target.userId],
        title: 'Conversa atribuída a você',
        body: `${label} foi encaminhado pelo chatbot.`,
        path: whatsAppConversationPath(conversation.id),
        meta: { conversationId: conversation.id, source: 'CHATBOT' },
      })
      return ok(undefined)
    }
    // The agent left the workspace: fall back to the team / general queue.
    logger.warn('whatsapp.chatbot.handoff_user_missing', {
      conversationId: conversation.id,
      userId: target.userId,
    })
  }

  let teamName: string | null = null
  let memberIds: string[] = []
  if (target.teamId) {
    const team = await WhatsAppButtonActionRepository.findTeam(
      workspaceId,
      target.teamId,
    )
    if (!team.ok) return team
    if (team.value) {
      teamName = team.value.name
      memberIds = team.value.memberIds
    } else {
      logger.warn('whatsapp.chatbot.handoff_team_missing', {
        conversationId: conversation.id,
        teamId: target.teamId,
      })
    }
  }

  const updated = await WhatsAppConversationRepository.update(conversation.id, {
    ...(teamName ? { teamId: target.teamId } : {}),
    assignedUserId: null,
    status: 'NEW',
    aiActive: false,
    aiHandoff: true,
    ...queueEntry(),
  })
  if (!updated.ok) return updated
  await recordHandoffEvent(
    workspaceId,
    conversation.id,
    teamName ? `Equipe ${teamName}` : 'Fila de atendimento',
  )
  const distribution = await WhatsAppDistributionService.distributeConversation(
    workspaceId,
    conversation.id,
  )
  const distributed = distribution.ok && distribution.value.assigned
  // While the bot talked the conversation was not "waiting" (no alert fired
  // on open); now that it lands in the queue unassigned, it is.
  if (!distributed) {
    emitWhatsAppConversationWaiting({
      conversation: updated.value,
      contact,
      reason: 'returned_to_queue',
      actorId: null,
    })
  }
  if (!distributed && memberIds.length > 0) {
    await notifyWhatsAppUsers({
      workspaceId,
      kind: 'WHATSAPP_CONVERSATION_ASSIGNED',
      userIds: memberIds.slice(0, WHATSAPP_NOTIFY_ADMIN_CAP),
      title: `Nova conversa na fila da equipe ${teamName}`,
      body: `${label} foi encaminhado pelo chatbot.`,
      path: whatsAppConversationPath(conversation.id),
      meta: {
        conversationId: conversation.id,
        teamId: target.teamId,
        source: 'CHATBOT',
      },
    })
  }
  return ok(undefined)
}

/** Switches the AI auto-reply on for the conversation, or `false` if off. */
async function handoffToAi(
  conversation: ConversationWithConnection,
  messageId: string,
  instruction: string | undefined,
): Promise<Result<boolean>> {
  const config = await WhatsAppAiConfigRepository.findByWorkspace(
    conversation.workspaceId,
  )
  if (!config.ok) return config
  if (!config.value?.active) return ok(false)

  const updated = await WhatsAppConversationRepository.update(conversation.id, {
    aiActive: true,
    aiHandoff: false,
  })
  if (!updated.ok) return updated
  await recordHandoffEvent(conversation.workspaceId, conversation.id, 'IA')
  await getWhatsappAiReplyQueue().add(WhatsappAiReplyJob.GenerateAiReply, {
    conversationId: conversation.id,
    messageId,
    ...(instruction ? { instruction } : {}),
  })
  return ok(true)
}

async function closeConversation(
  conversation: ConversationWithConnection,
): Promise<Result<void>> {
  const updated = await WhatsAppConversationRepository.update(conversation.id, {
    status: 'CLOSED',
    closedAt: new Date(),
    closeReason: 'Encerrada pelo chatbot',
  })
  if (!updated.ok) return updated
  const event = await WhatsAppConversationEventRepository.create({
    workspaceId: conversation.workspaceId,
    conversationId: conversation.id,
    kind: 'CLOSED',
    source: 'CHATBOT',
    actorUserId: null,
    reason: 'Encerrada pelo chatbot',
  })
  if (!event.ok) return event
  await WhatsAppSlaService.onClosed({
    id: conversation.id,
    assignedUserId: null,
  })
  return ok(undefined)
}

/** Folds a run's visited blocks into per-block counts. */
export function countNodeVisits(
  run: Pick<ChatbotRunResult, 'entered' | 'exited'>,
): ChatbotNodeCount[] {
  const counts = new Map<string, ChatbotNodeCount>()
  const slot = (nodeId: string) => {
    const found = counts.get(nodeId)
    if (found) return found
    const created = { nodeId, entries: 0, exits: 0 }
    counts.set(nodeId, created)
    return created
  }
  for (const nodeId of run.entered) slot(nodeId).entries += 1
  for (const nodeId of run.exited) slot(nodeId).exits += 1
  return [...counts.values()]
}

/** UTC calendar day of an instant, as the `@db.Date` column stores it. */
export function metricsDay(at: Date): Date {
  return new Date(
    Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()),
  )
}

/** Per-block metrics are a nicety: a failure never touches the conversation. */
async function recordNodeStats(
  workspaceId: string,
  chatbotId: string,
  run: Pick<ChatbotRunResult, 'entered' | 'exited'>,
): Promise<void> {
  try {
    const saved = await WhatsAppChatbotNodeStatRepository.increment(
      { workspaceId, chatbotId, day: metricsDay(new Date()) },
      countNodeVisits(run),
    )
    if (!saved.ok) {
      logger.warn('whatsapp.chatbot.node_stats_failed', {
        chatbotId,
        reason: saved.error.code,
      })
    }
  } catch (error) {
    logger.warn('whatsapp.chatbot.node_stats_failed', {
      chatbotId,
      reason: error instanceof Error ? error.message : String(error),
    })
  }
}

function chatbotContext(contact: WhatsAppContact): ChatbotContext {
  return {
    contact: { name: contact.name, phone: contact.waId },
    callWebhook: callChatbotWebhook,
  }
}

function toJson(state: ChatbotState): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(state))
}

export const WhatsAppChatbotRuntimeService = {
  /**
   * Called for each inbound message of a Comunicação conversation. When a
   * bot owns it, a step is queued and `engaged` is true so the caller skips
   * the AI auto-reply.
   */
  async claimInbound(input: {
    workspaceId: string
    connection: { id: string; module: string }
    conversation: {
      id: string
      assignedUserId: string | null
      aiHandoff: boolean
    }
    messageId: string
    text: string
    /** The message opened the conversation (new or reopened). */
    opening: boolean
    now?: Date
  }): Promise<Result<ChatbotClaimResult>> {
    const notEngaged = ok<ChatbotClaimResult>({ engaged: false })
    if (input.connection.module !== 'COMMUNICATION') return notEngaged
    const now = input.now ?? new Date()
    const { workspaceId, conversation } = input

    const running =
      await WhatsAppChatbotSessionRepository.findRunningByConversation(
        conversation.id,
      )
    if (!running.ok) return running

    // A person took the conversation over: the flow stops for good.
    if (conversation.assignedUserId) {
      if (running.value) {
        await WhatsAppChatbotSessionRepository.finish(
          running.value.id,
          'CANCELLED',
          'human_took_over',
        )
      }
      return notEngaged
    }

    if (running.value) {
      const bot = await WhatsAppChatbotRepository.findById(
        running.value.chatbotId,
        workspaceId,
      )
      if (!bot.ok) return bot
      const ttlMs = (bot.value?.sessionTtlMinutes ?? 720) * 60_000
      const idle = now.getTime() - running.value.lastActivityAt.getTime()
      if (bot.value && idle <= ttlMs) {
        return queueStep(running.value.id, input.messageId, conversation.id)
      }
      await WhatsAppChatbotSessionRepository.finish(
        running.value.id,
        'EXPIRED',
        'timeout',
      )
    }

    // After a handoff nobody restarts the flow until the conversation is
    // reopened (which resets `aiHandoff`).
    if (conversation.aiHandoff) return notEngaged

    const candidates = await WhatsAppChatbotRepository.listRunnable(
      workspaceId,
      input.connection.id,
    )
    if (!candidates.ok) return candidates
    if (candidates.value.length === 0) return notEngaged

    let outsideBusinessHours = false
    if (
      candidates.value.some(
        (bot) => bot.triggerKind === 'OUTSIDE_BUSINESS_HOURS',
      )
    ) {
      const hours = await WhatsAppBusinessHoursService.check(workspaceId, now)
      outsideBusinessHours =
        hours.ok && hours.value.hours.enabled && !hours.value.open
    }

    const bot = candidates.value.find((candidate) =>
      shouldStartBot(candidate, {
        opening: input.opening,
        text: input.text,
        outsideBusinessHours,
      }),
    )
    if (!bot) return notEngaged

    const created = await WhatsAppChatbotSessionRepository.createRunning({
      workspaceId,
      chatbotId: bot.id,
      conversationId: conversation.id,
      botVersion: bot.publishedVersion,
      state: toJson(initialChatbotState()),
      definition: bot.published as Prisma.InputJsonValue,
    })
    if (!created.ok) return created
    // Lost the race against a parallel message: the winner owns the session.
    let sessionId = created.value?.id
    if (!sessionId) {
      const winner =
        await WhatsAppChatbotSessionRepository.findRunningByConversation(
          conversation.id,
        )
      if (!winner.ok) return winner
      sessionId = winner.value?.id
    }
    if (!sessionId) return notEngaged

    // While the bot talks, the AI must not look like it is answering.
    await WhatsAppConversationRepository.update(conversation.id, {
      aiActive: false,
    })
    return queueStep(sessionId, input.messageId, conversation.id)
  },

  /** One worker step: feeds the inbound message to the session's flow. */
  async runStep(input: {
    sessionId: string
    messageId: string
  }): Promise<Result<ChatbotStepOutcome>> {
    const sessionResult = await WhatsAppChatbotSessionRepository.findById(
      input.sessionId,
    )
    if (!sessionResult.ok) return sessionResult
    const session = sessionResult.value
    if (session?.status !== 'RUNNING') {
      return ok({ status: 'skipped', reason: 'session_not_running' })
    }

    const conversationResult =
      await WhatsAppConversationRepository.findByIdWithConnection(
        session.conversationId,
      )
    if (!conversationResult.ok) return conversationResult
    const conversation = conversationResult.value
    if (!conversation || conversation.deletedAt) {
      await WhatsAppChatbotSessionRepository.finish(
        session.id,
        'CANCELLED',
        'conversation_gone',
      )
      return ok({ status: 'skipped', reason: 'conversation_gone' })
    }
    if (conversation.assignedUserId || conversation.status === 'CLOSED') {
      await WhatsAppChatbotSessionRepository.finish(
        session.id,
        'CANCELLED',
        conversation.assignedUserId ? 'human_took_over' : 'conversation_closed',
      )
      return ok({ status: 'skipped', reason: 'conversation_taken' })
    }

    const contactResult = await WhatsAppContactRepository.findById(
      conversation.contactId,
      conversation.workspaceId,
    )
    if (!contactResult.ok) return contactResult
    const contact = contactResult.value
    const messageResult = await WhatsAppMessageRepository.findById(
      input.messageId,
    )
    if (!messageResult.ok) return messageResult
    const message = messageResult.value
    if (!contact || !message) {
      await WhatsAppChatbotSessionRepository.finish(
        session.id,
        'FAILED',
        'missing_data',
      )
      return ok({ status: 'skipped', reason: 'missing_data' })
    }

    const flow = parseStoredFlow(session.definition)
    const state = parseChatbotState(session.state)
    const ctx = chatbotContext(contact)
    const text = message.text ?? ''
    const run: ChatbotRunResult = state.started
      ? await resumeFlow(
          flow,
          state,
          { text, buttonPayload: message.buttonPayload ?? undefined },
          ctx,
        )
      : await startFlow(flow, ctx, { text })

    await recordNodeStats(conversation.workspaceId, session.chatbotId, run)

    const dispatched = await dispatchOutputs(conversation, contact, run.outputs)
    if (!dispatched.ok) {
      // Nothing more can reach the contact: a person has to look.
      logger.error('whatsapp.chatbot.send_failed', {
        sessionId: session.id,
        conversationId: conversation.id,
        reason: dispatched.error.code,
      })
      await WhatsAppChatbotSessionRepository.finish(
        session.id,
        'FAILED',
        'send_failed',
        toJson(run.state),
      )
      await handoffToHuman(conversation, contact, {})
      await publishConversation(conversation.workspaceId, conversation.id)
      return ok({ status: 'ran', sessionStatus: 'FAILED', sent: 0 })
    }

    let finalStatus: WhatsAppChatbotSession['status']
    let endReason = run.endReason ?? 'finished'
    switch (run.status) {
      case 'WAITING': {
        await WhatsAppChatbotSessionRepository.update(session.id, {
          state: toJson(run.state),
          lastActivityAt: new Date(),
        })
        return ok({
          status: 'ran',
          sessionStatus: 'RUNNING',
          sent: dispatched.value,
        })
      }
      case 'HANDED_OFF_AI': {
        const handed = await handoffToAi(
          conversation,
          input.messageId,
          run.handoff?.instruction,
        )
        if (handed.ok && handed.value) {
          finalStatus = 'HANDED_OFF_AI'
        } else {
          // AI switched off (or the switch failed): a person takes it.
          await handoffToHuman(conversation, contact, {})
          finalStatus = 'HANDED_OFF_HUMAN'
          endReason = 'ai_inactive'
        }
        break
      }
      case 'HANDED_OFF_HUMAN':
        await handoffToHuman(conversation, contact, {
          teamId: run.handoff?.teamId,
          userId: run.handoff?.userId,
        })
        finalStatus = 'HANDED_OFF_HUMAN'
        break
      case 'FAILED':
        await handoffToHuman(conversation, contact, {})
        finalStatus = 'FAILED'
        break
      case 'COMPLETED':
        if (run.closeConversation) await closeConversation(conversation)
        finalStatus = 'COMPLETED'
        break
    }

    await WhatsAppChatbotSessionRepository.finish(
      session.id,
      finalStatus,
      endReason,
      toJson(run.state),
    )
    auditMutation({
      entity: 'whatsapp_chatbot_session',
      action: 'finish',
      actorId: null,
      targetId: session.id,
      meta: {
        workspaceId: conversation.workspaceId,
        chatbotId: session.chatbotId,
        status: finalStatus,
        endReason,
        actor: 'system',
      },
    })
    await publishConversation(conversation.workspaceId, conversation.id)
    return ok({
      status: 'ran',
      sessionStatus: finalStatus,
      sent: dispatched.value,
    })
  },
}

async function queueStep(
  sessionId: string,
  messageId: string,
  conversationId: string,
): Promise<Result<ChatbotClaimResult>> {
  try {
    await getWhatsappChatbotQueue().add(
      WhatsappChatbotJob.RunStep,
      { sessionId, messageId },
      // One step per inbound message, even if the webhook repeats.
      { jobId: `chatbot-step-${messageId}` },
    )
    await WhatsAppChatbotSessionRepository.update(sessionId, {
      lastActivityAt: new Date(),
    })
    return ok({ engaged: true })
  } catch (error) {
    logger.error('whatsapp.chatbot.enqueue_failed', {
      sessionId,
      conversationId,
      message: error instanceof Error ? error.message : String(error),
    })
    return err(dbError('Failed to queue the chatbot step', error))
  }
}
