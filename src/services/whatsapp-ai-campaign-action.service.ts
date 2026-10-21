import type {
  Prisma,
  WhatsAppAiCampaign,
  WhatsAppContact,
  WhatsAppConversation,
} from '@prisma/client'
import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import {
  WhatsappAiReplyJob,
  WhatsappBroadcastJob,
  type WhatsappBroadcastJobPayload,
} from '@/src/lib/queue/jobs'
import {
  getWhatsappAiReplyQueue,
  getWhatsappBroadcastQueue,
} from '@/src/lib/queue/queues'
import { ok, type Result } from '@/src/lib/result'
import type { AiCampaignActionRequest } from '@/src/lib/whatsapp/ai-campaign-actions'
import {
  AI_CAMPAIGN_WEBHOOK_EVENT,
  postAiCampaignWebhook,
} from '@/src/lib/whatsapp/ai-campaign-webhook'
import { publishWhatsAppEvent } from '@/src/lib/whatsapp/realtime'
import { toWhatsAppConversationDTO } from '@/src/mappers/whatsapp-conversation.mapper'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { UserRepository } from '@/src/repositories/user.repository'
import { WhatsAppAiCampaignRepository } from '@/src/repositories/whatsapp-ai-campaign.repository'
import { WhatsAppCloseStatusRepository } from '@/src/repositories/whatsapp-close-status.repository'
import { WhatsAppContactRepository } from '@/src/repositories/whatsapp-contact.repository'
import { WhatsAppConversationRepository } from '@/src/repositories/whatsapp-conversation.repository'
import { WhatsAppConversationEventRepository } from '@/src/repositories/whatsapp-conversation-event.repository'
import { WhatsAppMessageRepository } from '@/src/repositories/whatsapp-message.repository'
import { WhatsAppTeamRepository } from '@/src/repositories/whatsapp-team.repository'
import { CrmWorkflowService } from './crm-workflow.service'
import type { WhatsAppCloseClassification } from './whatsapp-close-status.service'
import { closeWhatsAppConversationBySystem } from './whatsapp-conversation.service'
import { whatsAppTeamMemberIds } from './whatsapp-conversation-scope.service'
import {
  notifyWhatsAppUsers,
  whatsAppConversationPath,
} from './whatsapp-notify'

/** Notes appended to the contact are capped so the field stays readable. */
const NOTE_MAX = 2000
const MS_PER_HOUR = 60 * 60 * 1000

export interface AiCampaignActionContext {
  campaign: Pick<WhatsAppAiCampaign, 'id' | 'name' | 'workspaceId'>
  conversation: WhatsAppConversation
  contact: WhatsAppContact
}

interface ActionResult {
  ok: boolean
  /** Shown in the action log (and the error when it failed). */
  detail?: string
  payload?: Prisma.InputJsonValue
}

function noteLine(campaignName: string, note: string): string {
  const stamp = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date())
  return `[${stamp} · ${campaignName}] ${note}`
}

/** The conversation leaves the AI and goes to a person or a team queue. */
async function handOff(
  ctx: AiCampaignActionContext,
  data: Prisma.WhatsAppConversationUncheckedUpdateInput,
  notify: { userIds: string[]; title: string },
): Promise<void> {
  await WhatsAppConversationRepository.update(ctx.conversation.id, {
    ...data,
    aiActive: false,
    aiHandoff: true,
  })
  const label = ctx.contact.name ?? ctx.contact.waId
  await notifyWhatsAppUsers({
    workspaceId: ctx.campaign.workspaceId,
    kind: 'WHATSAPP_AI_HANDOFF',
    userIds: notify.userIds,
    title: notify.title,
    body: `${label} — campanha ${ctx.campaign.name}.`,
    path: whatsAppConversationPath(ctx.conversation.id),
    meta: { conversationId: ctx.conversation.id, campaignId: ctx.campaign.id },
  })
}

async function runOne(
  ctx: AiCampaignActionContext,
  request: AiCampaignActionRequest,
): Promise<ActionResult> {
  const { action } = request
  const workspaceId = ctx.campaign.workspaceId

  switch (action.kind) {
    case 'TRANSFER_USER': {
      const member = await MembershipRepository.findByUserAndWorkspace(
        action.userId,
        workspaceId,
      )
      if (!member.ok || !member.value) {
        return {
          ok: false,
          detail: 'O atendente não é mais membro do workspace',
        }
      }
      const user = await UserRepository.findById(action.userId)
      const name = user.ok ? user.value.name : 'atendente'
      await handOff(
        ctx,
        { assignedUserId: action.userId, status: 'IN_PROGRESS' },
        {
          userIds: [action.userId],
          title: 'A IA da campanha transferiu uma conversa para você',
        },
      )
      await WhatsAppConversationEventRepository.create({
        workspaceId,
        conversationId: ctx.conversation.id,
        kind: 'ASSIGNED',
        source: 'AI_CAMPAIGN',
        actorUserId: null,
        reason: name,
      })
      return { ok: true, detail: `Transferida para ${name}` }
    }

    case 'TRANSFER_TEAM': {
      const team = await WhatsAppTeamRepository.findById(
        action.teamId,
        workspaceId,
      )
      if (!team.ok || !team.value) {
        return { ok: false, detail: 'A equipe não existe mais' }
      }
      await handOff(
        ctx,
        { teamId: action.teamId, assignedUserId: null, status: 'NEW' },
        {
          userIds: await whatsAppTeamMemberIds(workspaceId, action.teamId),
          title: `A IA da campanha mandou uma conversa para a equipe ${team.value.name}`,
        },
      )
      await WhatsAppConversationEventRepository.create({
        workspaceId,
        conversationId: ctx.conversation.id,
        kind: 'TEAM_CHANGED',
        source: 'AI_CAMPAIGN',
        actorUserId: null,
        reason: team.value.name,
      })
      return { ok: true, detail: `Enviada para a equipe ${team.value.name}` }
    }

    case 'CLOSE': {
      let classification: WhatsAppCloseClassification | null = null
      if (action.statusIds.length > 0) {
        const statuses =
          await WhatsAppCloseStatusRepository.listActive(workspaceId)
        if (!statuses.ok) return { ok: false, detail: statuses.error.message }
        const picked = statuses.value.filter((s) =>
          action.statusIds.includes(s.id),
        )
        if (picked.length > 0) {
          classification = {
            outcome: picked.some((s) => s.outcome === 'FAILURE')
              ? 'FAILURE'
              : 'SUCCESS',
            statusIds: picked.map((s) => s.id),
            labels: picked.map((s) => s.label),
          }
        }
      }
      const fresh = await WhatsAppConversationRepository.findByIdRaw(
        ctx.conversation.id,
      )
      if (!fresh.ok || !fresh.value) {
        return { ok: false, detail: 'Conversa não encontrada' }
      }
      const closed = await closeWhatsAppConversationBySystem(fresh.value, {
        source: 'AI_CAMPAIGN',
        reason: `${action.label}: ${request.reason}`,
        classification,
      })
      if (!closed.ok) return { ok: false, detail: closed.error.message }
      return {
        ok: true,
        detail: classification
          ? `Fechada como ${classification.labels.join(', ')}`
          : 'Fechada',
      }
    }

    case 'OPT_OUT': {
      const updated = await WhatsAppContactRepository.setBroadcastOptOut(
        ctx.contact.id,
        { at: new Date(), source: 'AI' },
      )
      if (!updated.ok) return { ok: false, detail: updated.error.message }
      return { ok: true, detail: 'Contato descadastrado' }
    }

    case 'ADD_NOTE': {
      const note = request.note?.trim()
      if (!note) return { ok: false, detail: 'A IA não informou o que anotar' }
      const line = noteLine(ctx.campaign.name, note)
      const description = [ctx.contact.description?.trim(), line]
        .filter(Boolean)
        .join('\n')
        .slice(-NOTE_MAX)
      const updated = await WhatsAppContactRepository.update(ctx.contact.id, {
        description,
      })
      if (!updated.ok) return { ok: false, detail: updated.error.message }
      return { ok: true, detail: note, payload: { note } }
    }

    case 'FOLLOW_UP': {
      const scheduledAt = new Date()
      const payload: WhatsappBroadcastJobPayload['ai-campaign-follow-up'] = {
        workspaceId,
        campaignId: ctx.campaign.id,
        conversationId: ctx.conversation.id,
        actionId: action.id,
        reason: request.reason,
        scheduledAt: scheduledAt.toISOString(),
      }
      await getWhatsappBroadcastQueue().add(
        WhatsappBroadcastJob.AiCampaignFollowUp,
        payload,
        { delay: action.delayHours * MS_PER_HOUR },
      )
      return {
        ok: true,
        detail: `Retorno em ${action.delayHours} h se o contato não responder`,
      }
    }

    case 'CRM_WORKFLOW': {
      const run = await CrmWorkflowService.triggerFromSystem(
        workspaceId,
        action.workflowId,
        {
          source: 'whatsapp_ai_campaign',
          campaignId: ctx.campaign.id,
          conversationId: ctx.conversation.id,
          contact: { waId: ctx.contact.waId, name: ctx.contact.name },
          reason: request.reason,
        },
      )
      if (!run.ok) return { ok: false, detail: run.error.message }
      return {
        ok: true,
        detail: 'Workflow disparado',
        payload: { runId: run.value.id },
      }
    }

    case 'WEBHOOK': {
      try {
        const response = await postAiCampaignWebhook({
          url: action.url,
          secret: action.secret,
          body: {
            event: AI_CAMPAIGN_WEBHOOK_EVENT,
            workspaceId,
            campaign: { id: ctx.campaign.id, name: ctx.campaign.name },
            action: { id: action.id, label: action.label },
            conversationId: ctx.conversation.id,
            contact: { waId: ctx.contact.waId, name: ctx.contact.name },
            reason: request.reason,
            fields: request.fields,
            occurredAt: new Date().toISOString(),
          },
        })
        return {
          ok: true,
          detail: `Webhook respondeu ${response.status}`,
          payload: { fields: request.fields },
        }
      } catch (error) {
        return {
          ok: false,
          detail: error instanceof Error ? error.message : 'Falha no webhook',
          payload: { fields: request.fields },
        }
      }
    }
  }
}

export const WhatsAppAiCampaignActionService = {
  /**
   * Runs the actions the AI asked for (after its reply went out): each one
   * is recorded in the action log and the conversation timeline, and
   * audited. A failure never stops the next action.
   */
  async run(
    ctx: AiCampaignActionContext,
    requests: AiCampaignActionRequest[],
  ): Promise<Result<{ succeeded: number; failed: number }>> {
    let succeeded = 0
    let failed = 0
    for (const request of requests) {
      let result: ActionResult
      try {
        result = await runOne(ctx, request)
      } catch (error) {
        result = {
          ok: false,
          detail: error instanceof Error ? error.message : String(error),
        }
      }
      if (result.ok) succeeded += 1
      else failed += 1

      await WhatsAppAiCampaignRepository.createActionRun({
        workspaceId: ctx.campaign.workspaceId,
        campaignId: ctx.campaign.id,
        conversationId: ctx.conversation.id,
        contactId: ctx.contact.id,
        actionId: request.action.id,
        kind: request.action.kind,
        label: request.action.label,
        reason: request.reason,
        ...(result.payload !== undefined ? { payload: result.payload } : {}),
        status: result.ok ? 'SUCCESS' : 'FAILED',
        error: result.ok ? null : (result.detail ?? 'Falha'),
      })
      await WhatsAppConversationEventRepository.create({
        workspaceId: ctx.campaign.workspaceId,
        conversationId: ctx.conversation.id,
        kind: 'AI_ACTION',
        source: 'AI_CAMPAIGN',
        actorUserId: null,
        reason: `${request.action.label}: ${request.reason}${
          result.ok ? '' : ` (falhou: ${result.detail ?? 'erro'})`
        }`,
      })
      auditMutation({
        entity: 'whatsapp_ai_campaign',
        action: 'update',
        actorId: null,
        targetId: ctx.campaign.id,
        outcome: result.ok ? 'success' : 'failure',
        meta: {
          workspaceId: ctx.campaign.workspaceId,
          conversationId: ctx.conversation.id,
          aiAction: request.action.kind,
          actionId: request.action.id,
          actor: 'system',
        },
      })
      if (!result.ok) {
        logger.warn('whatsapp.ai_campaign.action_failed', {
          component: 'WhatsAppAiCampaignActionService',
          campaignId: ctx.campaign.id,
          conversationId: ctx.conversation.id,
          kind: request.action.kind,
          reason: result.detail,
        })
      }
    }

    const fresh = await WhatsAppConversationRepository.findById(
      ctx.conversation.id,
      ctx.campaign.workspaceId,
    )
    if (fresh.ok && fresh.value) {
      await publishWhatsAppEvent(ctx.campaign.workspaceId, {
        type: 'conversation.updated',
        conversation: toWhatsAppConversationDTO(fresh.value),
      })
    }
    return ok({ succeeded, failed })
  },

  /**
   * FOLLOW_UP fired (worker): if the contact has not written since the AI
   * scheduled it and the AI still has the conversation, the AI writes again
   * following the reason it gave. Business hours apply in the reply job.
   */
  async followUp(
    payload: WhatsappBroadcastJobPayload['ai-campaign-follow-up'],
  ): Promise<Result<{ status: 'sent' | 'skipped'; reason?: string }>> {
    const conversation = await WhatsAppConversationRepository.findByIdRaw(
      payload.conversationId,
    )
    if (!conversation.ok) return conversation
    const current = conversation.value
    if (!current || current.deletedAt) {
      return ok({ status: 'skipped', reason: 'conversation_missing' })
    }
    if (current.status === 'CLOSED') {
      return ok({ status: 'skipped', reason: 'conversation_closed' })
    }
    if (!current.aiActive || current.aiCampaignId !== payload.campaignId) {
      return ok({ status: 'skipped', reason: 'ai_not_in_charge' })
    }

    const latest = await WhatsAppMessageRepository.listLatestByConversation(
      payload.conversationId,
      10,
    )
    if (!latest.ok) return latest
    const scheduledAt = new Date(payload.scheduledAt)
    if (
      latest.value.some(
        (message) =>
          message.direction === 'IN' && message.createdAt > scheduledAt,
      )
    ) {
      return ok({ status: 'skipped', reason: 'contact_replied' })
    }
    const last = latest.value[0]
    if (!last) return ok({ status: 'skipped', reason: 'no_messages' })

    await getWhatsappAiReplyQueue().add(WhatsappAiReplyJob.GenerateAiReply, {
      conversationId: payload.conversationId,
      messageId: last.id,
      instruction: `Retome a conversa com o cliente, de forma breve e natural, conforme combinado: ${payload.reason}`,
    })
    return ok({ status: 'sent' })
  },
}
