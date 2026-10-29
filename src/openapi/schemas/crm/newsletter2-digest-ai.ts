import { z } from 'zod'
import { CRM_NEWSLETTER_AB_METRICS } from '@/src/schemas/crm-newsletter-ab.schema'
import {
  CRM_NEWSLETTER_DIGEST_CADENCES,
  CRM_NEWSLETTER_DIGEST_MODES,
  CRM_NEWSLETTER_DIGEST_OUTCOMES,
} from '@/src/schemas/crm-newsletter-digest.schema'
import { dto } from '../../common'

/**
 * DTOs da fase 2 da newsletter, frente nl2-digest-ai: resumo automático
 * (blog do Sites / feed RSS), IA no editor da edição e teste A/B de
 * assunto.
 */

const nullableDateTime = () => z.iso.datetime().nullable()

export const CrmNewsletterAbTestDTO = dto(
  'CrmNewsletterAbTestDTO',
  z.object({
    subjectB: z.string().meta({ example: 'Você viu o que mudou em outubro?' }),
    testPercent: z.number().int().meta({
      example: 20,
      description: 'Parte da audiência no teste (metade A, metade B).',
    }),
    metric: z.enum(CRM_NEWSLETTER_AB_METRICS),
    waitHours: z.number().int().meta({ example: 4 }),
    winner: z.enum(['A', 'B']).nullable(),
    decidedAt: nullableDateTime(),
    decideAt: nullableDateTime().meta({
      description: 'Quando o vencedor é escolhido (início do envio + espera).',
    }),
  }),
)

export const CrmNewsletterAbReportDTO = dto(
  'CrmNewsletterAbReportDTO',
  z.object({
    subjectA: z.string(),
    abTest: CrmNewsletterAbTestDTO.nullable(),
    variants: z.array(
      z.object({
        variant: z.enum(['A', 'B']),
        subject: z.string(),
        recipients: z.number().int(),
        sent: z.number().int(),
        opened: z.number().int(),
        clicked: z.number().int(),
        openRate: z.number().nullable(),
        clickRate: z.number().nullable(),
      }),
    ),
    held: z.number().int().meta({
      description: 'Destinatários esperando o vencedor.',
    }),
  }),
)

export const CrmNewsletterDigestDTO = dto(
  'CrmNewsletterDigestDTO',
  z.object({
    id: z.string(),
    newsletterId: z.string(),
    enabled: z.boolean(),
    siteId: z.string().nullable(),
    siteName: z.string().nullable(),
    rssUrl: z.string().nullable(),
    cadence: z.enum(CRM_NEWSLETTER_DIGEST_CADENCES),
    weekday: z.number().int().nullable().meta({
      description: '0 = domingo … 6 = sábado.',
    }),
    monthDay: z.number().int().nullable(),
    hour: z
      .number()
      .int()
      .meta({ description: 'Hora cheia, fuso de São Paulo.' }),
    mode: z.enum(CRM_NEWSLETTER_DIGEST_MODES),
    maxItems: z.number().int(),
    subject: z.string().meta({ example: 'Resumo de {data}' }),
    intro: z.string().nullable(),
    nextRunAt: nullableDateTime(),
    lastRunAt: nullableDateTime(),
    lastItemAt: nullableDateTime(),
    lastIssueId: z.string().nullable(),
    lastOutcome: z.enum(CRM_NEWSLETTER_DIGEST_OUTCOMES).nullable(),
    lastMessage: z.string().nullable(),
    updatedAt: z.iso.datetime(),
  }),
)

export const CrmNewsletterDigestSettingsDTO = dto(
  'CrmNewsletterDigestSettingsDTO',
  z.object({
    digest: CrmNewsletterDigestDTO.nullable(),
    sites: z.array(
      z.object({ id: z.string(), name: z.string(), published: z.boolean() }),
    ),
  }),
)

export const CrmNewsletterDigestPreviewDTO = dto(
  'CrmNewsletterDigestPreviewDTO',
  z.object({
    items: z.array(
      z.object({
        source: z.enum(['SITE', 'RSS']),
        title: z.string(),
        excerpt: z.string(),
        url: z.string(),
        imageUrl: z.string().nullable(),
        publishedAt: nullableDateTime(),
      }),
    ),
    warnings: z.array(z.string()),
    since: z.iso.datetime(),
  }),
)

export const CrmNewsletterDigestRunDTO = dto(
  'CrmNewsletterDigestRunDTO',
  z.object({
    issueId: z.string().nullable(),
    items: z.number().int(),
    message: z.string(),
  }),
)

export const CrmNewsletterAiSourcesDTO = dto(
  'CrmNewsletterAiSourcesDTO',
  z.object({
    posts: z.array(
      z.object({
        id: z.string(),
        title: z.string(),
        siteName: z.string(),
        publishedAt: nullableDateTime(),
      }),
    ),
    kbArticles: z
      .array(z.object({ id: z.string(), title: z.string() }))
      .nullable()
      .meta({ description: 'null = sem acesso ao ServiceDesk.' }),
    products: z.array(z.object({ id: z.string(), name: z.string() })),
  }),
)

export const CrmNewsletterAiDraftResultDTO = dto(
  'CrmNewsletterAiDraftResultDTO',
  z.object({
    reply: z.string(),
    subject: z.string(),
    preheader: z.string(),
    sections: z.array(z.unknown()).meta({
      description:
        'Fragmentos do Steel Canvas (seções do catálogo de e-mail, já validadas) que substituem o conteúdo da edição; o rodapé fica.',
    }),
  }),
)

export const CrmNewsletterAiSubjectsResultDTO = dto(
  'CrmNewsletterAiSubjectsResultDTO',
  z.object({
    suggestions: z.array(
      z.object({ subject: z.string(), preheader: z.string() }),
    ),
  }),
)
