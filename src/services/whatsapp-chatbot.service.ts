import type { Prisma } from '@prisma/client'
import { auditMutation } from '@/lib/axiom/audit'
import {
  validationError,
  whatsappChatbotInvalidFlow,
  whatsappChatbotLimitReached,
  whatsappChatbotNotFound,
  whatsappChatbotNotPublished,
  whatsappConnectionNotFound,
} from '@/src/errors'
import { err, ok, type Result } from '@/src/lib/result'
import {
  type ChatbotContext,
  initialChatbotState,
  parseChatbotState,
  resumeFlow,
  startFlow,
} from '@/src/lib/whatsapp/chatbot/engine'
import { flowFromTemplate } from '@/src/lib/whatsapp/chatbot/templates'
import {
  type ChatbotFlowIssue,
  hasFlowErrors,
  validateChatbotFlow,
} from '@/src/lib/whatsapp/chatbot/validate'
import {
  emptyChatbotStats,
  parseStoredFlow,
  toWhatsAppChatbotDTO,
  toWhatsAppChatbotListItemDTO,
  toWhatsAppChatbotSessionDTO,
} from '@/src/mappers/whatsapp-chatbot.mapper'
import { WhatsAppButtonActionRepository } from '@/src/repositories/whatsapp-button-action.repository'
import { WhatsAppChatbotRepository } from '@/src/repositories/whatsapp-chatbot.repository'
import { WhatsAppChatbotNodeStatRepository } from '@/src/repositories/whatsapp-chatbot-node-stat.repository'
import { WhatsAppChatbotSessionRepository } from '@/src/repositories/whatsapp-chatbot-session.repository'
import { WhatsAppConnectionRepository } from '@/src/repositories/whatsapp-connection.repository'
import type {
  ChatbotFlow,
  CreateWhatsAppChatbotDTO,
  ListWhatsAppChatbotSessionsDTO,
  SetWhatsAppChatbotStatusDTO,
  SimulateWhatsAppChatbotDTO,
  UpdateWhatsAppChatbotDTO,
} from '@/src/schemas/whatsapp-chatbot.schema'
import type {
  WhatsAppChatbotDTO,
  WhatsAppChatbotFlowIssueDTO,
  WhatsAppChatbotListItemDTO,
  WhatsAppChatbotNodeStatsDTO,
  WhatsAppChatbotPublishDTO,
  WhatsAppChatbotSessionDTO,
  WhatsAppChatbotSimulationDTO,
  WhatsAppChatbotStatsDTO,
} from '@/types/whatsapp-chatbot'
import {
  assertMember,
  assertModuleMember,
  assertModulePrivileged,
} from './authz'

export const WHATSAPP_CHATBOT_MAX_PER_WORKSPACE = 20
const STATS_WINDOW_DAYS = 30

async function loadOwned(workspaceId: string, id: string) {
  const bot = await WhatsAppChatbotRepository.findById(id, workspaceId)
  if (!bot.ok) return bot
  if (!bot.value) return err(whatsappChatbotNotFound())
  return ok(bot.value)
}

function toJsonFlow(flow: ChatbotFlow): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(flow))
}

function statsFor(
  rows: Array<{ chatbotId: string; status: string; count: number }>,
  chatbotId: string,
): WhatsAppChatbotStatsDTO {
  const stats = emptyChatbotStats()
  for (const row of rows) {
    if (row.chatbotId !== chatbotId) continue
    stats.sessions += row.count
    switch (row.status) {
      case 'RUNNING':
        stats.running += row.count
        break
      case 'COMPLETED':
        stats.completed += row.count
        break
      case 'HANDED_OFF_HUMAN':
        stats.handedOffHuman += row.count
        break
      case 'HANDED_OFF_AI':
        stats.handedOffAi += row.count
        break
      case 'EXPIRED':
        stats.expired += row.count
        break
      case 'CANCELLED':
        stats.cancelled += row.count
        break
      case 'FAILED':
        stats.failed += row.count
        break
    }
  }
  return stats
}

/** Teams and agents named by handoff nodes must exist in the workspace. */
async function referenceIssues(
  workspaceId: string,
  flow: ChatbotFlow,
): Promise<Result<ChatbotFlowIssue[]>> {
  const issues: ChatbotFlowIssue[] = []
  for (const node of flow.nodes) {
    if (node.type !== 'handoff-human') continue
    if (node.data.teamId) {
      const team = await WhatsAppButtonActionRepository.findTeam(
        workspaceId,
        node.data.teamId,
      )
      if (!team.ok) return team
      if (!team.value) {
        issues.push({
          severity: 'error',
          nodeId: node.id,
          message: 'Passar para atendente: a equipe escolhida não existe mais',
        })
      }
    }
    if (node.data.userId) {
      const member = await assertMember(node.data.userId, workspaceId)
      if (!member.ok) {
        issues.push({
          severity: 'error',
          nodeId: node.id,
          message:
            'Passar para atendente: o atendente escolhido não faz mais parte do workspace',
        })
      }
    }
  }
  return ok(issues)
}

function toIssueDTOs(
  issues: ChatbotFlowIssue[],
): WhatsAppChatbotFlowIssueDTO[] {
  return issues.map((issue) => ({ ...issue }))
}

export const WhatsAppChatbotService = {
  async list(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<WhatsAppChatbotListItemDTO[]>> {
    const access = await assertModuleMember(
      actorId,
      workspaceId,
      'COMMUNICATION',
      { resource: 'conversations', action: 'VIEW' },
    )
    if (!access.ok) return access

    const bots = await WhatsAppChatbotRepository.listByWorkspace(workspaceId)
    if (!bots.ok) return bots
    const since = new Date(Date.now() - STATS_WINDOW_DAYS * 86_400_000)
    const counts = await WhatsAppChatbotRepository.sessionCounts(
      workspaceId,
      since,
    )
    if (!counts.ok) return counts
    return ok(
      bots.value.map((bot) =>
        toWhatsAppChatbotListItemDTO(bot, statsFor(counts.value, bot.id)),
      ),
    )
  },

  async get(
    actorId: string,
    workspaceId: string,
    id: string,
  ): Promise<Result<WhatsAppChatbotDTO>> {
    const access = await assertModuleMember(
      actorId,
      workspaceId,
      'COMMUNICATION',
      { resource: 'conversations', action: 'VIEW' },
    )
    if (!access.ok) return access
    const bot = await loadOwned(workspaceId, id)
    if (!bot.ok) return bot
    return ok(toWhatsAppChatbotDTO(bot.value))
  },

  async create(
    actorId: string,
    workspaceId: string,
    dto: CreateWhatsAppChatbotDTO,
  ): Promise<Result<WhatsAppChatbotDTO>> {
    const access = await assertModulePrivileged(
      actorId,
      workspaceId,
      'COMMUNICATION',
    )
    if (!access.ok) return access

    if (dto.triggerKind === 'KEYWORD' && dto.keywords.length === 0) {
      return err(
        validationError('Informe ao menos uma palavra-chave para o gatilho'),
      )
    }
    if (dto.connectionId) {
      const connection = await WhatsAppConnectionRepository.findById(
        dto.connectionId,
        workspaceId,
      )
      if (!connection.ok) return connection
      if (!connection.value) return err(whatsappConnectionNotFound())
    }

    const count = await WhatsAppChatbotRepository.count(workspaceId)
    if (!count.ok) return count
    if (count.value >= WHATSAPP_CHATBOT_MAX_PER_WORKSPACE) {
      return err(
        whatsappChatbotLimitReached(WHATSAPP_CHATBOT_MAX_PER_WORKSPACE),
      )
    }

    const created = await WhatsAppChatbotRepository.create({
      workspaceId,
      name: dto.name,
      description: dto.description,
      triggerKind: dto.triggerKind,
      keywords: dto.keywords,
      connectionId: dto.connectionId ?? null,
      sessionTtlMinutes: dto.sessionTtlMinutes,
      draft: toJsonFlow(flowFromTemplate(dto.template)),
      createdByUserId: actorId,
    })
    if (!created.ok) {
      auditMutation({
        entity: 'whatsapp_chatbot',
        action: 'create',
        actorId,
        outcome: 'failure',
        reason: created.error.code,
      })
      return created
    }
    auditMutation({
      entity: 'whatsapp_chatbot',
      action: 'create',
      actorId,
      targetId: created.value.id,
      meta: { workspaceId, template: dto.template },
    })
    return ok(toWhatsAppChatbotDTO(created.value))
  },

  async update(
    actorId: string,
    workspaceId: string,
    id: string,
    dto: UpdateWhatsAppChatbotDTO,
  ): Promise<Result<WhatsAppChatbotDTO>> {
    const access = await assertModulePrivileged(
      actorId,
      workspaceId,
      'COMMUNICATION',
    )
    if (!access.ok) return access
    const existing = await loadOwned(workspaceId, id)
    if (!existing.ok) return existing

    const triggerKind = dto.triggerKind ?? existing.value.triggerKind
    const keywords = dto.keywords ?? existing.value.keywords
    if (triggerKind === 'KEYWORD' && keywords.length === 0) {
      return err(
        validationError('Informe ao menos uma palavra-chave para o gatilho'),
      )
    }
    if (dto.connectionId) {
      const connection = await WhatsAppConnectionRepository.findById(
        dto.connectionId,
        workspaceId,
      )
      if (!connection.ok) return connection
      if (!connection.value) return err(whatsappConnectionNotFound())
    }

    const { flow, ...fields } = dto
    const updated = await WhatsAppChatbotRepository.update(id, {
      ...fields,
      ...(flow ? { draft: toJsonFlow(flow) } : {}),
    })
    if (!updated.ok) return updated
    auditMutation({
      entity: 'whatsapp_chatbot',
      action: 'update',
      actorId,
      targetId: id,
      meta: { workspaceId, flowChanged: Boolean(flow) },
    })
    return ok(toWhatsAppChatbotDTO(updated.value))
  },

  /** Freezes the draft as the running flow; the bot goes ACTIVE if it was a draft. */
  async publish(
    actorId: string,
    workspaceId: string,
    id: string,
  ): Promise<Result<WhatsAppChatbotPublishDTO>> {
    const access = await assertModulePrivileged(
      actorId,
      workspaceId,
      'COMMUNICATION',
    )
    if (!access.ok) return access
    const existing = await loadOwned(workspaceId, id)
    if (!existing.ok) return existing

    const flow = parseStoredFlow(existing.value.draft)
    const structural = validateChatbotFlow(flow)
    const references = await referenceIssues(workspaceId, flow)
    if (!references.ok) return references
    const issues = [...structural, ...references.value]
    if (hasFlowErrors(issues)) {
      const first = issues.find((issue) => issue.severity === 'error')
      return err(
        whatsappChatbotInvalidFlow(
          first
            ? `O fluxo tem problemas: ${first.message}`
            : 'O fluxo tem problemas',
        ),
      )
    }

    const updated = await WhatsAppChatbotRepository.update(id, {
      published: toJsonFlow(flow),
      publishedVersion: { increment: 1 },
      publishedAt: new Date(),
      status: existing.value.status === 'PAUSED' ? 'PAUSED' : 'ACTIVE',
    })
    if (!updated.ok) return updated
    auditMutation({
      entity: 'whatsapp_chatbot',
      action: 'publish',
      actorId,
      targetId: id,
      meta: { workspaceId, version: updated.value.publishedVersion },
    })
    return ok({
      chatbot: toWhatsAppChatbotDTO(updated.value),
      issues: toIssueDTOs(issues),
    })
  },

  /** Checks the draft without publishing (the editor's "Verificar"). */
  async validate(
    actorId: string,
    workspaceId: string,
    id: string,
  ): Promise<Result<WhatsAppChatbotFlowIssueDTO[]>> {
    const access = await assertModulePrivileged(
      actorId,
      workspaceId,
      'COMMUNICATION',
    )
    if (!access.ok) return access
    const existing = await loadOwned(workspaceId, id)
    if (!existing.ok) return existing
    const flow = parseStoredFlow(existing.value.draft)
    const references = await referenceIssues(workspaceId, flow)
    if (!references.ok) return references
    return ok(toIssueDTOs([...validateChatbotFlow(flow), ...references.value]))
  },

  async setStatus(
    actorId: string,
    workspaceId: string,
    id: string,
    dto: SetWhatsAppChatbotStatusDTO,
  ): Promise<Result<WhatsAppChatbotDTO>> {
    const access = await assertModulePrivileged(
      actorId,
      workspaceId,
      'COMMUNICATION',
    )
    if (!access.ok) return access
    const existing = await loadOwned(workspaceId, id)
    if (!existing.ok) return existing
    if (dto.status === 'ACTIVE' && existing.value.publishedVersion === 0) {
      return err(whatsappChatbotNotPublished())
    }

    const updated = await WhatsAppChatbotRepository.setStatus(id, dto.status)
    if (!updated.ok) return updated
    auditMutation({
      entity: 'whatsapp_chatbot',
      action: dto.status === 'ACTIVE' ? 'activate' : 'pause',
      actorId,
      targetId: id,
      meta: { workspaceId, status: dto.status },
    })
    return ok(toWhatsAppChatbotDTO(updated.value))
  },

  async remove(
    actorId: string,
    workspaceId: string,
    id: string,
  ): Promise<Result<void>> {
    const access = await assertModulePrivileged(
      actorId,
      workspaceId,
      'COMMUNICATION',
    )
    if (!access.ok) return access
    const existing = await loadOwned(workspaceId, id)
    if (!existing.ok) return existing

    const deleted = await WhatsAppChatbotRepository.delete(id)
    if (!deleted.ok) return deleted
    auditMutation({
      entity: 'whatsapp_chatbot',
      action: 'delete',
      actorId,
      targetId: id,
      meta: { workspaceId },
    })
    return ok(undefined)
  },

  /**
   * One step of a dry run over the **draft**: nothing is sent and the
   * integration nodes get an empty successful answer.
   */
  async simulate(
    actorId: string,
    workspaceId: string,
    id: string,
    dto: SimulateWhatsAppChatbotDTO,
  ): Promise<Result<WhatsAppChatbotSimulationDTO>> {
    const access = await assertModulePrivileged(
      actorId,
      workspaceId,
      'COMMUNICATION',
    )
    if (!access.ok) return access
    const existing = await loadOwned(workspaceId, id)
    if (!existing.ok) return existing

    const flow = parseStoredFlow(existing.value.draft)
    const ctx: ChatbotContext = {
      contact: {
        name: dto.contactName ?? 'Cliente',
        phone: dto.contactPhone ?? '5511999999999',
      },
      callWebhook: async () => ({ ok: true, json: {} }),
    }
    const input = dto.input ?? ''
    const state =
      dto.state === undefined || dto.state === null
        ? initialChatbotState()
        : parseChatbotState(dto.state)
    const run = state.started
      ? await resumeFlow(
          flow,
          state,
          input.startsWith('bot:')
            ? { text: '', buttonPayload: input }
            : { text: input },
          ctx,
        )
      : await startFlow(flow, ctx, { text: input })
    return ok({
      state: run.state,
      outputs: run.outputs,
      status: run.status,
      handoff: run.handoff ?? null,
      closeConversation: run.closeConversation ?? false,
    })
  },

  /**
   * Entries and exits per block over the last 30 days (UTC calendar days,
   * today included), for the numbers drawn on the editor canvas.
   */
  async nodeStats(
    actorId: string,
    workspaceId: string,
    id: string,
  ): Promise<Result<WhatsAppChatbotNodeStatsDTO>> {
    const access = await assertModuleMember(
      actorId,
      workspaceId,
      'COMMUNICATION',
      { resource: 'conversations', action: 'VIEW' },
    )
    if (!access.ok) return access
    const existing = await loadOwned(workspaceId, id)
    if (!existing.ok) return existing

    const today = new Date()
    const since = new Date(
      Date.UTC(
        today.getUTCFullYear(),
        today.getUTCMonth(),
        today.getUTCDate() - (STATS_WINDOW_DAYS - 1),
      ),
    )
    const totals = await WhatsAppChatbotNodeStatRepository.totalsSince(
      workspaceId,
      id,
      since,
    )
    if (!totals.ok) return totals
    return ok({
      days: STATS_WINDOW_DAYS,
      nodes: totals.value.filter((row) => row.entries > 0 || row.exits > 0),
    })
  },

  async sessions(
    actorId: string,
    workspaceId: string,
    id: string,
    query: ListWhatsAppChatbotSessionsDTO,
  ): Promise<Result<WhatsAppChatbotSessionDTO[]>> {
    const access = await assertModuleMember(
      actorId,
      workspaceId,
      'COMMUNICATION',
      { resource: 'conversations', action: 'VIEW' },
    )
    if (!access.ok) return access
    const existing = await loadOwned(workspaceId, id)
    if (!existing.ok) return existing

    const sessions = await WhatsAppChatbotSessionRepository.listByChatbot({
      workspaceId,
      chatbotId: id,
      status: query.status,
      limit: query.limit,
    })
    if (!sessions.ok) return sessions
    return ok(sessions.value.map(toWhatsAppChatbotSessionDTO))
  },
}
