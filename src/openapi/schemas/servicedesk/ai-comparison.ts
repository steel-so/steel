import { z } from 'zod'
import { dto } from '../../common'

/** DTOs do painel "IA vs. técnico" (`types/sd-ai-comparison.d.ts`). */

const Field = z.enum([
  'category',
  'subcategory',
  'service',
  'impact',
  'urgency',
  'priority',
  'department',
  'tags',
])

const percent = () =>
  z.number().int().nullable().meta({
    description: 'Percentual inteiro; `null` sem amostra.',
    example: 82,
  })

const FieldStat = z.object({
  field: Field,
  label: z.string().meta({ example: 'Categoria' }),
  compared: z.number().int(),
  matched: z.number().int(),
  corrected: z
    .number()
    .int()
    .meta({ description: 'A IA preencheu e o técnico trocou depois.' }),
  accuracy: percent(),
})

const CalibrationBucket = z.object({
  band: z.enum(['LOW', 'MEDIUM', 'HIGH']),
  label: z.string(),
  tickets: z.number().int(),
  accuracy: percent(),
})

const TextStat = z.object({
  kind: z.enum(['REPLY', 'SOLUTION']),
  label: z.string(),
  total: z.number().int(),
  adopted: z.number().int(),
  edited: z.number().int(),
  notUsed: z.number().int(),
  pending: z.number().int(),
  usageRate: percent(),
})

const AgentStat = z.object({
  userId: z.string(),
  name: z.string(),
  suggestions: z.number().int(),
  used: z.number().int(),
  usageRate: percent(),
})

const Divergence = z.object({
  ticketId: z.string(),
  code: z.string().meta({ example: 'INC-000123' }),
  title: z.string(),
  field: Field,
  fieldLabel: z.string(),
  suggested: z.string(),
  final: z.string(),
  appliedByAi: z.boolean(),
  at: z.iso.datetime(),
})

export const SdAiComparisonDTO = dto(
  'SdAiComparison',
  z.object({
    periodDays: z.number().int().meta({ example: 30 }),
    from: z.iso.datetime(),
    to: z.iso.datetime(),
    summary: z.object({
      triaged: z.number().int(),
      settled: z.number().int(),
      awaitingReview: z.number().int(),
      accuracy: percent(),
      corrections: z.number().int(),
      avgConfidence: percent(),
    }),
    fields: z.array(FieldStat),
    calibration: z.array(CalibrationBucket),
    texts: z.array(TextStat),
    agents: z.array(AgentStat),
    preService: z.object({
      conversations: z.number().int(),
      resolvedByKb: z.number().int(),
      ticketOpened: z.number().int(),
      abandoned: z.number().int(),
      open: z.number().int(),
      deflectionRate: percent(),
    }),
    usage: z.object({
      calls: z.number().int(),
      costUsd: z.number(),
      costPerUsedUsd: z.number().nullable(),
      features: z.array(
        z.object({
          feature: z.string().meta({ example: 'SERVICEDESK_TRIAGE' }),
          label: z.string(),
          calls: z.number().int(),
          costUsd: z.number(),
        }),
      ),
    }),
    divergences: z.array(Divergence),
  }),
)
