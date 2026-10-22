import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import { NEXT_PUBLIC_URL } from '@/lib/env/env'
import { sendWhatsAppSentimentAlertEmail } from '@/src/lib/mail/workspace/send-whatsapp-sentiment-alert'
import { ok, type Result } from '@/src/lib/result'
import { publishWhatsAppEvent } from '@/src/lib/whatsapp/realtime'
import { filterSupervisorRecipients } from '@/src/lib/whatsapp/supervisor-recipients'
import { toWhatsAppConversationDTO } from '@/src/mappers/whatsapp-conversation.mapper'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { WhatsAppConversationRepository } from '@/src/repositories/whatsapp-conversation.repository'
import { WhatsAppConversationEventRepository } from '@/src/repositories/whatsapp-conversation-event.repository'
import { WorkspaceRepository } from '@/src/repositories/workspace.repository'
import { NotificationService } from './notification.service'
import { loadWhatsAppTeamSnapshot } from './whatsapp-conversation-scope.service'
import { WhatsAppSettingsService } from './whatsapp-settings.service'

const HOUR_MS = 60 * 60 * 1000

export type WhatsAppSentimentAlertOutcome =
  | {
      alerted: false
      reason:
        | 'disabled'
        | 'no_score'
        | 'above_threshold'
        | 'conversation_missing'
        | 'cooldown'
        | 'no_recipients'
    }
  | {
      alerted: true
      recipients: number
      inApp: boolean
      email: number
      assignedToId: string | null
    }

function formatScore(score: number): string {
  return score.toFixed(2).replace('.', ',')
}

export const WhatsAppSentimentAlertService = {
  /**
   * Regra de ação sobre o sentimento: quando a média da conversa cai até o
   * limite configurado, avisa os supervisores (no app e/ou e-mail) e, se
   * configurado, entrega a conversa sem atendente ao supervisor escolhido.
   * No máximo um alerta por conversa a cada `cooldown` horas. Fluxo de
   * sistema (job de sentimento) — auditado com `actorId: null`.
   */
  async evaluate(input: {
    workspaceId: string
    conversationId: string
    avgSentimentScore: number | null
    now?: Date
  }): Promise<Result<WhatsAppSentimentAlertOutcome>> {
    const now = input.now ?? new Date()

    const settings = await WhatsAppSettingsService.getEffective(
      input.workspaceId,
    )
    if (!settings.ok) return settings
    const rule = settings.value
    if (!rule.sentimentAlertEnabled) {
      return ok({ alerted: false, reason: 'disabled' })
    }
    if (input.avgSentimentScore === null) {
      return ok({ alerted: false, reason: 'no_score' })
    }
    if (input.avgSentimentScore > rule.sentimentAlertThreshold) {
      return ok({ alerted: false, reason: 'above_threshold' })
    }

    const conversation = await WhatsAppConversationRepository.findById(
      input.conversationId,
      input.workspaceId,
    )
    if (!conversation.ok) return conversation
    if (!conversation.value || conversation.value.deletedAt) {
      return ok({ alerted: false, reason: 'conversation_missing' })
    }

    const members = await MembershipRepository.listWithUserByWorkspace(
      input.workspaceId,
    )
    if (!members.ok) return members
    const supervisor = rule.sentimentAlertAssignToId
      ? members.value.find((m) => m.userId === rule.sentimentAlertAssignToId)
      : undefined
    const shouldAssign =
      supervisor !== undefined && !conversation.value.assignedUserId
    const assignedToId = shouldAssign && supervisor ? supervisor.userId : null

    // Equipes: someone who cannot see the conversation is never told about
    // it (the notice carries the contact name and a link).
    const snapshot = await loadWhatsAppTeamSnapshot(input.workspaceId)
    if (!snapshot.ok) return snapshot
    const target = {
      assignedUserId: assignedToId ?? conversation.value.assignedUserId,
      teamId: conversation.value.teamId,
    }
    const recipients = filterSupervisorRecipients({
      members: members.value,
      configuredIds: rule.sentimentAlertRecipientIds,
      target,
      teams: snapshot.value,
    })
    if (recipients.length === 0 && !shouldAssign) {
      return ok({ alerted: false, reason: 'no_recipients' })
    }

    // Anti-spam: reserva o alerta antes de avisar (escrita condicional).
    const claimed = await WhatsAppConversationRepository.claimSentimentAlert(
      input.conversationId,
      new Date(now.getTime() - rule.sentimentAlertCooldownHours * HOUR_MS),
      now,
    )
    if (!claimed.ok) return claimed
    if (!claimed.value) return ok({ alerted: false, reason: 'cooldown' })

    const workspace = await WorkspaceRepository.findById(input.workspaceId)
    if (!workspace.ok) return workspace

    const contact = conversation.value.contact
    const contactLabel = contact.name ?? contact.waId
    const score = formatScore(input.avgSentimentScore)
    const href = `/${workspace.value.slug}/zap?conversa=${input.conversationId}`

    if (shouldAssign && supervisor) {
      const assigned = await WhatsAppConversationRepository.update(
        input.conversationId,
        { assignedUserId: supervisor.userId, status: 'IN_PROGRESS' },
      )
      if (!assigned.ok) return assigned
      auditMutation({
        entity: 'whatsapp_conversation',
        action: 'assign',
        actorId: null,
        targetId: input.conversationId,
        meta: {
          assignedUserId: supervisor.userId,
          actor: 'system',
          via: 'sentiment_alert',
        },
      })
    }

    const userIds = recipients.map((member) => member.userId)
    let inApp = false
    if (rule.sentimentAlertNotifyInApp && userIds.length > 0) {
      const notified = await NotificationService.notifyUsers({
        workspaceId: input.workspaceId,
        userIds,
        kind: 'WHATSAPP_NEGATIVE_SENTIMENT',
        title: `Sentimento negativo: ${contactLabel}`,
        body: `A conversa com ${contactLabel} está com média de sentimento ${score}.${
          shouldAssign && supervisor
            ? ` Atribuída a ${supervisor.user.name}.`
            : ''
        }`,
        href,
      })
      inApp = notified.ok
      if (!notified.ok) {
        logger.error('whatsapp.sentiment_alert.notification_failed', {
          component: 'WhatsAppSentimentAlertService',
          conversationId: input.conversationId,
          reason: notified.error.code,
        })
      }
    }

    let emailed = 0
    if (rule.sentimentAlertNotifyEmail) {
      const redirectUrl = `${NEXT_PUBLIC_URL}${href}`
      const results = await Promise.allSettled(
        recipients.map((member) =>
          sendWhatsAppSentimentAlertEmail({
            email: member.user.email,
            username: member.user.name,
            workspaceName: workspace.value.name,
            contactLabel,
            averageScore: score,
            redirectUrl,
          }),
        ),
      )
      emailed = results.filter((r) => r.status === 'fulfilled').length
      if (emailed < results.length) {
        logger.warn('whatsapp.sentiment_alert.email_failed', {
          component: 'WhatsAppSentimentAlertService',
          conversationId: input.conversationId,
          failed: results.length - emailed,
        })
      }
    }

    const event = await WhatsAppConversationEventRepository.create({
      workspaceId: input.workspaceId,
      conversationId: input.conversationId,
      kind: 'SENTIMENT_ALERT',
      source: 'SENTIMENT',
      actorUserId: null,
      reason: `Média de sentimento ${score}`,
    })
    if (!event.ok) return event

    auditMutation({
      entity: 'whatsapp_conversation',
      action: 'alert',
      actorId: null,
      targetId: input.conversationId,
      meta: {
        workspaceId: input.workspaceId,
        actor: 'system',
        via: 'sentiment_alert',
        avgSentimentScore: input.avgSentimentScore,
        recipients: userIds.length,
        inApp,
        email: emailed,
        assignedToId,
      },
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

    return ok({
      alerted: true,
      recipients: userIds.length,
      inApp,
      email: emailed,
      assignedToId,
    })
  },
}
