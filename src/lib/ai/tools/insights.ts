import type { z } from 'zod'
import { validationError } from '@/src/errors/app-error'
import {
  AI_INSIGHT_MODULE_LABELS,
  AI_INSIGHT_SEVERITY_LABELS,
} from '@/src/lib/ai/proactive/labels'
import { ok, type Result } from '@/src/lib/result'
import {
  AI_INSIGHT_DEFAULT_LIMIT,
  WsInsightsToolArgsSchema,
} from '@/src/schemas/ai-insight.schema'
import { AiInsightService } from '@/src/services/ai-insight.service'
import type { AnySteelAiTool, SteelAiTool } from './types'

/**
 * `ws_insights` (ADR 0040): the proactive AI's active insights of the
 * caller — "o que precisa da minha atenção?" — for the assistant, Steel
 * Agents (as their owner) and MCP clients. READ, platform-level: the
 * service filters by module access exactly like the feed.
 */

type Args = z.infer<typeof WsInsightsToolArgsSchema>

const DEFAULT_LIMIT = 10

function parse(args: Record<string, unknown>): Result<Args> {
  const parsed = WsInsightsToolArgsSchema.safeParse(args ?? {})
  if (parsed.success) return ok(parsed.data)
  return {
    ok: false,
    error: validationError(
      'Argumentos inválidos para a ferramenta',
      parsed.error.issues,
    ),
  }
}

export const wsInsightsTool: SteelAiTool<Args> = {
  name: 'ws_insights',
  label: 'Consultando alertas da IA',
  module: null,
  kind: 'READ',
  description:
    'Lista os alertas ativos da IA proativa para o usuário: chamados que devem estourar o SLA nas próximas horas, oportunidades sem contato, etapa do funil travada, previsão do mês abaixo da meta, conversas do WhatsApp aguardando atendente e clientes com sentimento em queda. Cada alerta é calculado por regra a partir dos dados do workspace e traz `title`, `body` com os números, `facts`, `severity` (Urgente, Atenção, Informativo), `module` e `href`. Use quando perguntarem o que precisa de atenção, o que está atrasado ou por onde começar o dia; cite os números exatamente como vieram e o link em Markdown. Lista vazia quer dizer que não há alerta agora (ou que a IA proativa está desligada no workspace, indicado em `enabled`).',
  parameters: {
    type: 'object',
    properties: {
      module: {
        type: 'string',
        enum: ['SERVICE_DESK', 'CRM', 'COMMUNICATION'],
        description: 'Só os alertas de um módulo (opcional).',
      },
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: AI_INSIGHT_DEFAULT_LIMIT,
        description: `Quantidade máxima de alertas (padrão ${DEFAULT_LIMIT}, máximo ${AI_INSIGHT_DEFAULT_LIMIT}).`,
      },
    },
    additionalProperties: false,
  },
  parse,
  async execute(ctx, args) {
    const result = await AiInsightService.list(ctx.actorId, ctx.workspaceId, {
      state: 'active',
      module: args.module,
      limit: args.limit ?? DEFAULT_LIMIT,
    })
    if (!result.ok) return result
    const insights = result.value.items.map((insight) => ({
      module: AI_INSIGHT_MODULE_LABELS[insight.module],
      severity: AI_INSIGHT_SEVERITY_LABELS[insight.severity],
      title: insight.title,
      body: insight.body,
      facts: insight.facts,
      href: insight.href,
    }))
    return ok({
      data: {
        enabled: result.value.enabled,
        total: result.value.counts.active,
        insights,
      },
      summary: !result.value.enabled
        ? 'IA proativa desligada no workspace'
        : insights.length === 0
          ? 'Nenhum alerta ativo'
          : `${result.value.counts.active} alerta(s) ativo(s)`,
    })
  },
}

export const INSIGHT_AI_TOOLS: AnySteelAiTool[] = [wsInsightsTool]
