import { z } from 'zod'
import { AI_INSIGHT_MODULES } from '@/src/lib/ai/proactive/labels'

/** Proactive AI (ADR 0040): insights feed, actions and digest settings. */

export const AI_INSIGHT_STATES = ['active', 'snoozed', 'dismissed'] as const
export const AI_INSIGHT_DEFAULT_LIMIT = 20
export const AI_INSIGHT_MAX_LIMIT = 50
/** Longest snooze: one week. */
export const AI_INSIGHT_MAX_SNOOZE_HOURS = 168

export const ListAiInsightsQuerySchema = z.object({
  state: z.enum(AI_INSIGHT_STATES).default('active'),
  module: z.enum(AI_INSIGHT_MODULES).optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(AI_INSIGHT_MAX_LIMIT)
    .default(AI_INSIGHT_DEFAULT_LIMIT),
})

export type ListAiInsightsQueryDTO = z.infer<typeof ListAiInsightsQuerySchema>

export const UpdateAiInsightSchema = z.discriminatedUnion('action', [
  /** Hide while the condition lasts (a recurrence shows it again). */
  z.object({ action: z.literal('dismiss') }),
  /** Hide for `hours` (1 h to 7 days). */
  z.object({
    action: z.literal('snooze'),
    hours: z.number().int().min(1).max(AI_INSIGHT_MAX_SNOOZE_HOURS),
  }),
  /** Undo a dismissal or a snooze. */
  z.object({ action: z.literal('restore') }),
])

export type UpdateAiInsightDTO = z.infer<typeof UpdateAiInsightSchema>

export const UpdateAiDigestSettingsSchema = z
  .object({
    inApp: z.boolean().optional(),
    email: z.boolean().optional(),
  })
  .refine((value) => value.inApp !== undefined || value.email !== undefined, {
    message: 'Informe ao menos um canal',
  })

export type UpdateAiDigestSettingsDTO = z.infer<
  typeof UpdateAiDigestSettingsSchema
>

/** `ws_insights` tool arguments. */
export const WsInsightsToolArgsSchema = z
  .object({
    module: z.enum(AI_INSIGHT_MODULES).optional(),
    limit: z.number().int().min(1).max(AI_INSIGHT_DEFAULT_LIMIT).optional(),
  })
  .strict()

export type WsInsightsToolArgsDTO = z.infer<typeof WsInsightsToolArgsSchema>
