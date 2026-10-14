import { z } from 'zod'
import {
  CrmFormFieldSchema,
  CrmFormPhaseSchema,
  FORM_ACTIONS,
} from '@/src/schemas/crm-form.schema'
import {
  CrmLandingPageSectionContentSchema,
  CrmLandingPageSectionTypeEnum,
} from '@/src/schemas/crm-landing-page-section.schema'
import { dto } from '../../common'

/**
 * DTOs de formulários e landing pages (gestão interna) —
 * `types/crm-form.d.ts`, `types/crm-landing-page.d.ts`.
 */

const dateTime = () => z.iso.datetime()
const nullableDateTime = () => z.iso.datetime().nullable()
const PUBLISH_STATUS = z.enum(['DRAFT', 'PUBLISHED'])

export const CrmFormDTO = dto(
  'CrmForm',
  z
    .object({
      id: z.string().meta({ example: 'ckw1form0000ab7d3k1e5xyz' }),
      name: z.string().meta({ example: 'Solicite um orçamento' }),
      description: z.string().nullable(),
      status: PUBLISH_STATUS.meta({
        description: 'Só formulários `PUBLISHED` respondem na página pública.',
      }),
      publicToken: z.string().meta({
        description:
          'Token do link público (`/f/<publicToken>` e `/api/crm/forms/<publicToken>`).',
        example: 'f_9Qm2xL7aP0',
      }),
      action: z.enum(FORM_ACTIONS).meta({
        description: 'Registro criado a cada envio (pessoa, empresa ou lead).',
      }),
      fields: z.array(CrmFormFieldSchema),
      phases: z.array(CrmFormPhaseSchema).meta({
        description: 'Etapas do formulário multi-etapas. Vazio = etapa única.',
      }),
      successMessage: z.string().nullable(),
      redirectUrl: z.string().nullable(),
      submissionCount: z.number().int(),
      workspaceId: z.string(),
      createdById: z.string(),
      updatedById: z.string().nullable(),
      position: z.number(),
      publishedAt: nullableDateTime(),
      createdAt: dateTime(),
      updatedAt: dateTime(),
    })
    .meta({ description: 'Formulário de captura do CRM.' }),
)

const CrmLandingPageSectionDTO = z.object({
  id: z.string(),
  type: CrmLandingPageSectionTypeEnum,
  order: z.number().int(),
  enabled: z.boolean(),
  content: CrmLandingPageSectionContentSchema,
})

export const CrmLandingPageDTO = dto(
  'CrmLandingPage',
  z
    .object({
      id: z.string().meta({ example: 'ckw1land0000ab7d3k1e5xyz' }),
      title: z.string().meta({ example: 'Black Friday — ServiceDesk' }),
      templateKey: z
        .string()
        .meta({ description: 'Template visual (catálogo fixo).' }),
      status: PUBLISH_STATUS.meta({
        description: 'Só páginas `PUBLISHED` respondem no link público.',
      }),
      shareToken: z.string().meta({
        description:
          'Token do link público (`/l/<shareToken>` e `/api/crm/landing-pages/<shareToken>`).',
      }),
      viewsCount: z.number().int(),
      sections: z.array(CrmLandingPageSectionDTO),
      publishedAt: nullableDateTime().meta({
        description:
          'Momento da publicação. O `PATCH` com `status` só carimba na primeira vez e preserva ao despublicar; as rotas `/publish` regravam (POST) ou limpam (DELETE).',
      }),
      workspaceId: z.string(),
      createdById: z.string(),
      updatedById: z.string().nullable(),
      position: z.number(),
      createdAt: dateTime(),
      updatedAt: dateTime(),
    })
    .meta({ description: 'Landing page do CRM.' }),
)

export const CrmLandingPageViewDTO = dto(
  'CrmLandingPageView',
  z
    .object({
      id: z.string(),
      landingPageId: z.string(),
      viewId: z.string().meta({
        description: 'Id da visualização gerado pelo navegador do visitante.',
      }),
      ipHash: z
        .string()
        .meta({ description: 'Hash do IP do visitante (nunca o IP puro).' }),
      durationMs: z.number().int(),
      ctaClicks: z.number().int(),
      referrer: z.string().nullable(),
      createdAt: dateTime(),
      updatedAt: dateTime(),
    })
    .meta({ description: 'Visualização registrada de uma landing page.' }),
)

export const CrmLandingPageAiReplyDTO = dto(
  'CrmLandingPageAiReply',
  z
    .object({
      reply: z.string().meta({ description: 'Resposta curta da IA.' }),
      suggestion: z.string().nullable().meta({
        description:
          'Novo texto completo do campo, pronto para aplicar; `null` quando a IA só respondeu uma pergunta.',
      }),
    })
    .meta({ description: 'Uma rodada do mini chat de IA de um campo.' }),
)
