import { z } from 'zod'
import {
  CrmFormFieldSchema,
  CrmFormPhaseSchema,
  FORM_ACTIONS,
} from '@/src/schemas/crm-form.schema'
import { dto } from '../../common'

/**
 * DTOs de formulários (gestão interna) — `types/crm-form.d.ts`.
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
      newsletterId: z.string().nullable().meta({
        description:
          'Newsletter em que a caixa de consentimento do formulário inscreve (ADR 0054). Nulo = não inscreve.',
      }),
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

export const CrmTextAiReplyDTO = dto(
  'CrmTextAiReply',
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
