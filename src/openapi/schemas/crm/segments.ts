import { z } from 'zod'
import {
  CRM_SEGMENT_TARGETS,
  CrmSegmentDefinitionSchema,
} from '@/src/schemas/crm-segment.schema'
import { dto } from '../../common'

/** DTOs dos segmentos dinâmicos de contatos (CRM > Segmentação). */

export const CrmSegmentDefinition = dto(
  'CrmSegmentDefinition',
  CrmSegmentDefinitionSchema,
)

export const CrmSegmentDTO = dto(
  'CrmSegmentDTO',
  z.object({
    id: z.string(),
    name: z
      .string()
      .meta({ example: 'Leads qualificados que abriram e-mails' }),
    description: z.string().nullable(),
    target: z.enum(CRM_SEGMENT_TARGETS),
    definition: CrmSegmentDefinition,
    valid: z.boolean().meta({
      description:
        'false quando a definição gravada não vale mais (mostrada vazia); campanhas recusam enviar para ela.',
    }),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  }),
)

const Contact = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
})

export const CrmSegmentPreviewDTO = dto(
  'CrmSegmentPreviewDTO',
  z.object({
    total: z.number().int().meta({
      example: 420,
      description: 'Contatos que cumprem as regras agora.',
    }),
    sample: z.array(Contact),
  }),
)

export const CrmSegmentContactsPageDTO = dto(
  'CrmSegmentContactsPageDTO',
  z.object({
    total: z.number().int(),
    page: z.number().int(),
    pageSize: z.number().int(),
    items: z.array(Contact),
  }),
)

export const CrmSegmentOptionsDTO = dto(
  'CrmSegmentOptionsDTO',
  z.object({
    campaigns: z.array(z.object({ id: z.string(), name: z.string() })),
    mailingLists: z.array(z.object({ id: z.string(), name: z.string() })),
    customFields: z.array(
      z.object({
        id: z.string(),
        label: z.string(),
        entity: z.enum(['PERSON', 'COMPANY']),
        type: z.string(),
        options: z.array(z.string()),
      }),
    ),
  }),
)
