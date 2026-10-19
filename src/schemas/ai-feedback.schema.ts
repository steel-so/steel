import { z } from 'zod'
import {
  AI_FEEDBACK_RATINGS,
  AI_FEEDBACK_REASONS,
  AI_FEEDBACK_SURFACES,
  SD_COPILOT_VARIANTS,
} from '@/src/lib/ai/quality-labels'
import { checkCustomRange, periodFields } from './ai-usage.schema'

export const AI_FEEDBACK_COMMENT_MAX = 1000
export const AI_FEEDBACK_TARGETS_MAX = 100

const VARIANT_PATTERN = new RegExp(
  `^(${SD_COPILOT_VARIANTS.join('|')})(:\\d{1,4})?$`,
)

const targetId = z
  .string()
  .trim()
  .min(1, 'Informe a resposta avaliada')
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, 'Identificador inválido')

export const AiFeedbackSurfaceSchema = z.enum(AI_FEEDBACK_SURFACES).meta({
  description:
    'Onde a resposta apareceu: `STEEL_AI_MESSAGE` (mensagem do chat), `STEEL_AGENT_RUN` (execução de agente), `SD_COPILOT` / `SD_TRIAGE` (chamado), `SD_KCS_DRAFT` (artigo rascunho), `WHATSAPP_AUTO_REPLY` (mensagem enviada pela IA).',
})

/** `POST /ai/feedback` — rate (or re-rate) one AI answer. */
export const UpsertAiFeedbackSchema = z
  .object({
    surface: AiFeedbackSurfaceSchema,
    targetId,
    variant: z.string().trim().max(40).default('').meta({
      description:
        'Só no `SD_COPILOT`: `summary`, `reply`, `solution`, `classification` ou `chat[:n]`. Vazio nas demais.',
    }),
    rating: z.enum(AI_FEEDBACK_RATINGS),
    reason: z.enum(AI_FEEDBACK_REASONS).nullable().default(null),
    comment: z
      .string()
      .trim()
      .max(
        AI_FEEDBACK_COMMENT_MAX,
        `No máximo ${AI_FEEDBACK_COMMENT_MAX} caracteres`,
      )
      .nullable()
      .default(null)
      .transform((value) => (value ? value : null)),
  })
  .superRefine((value, ctx) => {
    if (value.surface === 'SD_COPILOT') {
      if (!VARIANT_PATTERN.test(value.variant)) {
        ctx.addIssue({
          code: 'custom',
          path: ['variant'],
          message: 'Informe qual resposta do copiloto foi avaliada',
        })
      }
    } else if (value.variant !== '') {
      ctx.addIssue({
        code: 'custom',
        path: ['variant'],
        message: 'Esta superfície não tem variações',
      })
    }
    if (value.rating === 'UP' && value.reason) {
      ctx.addIssue({
        code: 'custom',
        path: ['reason'],
        message: 'O motivo só vale para avaliações negativas',
      })
    }
  })

export type UpsertAiFeedbackInput = z.infer<typeof UpsertAiFeedbackSchema>

/** `GET /ai/feedback` — the caller's own ratings of a batch of answers. */
export const ListMyAiFeedbackQuerySchema = z.object({
  surface: AiFeedbackSurfaceSchema,
  targetIds: z
    .string()
    .transform((raw) =>
      [
        ...new Set(
          raw
            .split(',')
            .map((id) => id.trim())
            .filter(Boolean),
        ),
      ].slice(0, AI_FEEDBACK_TARGETS_MAX),
    )
    .pipe(z.array(targetId).min(1, 'Informe ao menos uma resposta'))
    .meta({
      description: `Ids separados por vírgula (até ${AI_FEEDBACK_TARGETS_MAX}).`,
    }),
})

export type ListMyAiFeedbackQuery = z.infer<typeof ListMyAiFeedbackQuerySchema>

/** `GET /ai/quality` — same period filter as the usage analytics. */
export const AiQualityQuerySchema = z
  .object(periodFields)
  .superRefine(checkCustomRange)

export type AiQualityQuery = z.infer<typeof AiQualityQuerySchema>

/** CSV views: one row per feedback, or totals per surface / model. */
export const AI_QUALITY_EXPORT_VIEWS = ['feedback', 'surface', 'model'] as const
export type AiQualityExportView = (typeof AI_QUALITY_EXPORT_VIEWS)[number]

/** `GET /ai/quality/export`. */
export const AiQualityExportQuerySchema = z
  .object({
    ...periodFields,
    view: z.enum(AI_QUALITY_EXPORT_VIEWS).default('feedback').meta({
      description:
        '`feedback` = uma linha por avaliação; `surface` / `model` = totais de aprovação.',
    }),
  })
  .superRefine(checkCustomRange)

export type AiQualityExportQuery = z.infer<typeof AiQualityExportQuerySchema>
