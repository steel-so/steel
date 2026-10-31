import { z } from 'zod'

export const QaCriterionInputSchema = z.object({
  key: z
    .string()
    .regex(
      /^[a-z0-9][a-z0-9_-]{1,39}$/,
      'Use letras minúsculas, números, - ou _',
    ),
  name: z.string().trim().min(2).max(60),
  description: z.string().trim().min(5).max(500),
  weight: z.number().int().min(1).max(10).default(1),
  appliesTo: z.enum(['BOTH', 'CONVERSATION', 'TICKET']).default('BOTH'),
  active: z.boolean().default(true),
})

export const UpdateQaConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    reviewConversations: z.boolean().optional(),
    reviewTickets: z.boolean().optional(),
    includeBots: z.boolean().optional(),
    minMessages: z.number().int().min(1).max(50).optional(),
    lowScoreThreshold: z.number().int().min(1).max(100).optional(),
    alertLowScore: z.boolean().optional(),
    criteria: z.array(QaCriterionInputSchema).min(1).max(12).optional(),
  })
  .refine(
    (value) =>
      !value.criteria ||
      new Set(value.criteria.map((c) => c.key)).size === value.criteria.length,
    { message: 'Chaves de critério repetidas', path: ['criteria'] },
  )
  .refine((value) => !value.criteria || value.criteria.some((c) => c.active), {
    message: 'Mantenha ao menos um critério ativo',
    path: ['criteria'],
  })

export const QaReviewListQuerySchema = z.object({
  subjectType: z.enum(['CONVERSATION', 'TICKET']).optional(),
  status: z.enum(['PENDING', 'COMPLETED', 'SKIPPED', 'FAILED']).optional(),
  handlerKind: z.enum(['HUMAN', 'BOT', 'MIXED']).optional(),
  agentUserId: z.string().min(1).optional(),
  lowOnly: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
})

export const QaCoachingQuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  agentUserId: z.string().min(1).optional(),
})

export const CreateQaReviewSchema = z.object({
  subjectType: z.enum(['CONVERSATION', 'TICKET']),
  subjectId: z.string().min(1),
})

export type QaCriterionInputDTO = z.infer<typeof QaCriterionInputSchema>
export type UpdateQaConfigDTO = z.infer<typeof UpdateQaConfigSchema>
export type QaReviewListQueryDTO = z.infer<typeof QaReviewListQuerySchema>
export type QaCoachingQueryDTO = z.infer<typeof QaCoachingQuerySchema>
export type CreateQaReviewDTO = z.infer<typeof CreateQaReviewSchema>
