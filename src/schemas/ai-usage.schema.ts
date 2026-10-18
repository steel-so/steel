import { z } from 'zod'
import {
  AI_USAGE_PERIOD_PRESETS,
  daysBetween,
  MAX_AI_USAGE_RANGE_DAYS,
  parseUtcDay,
} from '@/src/lib/ai/usage-period'

export const AI_USAGE_SCOPES = ['personal', 'workspace'] as const

/** CSV views: raw ledger rows or one of the aggregated breakdowns. */
export const AI_USAGE_EXPORT_VIEWS = [
  'rows',
  'model',
  'feature',
  'module',
  'user',
] as const
export type AiUsageExportView = (typeof AI_USAGE_EXPORT_VIEWS)[number]

const UtcDay = z
  .string()
  .refine((value) => parseUtcDay(value) !== null, {
    message: 'Use uma data válida no formato AAAA-MM-DD',
  })
  .meta({ description: 'Dia em UTC (`AAAA-MM-DD`).', example: '2026-10-01' })

export const periodFields = {
  scope: z.enum(AI_USAGE_SCOPES).default('personal').meta({
    description:
      '`personal` = só o consumo do usuário; `workspace` = todo o espaço de trabalho (OWNER/ADMIN).',
  }),
  period: z.enum(AI_USAGE_PERIOD_PRESETS).default('this_month').meta({
    description:
      'Período em dias UTC. `custom` exige `from` e `to` (inclusivos, até 366 dias).',
  }),
  from: UtcDay.optional(),
  to: UtcDay.optional(),
}

type PeriodInput = {
  period: (typeof AI_USAGE_PERIOD_PRESETS)[number]
  from?: string
  to?: string
}

export function checkCustomRange(
  value: PeriodInput,
  ctx: z.RefinementCtx,
): void {
  if (value.period !== 'custom') return
  const from = value.from ? parseUtcDay(value.from) : null
  const to = value.to ? parseUtcDay(value.to) : null
  if (!from || !to) {
    ctx.addIssue({
      code: 'custom',
      path: [from ? 'to' : 'from'],
      message: 'Informe o início e o fim do período personalizado',
    })
    return
  }
  if (from > to) {
    ctx.addIssue({
      code: 'custom',
      path: ['to'],
      message: 'O fim do período precisa ser igual ou posterior ao início',
    })
    return
  }
  if (daysBetween(from, to) + 1 > MAX_AI_USAGE_RANGE_DAYS) {
    ctx.addIssue({
      code: 'custom',
      path: ['to'],
      message: `O período pode ter no máximo ${MAX_AI_USAGE_RANGE_DAYS} dias`,
    })
  }
}

/** `GET /ai/usage/analytics` query. */
export const AiUsageAnalyticsQuerySchema = z
  .object(periodFields)
  .superRefine(checkCustomRange)

export type AiUsageAnalyticsQuery = z.infer<typeof AiUsageAnalyticsQuerySchema>

/** `GET /ai/usage/export` query. */
export const AiUsageExportQuerySchema = z
  .object({
    ...periodFields,
    view: z.enum(AI_USAGE_EXPORT_VIEWS).default('rows').meta({
      description:
        '`rows` = uma linha por chamada (data, usuário, recurso, modelo, escopo, tokens e custo); `model` / `feature` / `module` / `user` = totais agregados. `user` só no escopo `workspace`.',
    }),
  })
  .superRefine(checkCustomRange)

export type AiUsageExportQuery = z.infer<typeof AiUsageExportQuerySchema>
