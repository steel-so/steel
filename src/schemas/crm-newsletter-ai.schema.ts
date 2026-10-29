import z from 'zod'
import type { CanvasFragment } from '@/src/lib/canvas/types'

/**
 * AI in the newsletter issue editor (newsletter2 nl2-digest-ai): "Escrever
 * com IA" drafts the whole issue from a short brief plus the sources the
 * member ticks (recent blog posts, ServiceDesk KB articles, CRM products)
 * and "Sugerir assuntos" proposes 5 subjects + preheaders from the issue's
 * own text. Workspace AI provider and CRM AI quota (ADR 0007/0019).
 */

export const CRM_NEWSLETTER_AI_MAX_SOURCES = 6
export const CRM_NEWSLETTER_AI_SUGGESTIONS = 5
export const CRM_NEWSLETTER_AI_TONES = [
  'friendly',
  'neutral',
  'formal',
] as const

const ids = z
  .array(z.string().trim().min(1).max(40))
  .max(
    CRM_NEWSLETTER_AI_MAX_SOURCES,
    `No máximo ${CRM_NEWSLETTER_AI_MAX_SOURCES} itens por fonte`,
  )
  .default([])

export const CrmNewsletterAiDraftSchema = z.object({
  brief: z
    .string()
    .trim()
    .min(10, 'Descreva em uma ou duas frases o que a edição deve dizer')
    .max(2000),
  tone: z.enum(CRM_NEWSLETTER_AI_TONES).default('friendly'),
  postIds: ids,
  kbArticleIds: ids,
  productIds: ids,
})
export type CrmNewsletterAiDraftDTO = z.infer<typeof CrmNewsletterAiDraftSchema>

export const CrmNewsletterAiSubjectsSchema = z.object({
  /** Optional hint ("mais curto", "com urgência"…). */
  brief: z.string().trim().max(500).optional(),
})
export type CrmNewsletterAiSubjectsDTO = z.infer<
  typeof CrmNewsletterAiSubjectsSchema
>

/** What the "Escrever com IA" dialog lets the member tick. */
export type CrmNewsletterAiSourcesDTO = {
  posts: {
    id: string
    title: string
    siteName: string
    publishedAt: string | null
  }[]
  /** `null` = no access to the ServiceDesk module. */
  kbArticles: { id: string; title: string }[] | null
  products: { id: string; name: string }[]
}

export type CrmNewsletterAiDraftResultDTO = {
  reply: string
  subject: string
  preheader: string
  /** Sections to replace the issue content with (footer stays). */
  sections: CanvasFragment[]
}

export type CrmNewsletterAiSubjectSuggestionDTO = {
  subject: string
  preheader: string
}

export type CrmNewsletterAiSubjectsResultDTO = {
  suggestions: CrmNewsletterAiSubjectSuggestionDTO[]
}

// ─── provider output ───────────────────────────────────────────────────────

export const CrmNewsletterAiSubjectsOutputSchema = z.object({
  suggestions: z
    .array(z.object({ subject: z.string(), preheader: z.string() }))
    .min(1),
})

export const CRM_NEWSLETTER_AI_SUBJECTS_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['suggestions'],
  properties: {
    suggestions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['subject', 'preheader'],
        properties: {
          subject: { type: 'string' },
          preheader: { type: 'string' },
        },
      },
    },
  },
}
