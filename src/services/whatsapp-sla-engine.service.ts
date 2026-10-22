import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import { NEXT_PUBLIC_URL } from '@/lib/env/env'
import { sendWhatsAppSlaAlertEmail } from '@/src/lib/mail/workspace/send-whatsapp-sla-alert'
import { ok, type Result } from '@/src/lib/result'
import { WHATSAPP_BUSINESS_HOURS_TIME_ZONE } from '@/src/lib/whatsapp/business-hours'
import {
  canSeeConversation,
  scopeFromSnapshot,
} from '@/src/lib/whatsapp/conversation-scope'
import { publishWhatsAppEvent } from '@/src/lib/whatsapp/realtime'
import { toWhatsAppConversationDTO } from '@/src/mappers/whatsapp-conversation.mapper'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { WhatsAppConversationRepository } from '@/src/repositories/whatsapp-conversation.repository'
import { WhatsAppConversationEventRepository } from '@/src/repositories/whatsapp-conversation-event.repository'
import {
  type WhatsAppSlaCycleForScan,
  WhatsAppSlaCycleRepository,
  type WhatsAppSlaTargetKind,
  type WhatsAppSlaTransition,
} from '@/src/repositories/whatsapp-sla-cycle.repository'
import { WhatsAppSlaPolicyRepository } from '@/src/repositories/whatsapp-sla-policy.repository'
import { WorkspaceRepository } from '@/src/repositories/workspace.repository'
import { loadWhatsAppTeamSnapshot } from './whatsapp-conversation-scope.service'
import { notifyWhatsAppUsers, whatsAppAdminIds } from './whatsapp-notify'

/** Cycles handled per transition per scan (the next minute takes the rest). */
export const WHATSAPP_SLA_SCAN_BATCH = 200

/** Who is told, defaulting like a freshly created policy when it is gone. */
interface NoticeRules {
  enabled: boolean
  notifyAssignee: boolean
  notifyTeamLeaders: boolean
  notifySupervisors: boolean
  supervisorIds: string[]
  notifyInApp: boolean
  notifyEmail: boolean
}

const FALLBACK_RULES: NoticeRules = {
  enabled: true,
  notifyAssignee: true,
  notifyTeamLeaders: true,
  notifySupervisors: true,
  supervisorIds: [],
  notifyInApp: true,
  notifyEmail: false,
}

const TARGET_LABEL: Record<WhatsAppSlaTargetKind, string> = {
  firstResponse: 'primeira resposta',
  resolution: 'resolução',
}

const EVENT_REASON: Record<WhatsAppSlaTargetKind, string> = {
  firstResponse: 'Primeira resposta',
  resolution: 'Resolução',
}

const dueFormatter = new Intl.DateTimeFormat('pt-BR', {
  timeZone: WHATSAPP_BUSINESS_HOURS_TIME_ZONE,
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
})

/** "23/10 às 14:35" in the workspace time zone. */
export function formatSlaDue(date: Date): string {
  const parts = Object.fromEntries(
    dueFormatter.formatToParts(date).map((part) => [part.type, part.value]),
  )
  return `${parts.day}/${parts.month} às ${parts.hour}:${parts.minute}`
}

function dueOf(
  cycle: WhatsAppSlaCycleForScan,
  kind: WhatsAppSlaTargetKind,
): Date {
  // The scan only returns resolution cycles that have a resolution target.
  return kind === 'firstResponse'
    ? cycle.firstResponseDueAt
    : (cycle.resolutionDueAt as Date)
}

async function recipientsOf(
  cycle: WhatsAppSlaCycleForScan,
  rules: NoticeRules,
): Promise<Result<{ id: string; name: string; email: string }[]>> {
  const members = await MembershipRepository.listWithUserByWorkspace(
    cycle.workspaceId,
  )
  if (!members.ok) return members
  const snapshot = await loadWhatsAppTeamSnapshot(cycle.workspaceId)
  if (!snapshot.ok) return snapshot

  const ids = new Set<string>()
  if (rules.notifyAssignee && cycle.conversation.assignedUserId) {
    ids.add(cycle.conversation.assignedUserId)
  }
  if (rules.notifyTeamLeaders && cycle.conversation.teamId) {
    const team = snapshot.value.find((t) => t.id === cycle.conversation.teamId)
    for (const member of team?.members ?? []) {
      if (member.role === 'LEADER') ids.add(member.userId)
    }
  }
  if (rules.notifySupervisors) {
    const supervisors =
      rules.supervisorIds.length > 0
        ? rules.supervisorIds
        : await whatsAppAdminIds(cycle.workspaceId)
    for (const id of supervisors) ids.add(id)
  }

  // Nobody is told about a conversation they cannot see (Equipes).
  const byUser = new Map(members.value.map((member) => [member.userId, member]))
  const recipients: { id: string; name: string; email: string }[] = []
  for (const id of ids) {
    const member = byUser.get(id)
    if (!member) continue
    const scope = scopeFromSnapshot(id, member.role, snapshot.value)
    if (!canSeeConversation(scope, cycle.conversation)) continue
    recipients.push({
      id,
      name: member.user.name,
      email: member.user.email,
    })
  }
  return ok(recipients)
}

async function notifyTransition(
  cycle: WhatsAppSlaCycleForScan,
  kind: WhatsAppSlaTargetKind,
  transition: WhatsAppSlaTransition,
  rules: NoticeRules,
): Promise<Result<{ inApp: number; email: number }>> {
  const recipients = await recipientsOf(cycle, rules)
  if (!recipients.ok) return recipients
  if (recipients.value.length === 0) return ok({ inApp: 0, email: 0 })

  const workspace = await WorkspaceRepository.findById(cycle.workspaceId)
  if (!workspace.ok) return workspace

  const contact = cycle.conversation.contact
  const contactLabel = contact.name ?? contact.waId
  const breached = transition === 'breach'
  const due = dueOf(cycle, kind)
  const path = `/zap?conversa=${cycle.conversationId}`

  let inApp = 0
  if (rules.notifyInApp) {
    inApp = await notifyWhatsAppUsers({
      workspaceId: cycle.workspaceId,
      kind: breached ? 'WHATSAPP_SLA_BREACHED' : 'WHATSAPP_SLA_AT_RISK',
      userIds: recipients.value.map((recipient) => recipient.id),
      title: `${breached ? 'SLA estourado' : 'SLA em risco'}: ${contactLabel}`,
      body: breached
        ? `O prazo de ${TARGET_LABEL[kind]} da conversa com ${contactLabel} venceu (${formatSlaDue(due)}).`
        : `O prazo de ${TARGET_LABEL[kind]} da conversa com ${contactLabel} vence em ${formatSlaDue(due)}.`,
      path,
      meta: {
        conversationId: cycle.conversationId,
        cycleId: cycle.id,
        via: 'sla',
        target: kind,
        transition,
      },
    })
  }

  let email = 0
  if (rules.notifyEmail) {
    const redirectUrl = `${NEXT_PUBLIC_URL}/${workspace.value.slug}${path}`
    const results = await Promise.allSettled(
      recipients.value.map((recipient) =>
        sendWhatsAppSlaAlertEmail({
          email: recipient.email,
          username: recipient.name,
          workspaceName: workspace.value.name,
          contactLabel,
          breached,
          targetLabel: TARGET_LABEL[kind],
          dueLabel: formatSlaDue(due),
          redirectUrl,
        }),
      ),
    )
    email = results.filter((result) => result.status === 'fulfilled').length
    if (email < results.length) {
      logger.warn('whatsapp.sla.email_failed', {
        component: 'WhatsAppSlaEngineService',
        cycleId: cycle.id,
        failed: results.length - email,
      })
    }
  }
  return ok({ inApp, email })
}

async function processCycle(
  cycle: WhatsAppSlaCycleForScan,
  kind: WhatsAppSlaTargetKind,
  transition: WhatsAppSlaTransition,
  now: Date,
): Promise<Result<boolean>> {
  const { conversation } = cycle
  // Self-heal: a cycle whose conversation is closed or gone must not alert.
  if (conversation.deletedAt || conversation.status === 'CLOSED') {
    const resolved = await WhatsAppSlaCycleRepository.resolveOpen(
      cycle.conversationId,
      { at: now, agentUserId: conversation.assignedUserId },
    )
    if (!resolved.ok) return resolved
    return ok(false)
  }

  const claimed = await WhatsAppSlaCycleRepository.claim(
    cycle.id,
    kind,
    transition,
    now,
    conversation.assignedUserId,
  )
  if (!claimed.ok) return claimed
  if (!claimed.value) return ok(false)

  const policy = cycle.policyId
    ? await WhatsAppSlaPolicyRepository.findById(
        cycle.policyId,
        cycle.workspaceId,
      )
    : ok(null)
  if (!policy.ok) return policy
  // A policy turned off after the cycle began stops notifying.
  if (policy.value && !policy.value.enabled) return ok(false)
  const rules: NoticeRules = policy.value ?? FALLBACK_RULES

  const notified = await notifyTransition(cycle, kind, transition, rules)
  if (!notified.ok) {
    // The notice is reserved already; surface the failure without retrying
    // (a retry would never fire again by design).
    logger.warn('whatsapp.sla.notify_failed', {
      component: 'WhatsAppSlaEngineService',
      cycleId: cycle.id,
      reason: notified.error.code,
    })
  }

  if (transition === 'breach') {
    const event = await WhatsAppConversationEventRepository.create({
      workspaceId: cycle.workspaceId,
      conversationId: cycle.conversationId,
      kind: 'SLA_BREACHED',
      source: 'SLA',
      actorUserId: null,
      reason: EVENT_REASON[kind],
    })
    if (!event.ok) return event

    const fresh = await WhatsAppConversationRepository.findById(
      cycle.conversationId,
      cycle.workspaceId,
    )
    if (fresh.ok && fresh.value) {
      await publishWhatsAppEvent(cycle.workspaceId, {
        type: 'conversation.updated',
        conversation: toWhatsAppConversationDTO(fresh.value),
      })
    }
  }

  auditMutation({
    entity: 'whatsapp_sla_cycle',
    action: 'alert',
    actorId: null,
    targetId: cycle.id,
    meta: {
      workspaceId: cycle.workspaceId,
      conversationId: cycle.conversationId,
      target: kind,
      transition,
      actor: 'system',
      inApp: notified.ok ? notified.value.inApp : 0,
      email: notified.ok ? notified.value.email : 0,
    },
  })
  return ok(true)
}

/** Order matters: a cycle past its deadline gets the breach, not a warning. */
const PASSES: [WhatsAppSlaTargetKind, WhatsAppSlaTransition][] = [
  ['firstResponse', 'breach'],
  ['firstResponse', 'warn'],
  ['resolution', 'breach'],
  ['resolution', 'warn'],
]

export const WhatsAppSlaEngineService = {
  /**
   * One minute of the engine: warns at the warning point and flags breaches,
   * each notice exactly once (conditional claim on the cycle flags). A failure
   * on one cycle is logged and does not stop the others.
   */
  async scanDue(
    now: Date = new Date(),
  ): Promise<Result<{ warned: number; breached: number }>> {
    let warned = 0
    let breached = 0

    for (const [kind, transition] of PASSES) {
      const due = await WhatsAppSlaCycleRepository.listDue(
        kind,
        transition,
        now,
        WHATSAPP_SLA_SCAN_BATCH,
      )
      if (!due.ok) return due

      for (const cycle of due.value) {
        try {
          const handled = await processCycle(cycle, kind, transition, now)
          if (!handled.ok) {
            logger.warn('whatsapp.sla.cycle_failed', {
              component: 'WhatsAppSlaEngineService',
              cycleId: cycle.id,
              reason: handled.error.code,
            })
          } else if (handled.value) {
            if (transition === 'breach') breached += 1
            else warned += 1
          }
        } catch (error) {
          logger.error('whatsapp.sla.cycle_threw', {
            component: 'WhatsAppSlaEngineService',
            cycleId: cycle.id,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }
    }
    return ok({ warned, breached })
  },
}
