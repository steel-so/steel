import { logger } from '@/lib/axiom/logger'
import { NEXT_PUBLIC_URL } from '@/lib/env/env'
import { sendWhatsAppUnassignedConversationEmail } from '@/src/lib/mail/workspace/send-whatsapp-unassigned-conversation'
import { ok, type Result } from '@/src/lib/result'
import {
  filterSupervisorRecipients,
  teamLeaderIds,
} from '@/src/lib/whatsapp/supervisor-recipients'
import {
  toWhatsAppSettingsDTO,
  WHATSAPP_SETTINGS_DEFAULTS,
} from '@/src/mappers/whatsapp-settings.mapper'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import {
  WhatsAppConversationRepository,
  type WhatsAppConversationWithPreview,
} from '@/src/repositories/whatsapp-conversation.repository'
import { WhatsAppSettingsRepository } from '@/src/repositories/whatsapp-settings.repository'
import { WorkspaceRepository } from '@/src/repositories/workspace.repository'
import { WorkspaceModuleAccessRepository } from '@/src/repositories/workspace-module-access.repository'
import type { WhatsAppSettingsDTO } from '@/types/whatsapp-settings'
import { loadWhatsAppTeamSnapshot } from './whatsapp-conversation-scope.service'
import {
  notifyWhatsAppUsers,
  whatsAppConversationPath,
} from './whatsapp-notify'

const MINUTE_MS = 60 * 1000
const HOUR_MS = 60 * MINUTE_MS

/** A conversation unattended for longer than this no longer gets a reminder. */
export const WHATSAPP_UNASSIGNED_REMINDER_LOOKBACK_HOURS = 48
/** Reminders sent per rule group and tick (the rest waits for the next one). */
export const WHATSAPP_UNASSIGNED_REMINDER_BATCH = 100

/** "10 minutos", "1 hora", "1 hora e 5 min". */
export function formatWaitingTime(minutes: number): string {
  const total = Math.max(1, Math.round(minutes))
  if (total < 60) return total === 1 ? '1 minuto' : `${total} minutos`
  const hours = Math.floor(total / 60)
  const rest = total % 60
  const hoursLabel = hours === 1 ? '1 hora' : `${hours} horas`
  return rest === 0 ? hoursLabel : `${hoursLabel} e ${rest} min`
}

export type WhatsAppUnassignedNotice =
  /** The conversation just reached the queue and nobody took it. */
  | { kind: 'queued'; reason: 'no_team' | 'no_agent_available' }
  /** It stayed without an assignee past the configured time. */
  | { kind: 'reminder'; waitingMinutes: number }

interface NoticeResult {
  recipients: number
  inApp: number
  email: number
}

export const WhatsAppUnassignedAlertService = {
  /**
   * Tells the supervisors (configured list, else OWNER/ADMIN — the recipients
   * of the sentiment alert), plus the leaders of the conversation's team,
   * that a conversation is waiting. In-app and e-mail follow the workspace
   * settings. System flow: failures are logged, never raised.
   */
  async notifySupervisors(input: {
    workspaceId: string
    conversation: WhatsAppConversationWithPreview
    settings: WhatsAppSettingsDTO
    notice: WhatsAppUnassignedNotice
  }): Promise<NoticeResult> {
    const { workspaceId, conversation, settings, notice } = input
    const none: NoticeResult = { recipients: 0, inApp: 0, email: 0 }
    if (
      !settings.unassignedAlertNotifyInApp &&
      !settings.unassignedAlertNotifyEmail
    ) {
      return none
    }

    const [members, teams] = await Promise.all([
      MembershipRepository.listWithUserByWorkspace(workspaceId),
      loadWhatsAppTeamSnapshot(workspaceId),
    ])
    if (!members.ok || !teams.ok) {
      logger.warn('whatsapp.unassigned_alert.recipients_failed', {
        component: 'WhatsAppUnassignedAlertService',
        workspaceId,
        conversationId: conversation.id,
      })
      return none
    }

    const recipients = filterSupervisorRecipients({
      members: members.value,
      configuredIds: settings.sentimentAlertRecipientIds,
      extraUserIds: teamLeaderIds(teams.value, conversation.teamId),
      target: { assignedUserId: null, teamId: conversation.teamId },
      teams: teams.value,
    })
    if (recipients.length === 0) return none

    const label = conversation.contact.name ?? conversation.contact.waId
    const teamName = conversation.team?.name ?? null
    const waiting =
      notice.kind === 'reminder' ? formatWaitingTime(notice.waitingMinutes) : ''
    const title =
      notice.kind === 'reminder'
        ? `Conversa sem atendente há ${waiting}`
        : 'Conversa aguardando atendente'
    const body =
      notice.kind === 'reminder'
        ? `${label} ainda aguarda atendimento${teamName ? ` na equipe ${teamName}` : ''}.`
        : notice.reason === 'no_agent_available'
          ? `${label} está na fila e nenhum atendente pode recebê-la agora.`
          : `${label} está na fila sem equipe nem atendente.`

    let inApp = 0
    if (settings.unassignedAlertNotifyInApp) {
      inApp = await notifyWhatsAppUsers({
        workspaceId,
        kind: 'WHATSAPP_CONVERSATION_UNATTENDED',
        userIds: recipients.map((member) => member.userId),
        title,
        body,
        path: whatsAppConversationPath(conversation.id),
        meta: {
          conversationId: conversation.id,
          via: 'unassigned_alert',
          notice: notice.kind,
        },
      })
    }

    let emailed = 0
    if (settings.unassignedAlertNotifyEmail) {
      const workspace = await WorkspaceRepository.findById(workspaceId)
      if (workspace.ok) {
        const redirectUrl = `${NEXT_PUBLIC_URL}/${workspace.value.slug}/zap?conversa=${conversation.id}`
        const results = await Promise.allSettled(
          recipients.map((member) =>
            sendWhatsAppUnassignedConversationEmail({
              email: member.user.email,
              username: member.user.name,
              workspaceName: workspace.value.name,
              contactLabel: label,
              waitingFor: waiting || 'alguns instantes',
              teamName,
              redirectUrl,
            }),
          ),
        )
        emailed = results.filter((r) => r.status === 'fulfilled').length
        if (emailed < results.length) {
          logger.warn('whatsapp.unassigned_alert.email_failed', {
            component: 'WhatsAppUnassignedAlertService',
            workspaceId,
            conversationId: conversation.id,
            failed: results.length - emailed,
          })
        }
      }
    }

    return { recipients: recipients.length, inApp, email: emailed }
  },

  /**
   * Tick: one reminder per unassigned streak for every conversation that has
   * waited past its workspace's `unassignedReminderMinutes` (0 = off). Rule
   * groups keep the query exact: workspaces that never saved settings use the
   * default, the rest are grouped by their own value. Conversations of a
   * workspace without the module, or the AI is answering, are left alone.
   */
  async remindUnattended(
    now: Date = new Date(),
  ): Promise<Result<{ reminded: number }>> {
    const rows = await WhatsAppSettingsRepository.listAll()
    if (!rows.ok) return rows

    const byMinutes = new Map<number, string[]>()
    for (const row of rows.value) {
      if (row.unassignedReminderMinutes <= 0) continue
      const ids = byMinutes.get(row.unassignedReminderMinutes) ?? []
      ids.push(row.workspaceId)
      byMinutes.set(row.unassignedReminderMinutes, ids)
    }
    const groups: {
      minutes: number
      workspaceIds: { in: string[] } | { notIn: string[] }
    }[] = [
      {
        minutes: WHATSAPP_SETTINGS_DEFAULTS.unassignedReminderMinutes,
        workspaceIds: { notIn: rows.value.map((row) => row.workspaceId) },
      },
      ...[...byMinutes].map(([minutes, ids]) => ({
        minutes,
        workspaceIds: { in: ids },
      })),
    ]
    const settingsByWorkspace = new Map(
      rows.value.map((row) => [
        row.workspaceId,
        toWhatsAppSettingsDTO(row.workspaceId, row),
      ]),
    )
    const moduleByWorkspace = new Map<string, boolean>()

    let reminded = 0
    for (const group of groups) {
      const candidates =
        await WhatsAppConversationRepository.listUnattendedForReminder({
          workspaceIds: group.workspaceIds,
          cutoff: new Date(now.getTime() - group.minutes * MINUTE_MS),
          notBefore: new Date(
            now.getTime() -
              WHATSAPP_UNASSIGNED_REMINDER_LOOKBACK_HOURS * HOUR_MS,
          ),
          limit: WHATSAPP_UNASSIGNED_REMINDER_BATCH,
        })
      if (!candidates.ok) {
        logger.error('whatsapp.unassigned_alert.list_failed', {
          component: 'WhatsAppUnassignedAlertService',
          reason: candidates.error.code,
        })
        continue
      }

      for (const conversation of candidates.value) {
        const { workspaceId } = conversation
        let enabled = moduleByWorkspace.get(workspaceId)
        if (enabled === undefined) {
          const access = await WorkspaceModuleAccessRepository.isEnabled(
            workspaceId,
            'COMMUNICATION',
          )
          enabled = access.ok && access.value
          moduleByWorkspace.set(workspaceId, enabled)
        }
        if (!enabled) continue

        const claimed =
          await WhatsAppConversationRepository.claimUnassignedReminder(
            conversation.id,
            now,
          )
        if (!claimed.ok || !claimed.value) continue

        const settings =
          settingsByWorkspace.get(workspaceId) ??
          toWhatsAppSettingsDTO(workspaceId, null)
        const since = conversation.queuedAt ?? conversation.createdAt
        await this.notifySupervisors({
          workspaceId,
          conversation,
          settings,
          notice: {
            kind: 'reminder',
            waitingMinutes: (now.getTime() - since.getTime()) / MINUTE_MS,
          },
        })
        reminded += 1
      }
    }

    if (reminded > 0) {
      logger.info('whatsapp.unassigned_alert.reminded', {
        component: 'WhatsAppUnassignedAlertService',
        reminded,
      })
    }
    return ok({ reminded })
  },
}
