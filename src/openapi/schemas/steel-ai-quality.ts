import { z } from 'zod'
import {
  AI_EVAL_RUN_REASONS,
  AI_EVAL_TARGETS,
  AI_FEEDBACK_RATINGS,
  AI_FEEDBACK_REASONS,
  AI_FEEDBACK_SURFACES,
} from '@/src/lib/ai/quality-labels'
import { dto } from '../common'

/** DTOs da qualidade do Steel AI (`types/ai-quality.d.ts`, ADR 0039). */

const dateTime = () => z.iso.datetime()
const rate = () =>
  z
    .number()
    .nullable()
    .meta({ description: 'Fração de 0 a 1; `null` sem base.' })

export const AiFeedbackDTO = dto(
  'AiFeedbackDTO',
  z.object({
    id: z.string(),
    surface: z.enum(AI_FEEDBACK_SURFACES),
    targetId: z.string(),
    variant: z.string(),
    rating: z.enum(AI_FEEDBACK_RATINGS),
    reason: z.enum(AI_FEEDBACK_REASONS).nullable(),
    comment: z.string().nullable(),
    modelKey: z
      .string()
      .nullable()
      .meta({
        description: 'Modelo que deu a resposta (`<provedor>:<modelo>`).',
      }),
    createdAt: dateTime(),
    updatedAt: dateTime(),
  }),
)

const Totals = {
  up: z.number().int(),
  down: z.number().int(),
  total: z.number().int(),
  approvalRate: rate(),
}

const Breakdown = z.object({ key: z.string(), label: z.string(), ...Totals })

const Resolution = z.object({
  handled: z
    .number()
    .int()
    .meta({ description: 'Atendimentos da IA no período.' }),
  resolved: z.number().int().meta({ description: 'Resolvidos sem humano.' }),
  rate: rate(),
  costUsd: z.number(),
  costPerResolutionUsd: z.number().nullable(),
})

const Link = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('chat'), conversationId: z.string() }),
  z.object({
    kind: z.literal('agent_run'),
    agentId: z.string(),
    runId: z.string(),
  }),
  z.object({ kind: z.literal('ticket'), ticketNumber: z.number().int() }),
  z.object({ kind: z.literal('kb_article'), articleId: z.string() }),
  z.object({ kind: z.literal('whatsapp'), conversationId: z.string() }),
])

export const AiQualityDTO = dto(
  'AiQualityDTO',
  z.object({
    scope: z.enum(['personal', 'workspace']),
    period: z.string(),
    from: dateTime(),
    to: dateTime().meta({ description: 'Fim exclusivo (00:00 UTC).' }),
    canViewWorkspace: z.boolean(),
    totals: z.object(Totals),
    bySurface: z.array(Breakdown),
    byModel: z.array(Breakdown),
    daily: z.array(
      z.object({
        date: z.string().meta({ description: 'Dia em UTC (`AAAA-MM-DD`).' }),
        up: z.number().int(),
        down: z.number().int(),
        approvalRate: rate(),
      }),
    ),
    resolution: z
      .object({
        whatsapp: Resolution,
        servicedesk: Resolution,
        total: Resolution,
      })
      .nullable()
      .meta({ description: 'Só no escopo `workspace`.' }),
    worst: z.array(
      z.object({
        id: z.string(),
        surface: z.enum(AI_FEEDBACK_SURFACES),
        surfaceLabel: z.string(),
        variant: z.string(),
        reason: z.enum(AI_FEEDBACK_REASONS).nullable(),
        reasonLabel: z.string().nullable(),
        comment: z.string().nullable(),
        modelKey: z.string().nullable(),
        modelLabel: z.string().nullable(),
        userName: z
          .string()
          .nullable()
          .meta({ description: 'Quem avaliou (só no escopo `workspace`).' }),
        createdAt: dateTime(),
        link: Link.nullable(),
      }),
    ),
  }),
)

export const AiEvalCaseDTO = dto(
  'AiEvalCaseDTO',
  z.object({
    id: z.string(),
    input: z.string(),
    expected: z.string().nullable(),
    criteria: z.string().nullable(),
    mustContain: z.array(z.string()),
    mustNotContain: z.array(z.string()),
    sourceMessageId: z.string().nullable(),
    position: z.number().int(),
    createdAt: dateTime(),
    updatedAt: dateTime(),
  }),
)

export const AiEvalRunDTO = dto(
  'AiEvalRunDTO',
  z.object({
    id: z.string(),
    setId: z.string(),
    status: z.enum(['QUEUED', 'RUNNING', 'DONE', 'FAILED']),
    modelKey: z.string().nullable(),
    modelLabel: z.string().nullable(),
    judgeModelKey: z.string().nullable(),
    skillId: z.string().nullable(),
    hasPromptOverride: z.boolean(),
    reason: z.enum(AI_EVAL_RUN_REASONS),
    startedBy: z.object({ id: z.string(), name: z.string() }).nullable(),
    caseCount: z.number().int(),
    passedCount: z.number().int(),
    failedCount: z.number().int(),
    passRate: rate(),
    avgScore: z.number().nullable(),
    costUsd: z.number(),
    error: z.string().nullable(),
    startedAt: dateTime().nullable(),
    finishedAt: dateTime().nullable(),
    createdAt: dateTime(),
  }),
)

export const AiEvalRunDetailDTO = dto(
  'AiEvalRunDetailDTO',
  AiEvalRunDTO.extend({
    results: z.array(
      z.object({
        id: z.string(),
        caseId: z.string().nullable(),
        input: z.string(),
        output: z.string(),
        passed: z.boolean(),
        checksPassed: z.boolean(),
        failedChecks: z.array(z.string()),
        judgeScore: z.number().nullable(),
        judgePassed: z.boolean().nullable(),
        judgeRationale: z.string().nullable(),
        costUsd: z.number(),
        error: z.string().nullable(),
      }),
    ),
  }),
)

export const AiEvalSetDTO = dto(
  'AiEvalSetDTO',
  z.object({
    id: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    target: z.enum(AI_EVAL_TARGETS),
    targetLabel: z.string(),
    skillId: z.string().nullable(),
    caseCount: z.number().int(),
    lastRun: AiEvalRunDTO.nullable(),
    createdAt: dateTime(),
    updatedAt: dateTime(),
  }),
)

export const AiEvalSetDetailDTO = dto(
  'AiEvalSetDetailDTO',
  AiEvalSetDTO.extend({ cases: z.array(AiEvalCaseDTO) }),
)
