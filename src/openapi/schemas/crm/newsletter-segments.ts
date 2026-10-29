import { z } from 'zod'
import { NewsletterSegmentSchema } from '@/src/schemas/crm-newsletter-segment.schema'
import { dto } from '../../common'

/**
 * DTOs dos segmentos de público da newsletter (newsletter2, frente
 * nl2-segments): segmento salvo, público da edição, prévia da audiência e
 * as opções do construtor.
 */

export const CrmNewsletterSegmentDefinition = dto(
  'CrmNewsletterSegmentDefinition',
  NewsletterSegmentSchema,
)

export const CrmNewsletterSegmentDTO = dto(
  'CrmNewsletterSegmentDTO',
  z.object({
    id: z.string(),
    newsletterId: z.string(),
    name: z.string().meta({ example: 'Clientes engajados' }),
    definition: CrmNewsletterSegmentDefinition,
    valid: z.boolean().meta({
      description:
        'false quando a definição gravada não é mais válida (mostrada vazia).',
    }),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  }),
)

export const CrmNewsletterIssueSegmentDTO = dto(
  'CrmNewsletterIssueSegmentDTO',
  z.object({
    segment: CrmNewsletterSegmentDefinition,
    savedSegmentId: z.string().nullable(),
    savedSegmentName: z.string().nullable(),
    everyone: z.boolean().meta({
      description: 'Sem condições: todos os assinantes ativos.',
    }),
  }),
)

export const CrmNewsletterAudiencePreviewDTO = dto(
  'CrmNewsletterAudiencePreviewDTO',
  z.object({
    count: z.number().int().meta({
      example: 420,
      description: 'Assinantes que receberiam a edição com este público.',
    }),
    total: z.number().int().meta({
      example: 1200,
      description: 'Todos os assinantes ativos fora do descadastro geral.',
    }),
    sample: z.array(
      z.object({
        id: z.string(),
        email: z.string(),
        name: z.string().nullable(),
      }),
    ),
  }),
)

export const CrmNewsletterSegmentOptionsDTO = dto(
  'CrmNewsletterSegmentOptionsDTO',
  z.object({
    companies: z.array(z.object({ id: z.string(), name: z.string() })),
    customFields: z.array(
      z.object({
        id: z.string(),
        label: z.string(),
        type: z.enum(['TEXT', 'NUMBER', 'DATE', 'BOOLEAN', 'SELECT']),
        options: z.array(z.string()),
      }),
    ),
  }),
)
