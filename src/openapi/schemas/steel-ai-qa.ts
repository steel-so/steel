import { z } from 'zod'
import { dto } from '../common'

/**
 * DTOs do QA automático por IA (`types/qa-review.d.ts`, T2). Mantenha
 * alinhados a `src/mappers/qa-review.mapper.ts`.
 */

const dateTime = () => z.iso.datetime()
const scope = z.enum(['BOTH', 'CONVERSATION', 'TICKET']).meta({
  description: 'Onde o critério vale: nos dois, só no zap ou só nos chamados.',
})

export const QaCriterionDTO = dto(
  'QaCriterion',
  z.object({
    key: z.string().meta({ description: 'Identificador estável do critério.' }),
    name: z.string(),
    description: z.string().meta({
      description: 'O que o avaliador deve procurar; vai no prompt da IA.',
    }),
    weight: z.number().int().min(1).max(10).meta({
      description: 'Peso relativo na média ponderada da nota final.',
    }),
    appliesTo: scope,
    active: z.boolean(),
    position: z.number().int(),
  }),
)

export const QaConfigDTO = dto(
  'QaConfig',
  z.object({
    enabled: z.boolean().meta({
      description: 'Desligado por padrão: nada é avaliado até ligar.',
    }),
    reviewConversations: z.boolean(),
    reviewTickets: z.boolean(),
    includeBots: z.boolean().meta({
      description: 'Também avalia atendimentos feitos só pelo bot ou pela IA.',
    }),
    minMessages: z.number().int().meta({
      description:
        'Atendimentos com menos mensagens que isto não são avaliados.',
    }),
    lowScoreThreshold: z.number().int().meta({
      description: 'Notas abaixo deste valor (0–100) avisam os gestores.',
    }),
    alertLowScore: z.boolean(),
    criteria: z.array(QaCriterionDTO),
  }),
)

const CriterionResult = z.object({
  key: z.string(),
  name: z.string(),
  weight: z.number().int(),
  score: z.number().int().min(0).max(100),
  evidence: z
    .string()
    .meta({ description: 'Trecho curto que justifica a nota.' }),
})

export const QaReviewDTO = dto(
  'QaReview',
  z.object({
    id: z.string(),
    subjectType: z.enum(['CONVERSATION', 'TICKET']),
    conversationId: z.string().nullable(),
    ticketId: z.string().nullable(),
    subjectLabel: z.string().nullable(),
    status: z
      .enum(['PENDING', 'COMPLETED', 'SKIPPED', 'FAILED'])
      .meta({ description: '`SKIPPED` traz o motivo em `skipReason`.' }),
    handlerKind: z.enum(['HUMAN', 'BOT', 'MIXED']).nullable(),
    agentUserId: z.string().nullable(),
    agentName: z.string().nullable(),
    customerName: z.string().nullable(),
    score: z
      .number()
      .int()
      .min(0)
      .max(100)
      .nullable()
      .meta({ description: 'Média ponderada dos critérios.' }),
    summary: z.string().nullable(),
    criteriaResults: z.array(CriterionResult),
    coachingTips: z.array(z.string()),
    lowScore: z.boolean(),
    skipReason: z.string().nullable().meta({
      description:
        'Por que não foi avaliado ou falhou: `disabled`, `too_short`, `no_attendant_reply`, `bots_excluded`, `no_criteria`, `ai_quota_exceeded`, `ai_provider_unavailable`, `provider_failed`, `unparseable_response`…',
    }),
    subjectEndedAt: dateTime().nullable(),
    reviewedAt: dateTime().nullable(),
    createdAt: dateTime(),
  }),
)

export const QaReviewListDTO = dto(
  'QaReviewList',
  z.object({
    items: z.array(QaReviewDTO),
    nextCursor: z.string().nullable(),
  }),
)

const CoachingCriterion = z.object({
  key: z.string(),
  name: z.string(),
  average: z.number().int(),
})

export const QaCoachingDTO = dto(
  'QaCoaching',
  z.object({
    from: dateTime(),
    to: dateTime(),
    reviews: z.number().int(),
    averageScore: z.number().int().nullable(),
    lowScoreCount: z.number().int(),
    humanAverage: z.number().int().nullable(),
    botAverage: z.number().int().nullable(),
    agents: z.array(
      z.object({
        agentUserId: z.string().nullable().meta({
          description: 'Nulo = atendimentos sem responsável humano (só bot).',
        }),
        agentName: z.string(),
        reviews: z.number().int(),
        averageScore: z.number().int(),
        lowScoreCount: z.number().int(),
        byCriterion: z.array(CoachingCriterion),
        weakestCriterion: CoachingCriterion.nullable(),
        trend: z.array(
          z.object({
            weekStart: dateTime().meta({
              description: 'Segunda-feira (UTC) que abre a semana.',
            }),
            average: z.number().int(),
            reviews: z.number().int(),
          }),
        ),
        topTips: z.array(
          z.object({ tip: z.string(), count: z.number().int() }),
        ),
        lowest: z.array(QaReviewDTO),
      }),
    ),
  }),
)
