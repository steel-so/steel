import { logFields } from '@/lib/axiom/log-fields'
import { logger } from '@/lib/axiom/logger'
import { ok, type Result } from '@/src/lib/result'
import { toAiPendingActionDTO } from '@/src/mappers/ai-pending-action.mapper'
import {
  type InboxAgentPendingRow,
  InboxAiPendingRepository,
  type InboxAssistantPendingRow,
} from '@/src/repositories/inbox-ai-pending.repository'
import type {
  InboxAiPendingItemDTO,
  InboxAiPendingListDTO,
} from '@/types/notification'
import { assertMember } from './authz'
import { emitNotification } from './notification-emitter'
import { canManageSteelAgents } from './steel-agent.service'
import { steelAgentRunPath } from './steel-agent-notifications'

/** How long before expiry the assistant warns the requester. */
export const AI_ACTION_EXPIRY_NOTICE_MS = 5 * 60 * 1000

function assistantItem(row: InboxAssistantPendingRow): InboxAiPendingItemDTO {
  const client = row.integrationGrant?.client ?? null
  return {
    source: 'ASSISTANT',
    action: toAiPendingActionDTO(row),
    // MCP actions have no conversation: they are decided right here.
    path: row.conversation
      ? `/ai/${row.conversation.id}`
      : client
        ? '/inbox?view=ai'
        : '/ai',
    conversation: row.conversation
      ? { id: row.conversation.id, title: row.conversation.title }
      : null,
    agent: null,
    runId: null,
    client: client ? { id: client.clientId, name: client.name } : null,
  }
}

function agentItem(row: InboxAgentPendingRow): InboxAiPendingItemDTO {
  const run = row.agentRun
  return {
    source: 'AGENT',
    action: toAiPendingActionDTO(row),
    path: run ? steelAgentRunPath(run.agentId, run.id) : '/ai/agents',
    conversation: null,
    agent: run ? { id: run.agent.id, name: run.agent.name } : null,
    runId: run?.id ?? null,
    client: null,
  }
}

function previewTitle(preview: unknown): string | null {
  if (preview && typeof preview === 'object' && 'title' in preview) {
    const title = (preview as { title: unknown }).title
    return typeof title === 'string' && title.trim() ? title : null
  }
  return null
}

/**
 * "Pendências da IA" of the inbox: the caller's own assistant actions
 * (Build mode, `requestedById = caller`) plus the Steel Agent approvals the
 * caller may decide — the agent owner, or anyone who manages Steel Agents
 * (same rule as `SteelAgentApprovalService`). Decisions reuse the existing
 * confirm/cancel and approve/reject routes, which re-check everything.
 */
export const InboxAiPendingService = {
  async list(
    actorId: string,
    workspaceId: string,
    now: Date = new Date(),
  ): Promise<Result<InboxAiPendingListDTO>> {
    const membership = await assertMember(actorId, workspaceId)
    if (!membership.ok) return membership

    const manager = canManageSteelAgents(membership.value)
    const [assistant, agent] = await Promise.all([
      InboxAiPendingRepository.listAssistant(workspaceId, actorId, now),
      InboxAiPendingRepository.listAgent(
        workspaceId,
        now,
        manager ? undefined : actorId,
      ),
    ])
    if (!assistant.ok) return assistant
    if (!agent.ok) return agent

    const items = [
      ...assistant.value.map(assistantItem),
      ...agent.value.map(agentItem),
    ].sort((a, b) => a.action.expiresAt.localeCompare(b.action.expiresAt))

    return ok({ items, count: items.length })
  },

  /**
   * Tick (every minute): warns each requester once (`dedupeKey`) when an
   * assistant action is about to expire. Agent approvals last 72 h and
   * already have their own notice, so they are not included.
   */
  async notifyExpiring(now: Date = new Date()): Promise<Result<number>> {
    const expiring = await InboxAiPendingRepository.listExpiringAssistant(
      now,
      new Date(now.getTime() + AI_ACTION_EXPIRY_NOTICE_MS),
    )
    if (!expiring.ok) return expiring

    let sent = 0
    for (const action of expiring.value) {
      const minutes = Math.max(
        1,
        Math.ceil((action.expiresAt.getTime() - now.getTime()) / 60000),
      )
      const title = previewTitle(action.preview)
      sent += await emitNotification({
        workspaceId: action.workspaceId,
        recipients: [action.requestedById],
        kind: 'AI_ACTION_EXPIRING',
        title:
          minutes === 1
            ? 'Uma ação do Steel AI expira em 1 minuto'
            : `Uma ação do Steel AI expira em ${minutes} minutos`,
        body: title
          ? `${title}. Confirme ou cancele antes que ela expire.`
          : 'Confirme ou cancele a ação antes que ela expire.',
        path: '/inbox?view=ai',
        dedupeKey: `ai-action-expiring:${action.id}`,
      })
    }

    logger.info(
      'notifications.ai_action_expiry_tick',
      logFields(
        { component: 'InboxAiPendingService' },
        { candidates: expiring.value.length, sent },
      ),
    )
    return ok(sent)
  },
}
