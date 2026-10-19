import { z } from 'zod'
import {
  AI_INSIGHT_KINDS,
  AI_INSIGHT_MODULES,
} from '@/src/lib/ai/proactive/labels'
import { AI_INSIGHT_STATES } from '@/src/schemas/ai-insight.schema'
import { dto } from '../common'

/** DTOs da IA proativa (`types/ai-insight.d.ts`, ADR 0040). */

export const AiInsightDTO = dto(
  'AiInsight',
  z
    .object({
      id: z.string(),
      kind: z
        .enum(AI_INSIGHT_KINDS)
        .meta({ example: 'SD_SLA_BREACH_FORECAST' }),
      module: z.enum(AI_INSIGHT_MODULES),
      severity: z.enum(['INFO', 'WARNING', 'CRITICAL']),
      title: z
        .string()
        .meta({ example: 'A fila de N1 deve estourar o SLA às 15:00' }),
      body: z.string().meta({
        example:
          '3 chamados com previsão de estouro até 17:30, 1 sem responsável. O primeiro é INC-000123: Servidor de e-mail fora do ar.',
      }),
      facts: z
        .array(z.object({ label: z.string(), value: z.string() }))
        .meta({ description: 'Os números que dispararam o alerta.' }),
      href: z
        .string()
        .nullable()
        .meta({ description: 'Link interno do app (já com o slug).' }),
      prompt: z.string().nullable().meta({
        description: 'Pergunta pronta para abrir no Steel AI (`/ai?prompt=`).',
      }),
      state: z.enum(AI_INSIGHT_STATES),
      snoozedUntil: z.iso.datetime().nullable(),
      firstSeenAt: z.iso.datetime(),
      lastSeenAt: z.iso.datetime(),
    })
    .meta({
      description:
        'Alerta calculado por regra (sem LLM) a partir dos dados do módulo, só para a própria pessoa.',
    }),
)

export const AiInsightFeedDTO = dto(
  'AiInsightFeed',
  z.object({
    enabled: z.boolean().meta({
      description:
        '`false` com o Steel AI ou a IA proativa desligados no workspace (lista vazia).',
    }),
    items: z.array(AiInsightDTO),
    counts: z.object({
      active: z.number().int(),
      snoozed: z.number().int(),
      dismissed: z.number().int(),
    }),
  }),
)

export const AiDigestSettingsDTO = dto(
  'AiDigestSettings',
  z.object({
    inApp: z.boolean(),
    email: z.boolean(),
    workspaceEnabled: z.boolean().meta({
      description: '`false` quando o workspace desligou a IA proativa.',
    }),
  }),
)
