import { z } from 'zod'
import { ok } from '@/src/lib/result'
import { WhatsAppConversationService } from '@/src/services/whatsapp-conversation.service'
import type { SteelAiTool } from '../types'
import {
  idSchema,
  NEGATIVE_SENTIMENT_THRESHOLD,
  zapBasePath,
  zodParser,
} from './shared'

/**
 * Live service counters computed from the conversations the caller can see.
 * The domain does not record first-response times, so that metric is
 * reported as unavailable instead of being guessed.
 */

const DAY_MS = 24 * 60 * 60 * 1000

const DashboardArgs = z.object({
  connectionId: idSchema.optional(),
  closedWindowDays: z.coerce.number().int().min(1).max(90).default(7),
})
type DashboardArgs = z.infer<typeof DashboardArgs>

export const zapDashboardTool: SteelAiTool<DashboardArgs> = {
  name: 'zap_dashboard',
  label: 'Calculando indicadores do WhatsApp',
  module: 'COMMUNICATION',
  kind: 'READ',
  description:
    'Indicadores do atendimento por WhatsApp agora: conversas abertas (novas, em atendimento), com/sem responsável, não lidas, sob IA, com sentimento negativo, abertas por atendente e encerradas nos últimos `closedWindowDays` dias (padrão 7). `connectionId` restringe a uma conexão. Tempo de primeira resposta não é registrado pelo módulo.',
  parameters: {
    type: 'object',
    properties: {
      connectionId: {
        type: 'string',
        description: 'Id da conexão (de zap_connections_status).',
      },
      closedWindowDays: { type: 'integer', minimum: 1, maximum: 90 },
    },
    additionalProperties: false,
  },
  permission: { resource: 'conversations', action: 'VIEW' },
  parse: zodParser(DashboardArgs),
  async execute(ctx, args) {
    const filters = { connectionId: args.connectionId }
    const [open, closed, members, base] = await Promise.all([
      WhatsAppConversationService.list(ctx.actorId, ctx.workspaceId, {
        ...filters,
        status: 'OPEN',
      }),
      WhatsAppConversationService.list(ctx.actorId, ctx.workspaceId, {
        ...filters,
        status: 'CLOSED',
      }),
      WhatsAppConversationService.listAssignableMembers(
        ctx.actorId,
        ctx.workspaceId,
      ),
      zapBasePath(ctx.workspaceId),
    ])
    if (!open.ok) return open
    if (!closed.ok) return closed
    if (!members.ok) return members
    if (!base.ok) return base

    const names = new Map(members.value.map((m) => [m.id, m.name]))
    const byAgent = new Map<string, number>()
    for (const c of open.value) {
      if (c.assignedUserId) {
        byAgent.set(c.assignedUserId, (byAgent.get(c.assignedUserId) ?? 0) + 1)
      }
    }
    const since = Date.now() - args.closedWindowDays * DAY_MS
    const closedRecently = closed.value.filter(
      (c) => c.closedAt && new Date(c.closedAt).getTime() >= since,
    ).length

    const assigned = open.value.filter((c) => c.assignedUserId).length
    const data = {
      open: open.value.length,
      new: open.value.filter((c) => c.status === 'NEW').length,
      inProgress: open.value.filter((c) => c.status === 'IN_PROGRESS').length,
      assigned,
      unassigned: open.value.length - assigned,
      unread: open.value.filter((c) => c.unreadCount > 0).length,
      handledByAi: open.value.filter((c) => c.aiActive).length,
      negativeSentiment: open.value.filter(
        (c) =>
          c.avgSentimentScore !== null &&
          c.avgSentimentScore <= NEGATIVE_SENTIMENT_THRESHOLD,
      ).length,
      closedRecently,
      closedWindowDays: args.closedWindowDays,
      byAgent: [...byAgent.entries()]
        .map(([userId, count]) => ({
          userId,
          name: names.get(userId) ?? 'Membro removido',
          open: count,
        }))
        .sort((a, b) => b.open - a.open),
      avgFirstResponseMinutes: null,
      note: 'Tempo médio de primeira resposta indisponível: o módulo não registra esse dado.',
      href: base.value,
    }
    return ok({
      data,
      summary: `${data.open} aberta(s): ${data.unassigned} sem responsável, ${data.unread} não lida(s)`,
    })
  },
}
