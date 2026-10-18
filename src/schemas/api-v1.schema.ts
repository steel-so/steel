import { z } from 'zod'
import { V1PageQuerySchema } from '@/src/lib/api/v1-pagination'
import { CrmLeadStageEnum } from '@/src/schemas/crm-lead.schema'
import { SdTicketTypeEnum } from '@/src/schemas/sd-rule.schema'
import { SD_PHASE_CATEGORIES } from '@/src/schemas/sd-ticket.schema'
import { SD_MESSAGE_MAX_LENGTH } from '@/src/schemas/sd-ticket-message.schema'

/**
 * Inputs of the public API v1 (`app/api/v1/**`, ADR 0035) that differ from
 * the app's. Bodies the app already validates (create ticket, create lead,
 * move phase) reuse the existing schema; these cover the v1 query strings
 * (cursor pagination + a curated set of filters) and the few bodies v1
 * shapes for the CLI.
 */

const blank = (value: unknown) =>
  value === '' || value === null ? undefined : value

/** `a,b` or a repeated key → list; empty → absent. */
function csv(value: unknown): unknown {
  if (value === undefined || value === null || value === '') return undefined
  const items = (Array.isArray(value) ? value : [value])
    .flatMap((item) => String(item).split(','))
    .map((item) => item.trim())
    .filter(Boolean)
  return items.length > 0 ? items : undefined
}

const id = z.string().min(1).max(64)
const idList = (description: string) =>
  z.preprocess(csv, z.array(id).max(100).optional().meta({ description }))

/* ------------------------------------------------------------------ */
/* ServiceDesk                                                          */
/* ------------------------------------------------------------------ */

/** Phase categories that close a ticket (listed only on request). */
export const V1_CLOSED_PHASE_CATEGORIES = [
  'RESOLVED',
  'CLOSED',
  'CANCELED',
] as const

export const ListV1SdTicketsSchema = V1PageQuerySchema.extend({
  status: z.preprocess(
    csv,
    z.array(z.enum(SD_PHASE_CATEGORIES)).optional().meta({
      description:
        'Categorias de fase, em CSV: NEW, IN_PROGRESS, WAITING, RESOLVED, CLOSED, CANCELED. Omitido = só os abertos (NEW, IN_PROGRESS, WAITING).',
    }),
  ),
  type: z.preprocess(
    csv,
    z.array(SdTicketTypeEnum).optional().meta({
      description: 'Tipos, em CSV: INCIDENT, SERVICE_REQUEST, CHANGE, PROBLEM.',
    }),
  ),
  phaseId: idList('Ids de fase, em CSV.'),
  priorityId: idList('Ids de prioridade, em CSV.'),
  assigneeId: idList(
    'Responsáveis, em CSV: ids de usuário, `me` (você) e `unassigned` (sem responsável).',
  ),
  q: z.preprocess(
    blank,
    z
      .string()
      .trim()
      .max(200)
      .optional()
      .meta({ description: 'Texto no título, na descrição ou no código.' }),
  ),
})
export type ListV1SdTicketsDTO = z.infer<typeof ListV1SdTicketsSchema>

export const CreateV1SdTicketCommentSchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, 'Escreva o comentário')
    .max(SD_MESSAGE_MAX_LENGTH, 'Mensagem muito longa'),
  visibility: z.enum(['PUBLIC', 'INTERNAL']).default('PUBLIC').meta({
    description:
      '`PUBLIC` aparece para o solicitante; `INTERNAL` só para os agentes.',
  }),
})
export type CreateV1SdTicketCommentDTO = z.infer<
  typeof CreateV1SdTicketCommentSchema
>

export const ListV1SdCatalogSchema = V1PageQuerySchema.extend({
  ticketType: z.preprocess(
    blank,
    SdTicketTypeEnum.optional().meta({
      description: 'Só os itens que aparecem neste tipo de chamado.',
    }),
  ),
})
export type ListV1SdCatalogDTO = z.infer<typeof ListV1SdCatalogSchema>

/* ------------------------------------------------------------------ */
/* CRM                                                                  */
/* ------------------------------------------------------------------ */

export const ListV1CrmLeadsSchema = V1PageQuerySchema.extend({
  stage: z.preprocess(blank, CrmLeadStageEnum.optional()),
})
export type ListV1CrmLeadsDTO = z.infer<typeof ListV1CrmLeadsSchema>

/** Rows accepted by `POST /api/v1/crm/leads/import`. */
export const V1_LEAD_IMPORT_MAX_ROWS = 5000
/** 5 MB of CSV is far more than 5,000 lead rows need. */
export const V1_LEAD_IMPORT_MAX_BYTES = 5 * 1024 * 1024

export const ImportV1CrmLeadsQuerySchema = z.object({
  source: z.preprocess(
    blank,
    z.string().trim().min(1).max(100).optional().meta({
      description:
        'Origem das linhas sem a coluna `source`/`origem` preenchida. Padrão: `API`.',
    }),
  ),
})
export type ImportV1CrmLeadsQueryDTO = z.infer<
  typeof ImportV1CrmLeadsQuerySchema
>

export const ListV1CrmOpportunitiesSchema = V1PageQuerySchema.extend({
  pipelineId: z.preprocess(blank, id.optional()),
  stageId: z.preprocess(blank, id.optional()),
})
export type ListV1CrmOpportunitiesDTO = z.infer<
  typeof ListV1CrmOpportunitiesSchema
>

export const MoveV1CrmOpportunityStageSchema = z.object({
  stageId: id.meta({ description: 'Etapa de destino.' }),
  pipelineId: id.optional().meta({
    description:
      'Funil da etapa, quando a oportunidade muda de funil. Omitido = o funil atual.',
  }),
})
export type MoveV1CrmOpportunityStageDTO = z.infer<
  typeof MoveV1CrmOpportunityStageSchema
>

/* ------------------------------------------------------------------ */
/* Comunicação (WhatsApp)                                               */
/* ------------------------------------------------------------------ */

export const WHATSAPP_TEMPLATE_STATUSES = [
  'APPROVED',
  'PENDING',
  'REJECTED',
  'PAUSED',
  'DISABLED',
] as const

export const ListV1WhatsAppTemplatesSchema = V1PageQuerySchema.extend({
  status: z.preprocess(
    blank,
    z
      .enum([...WHATSAPP_TEMPLATE_STATUSES, 'ALL'])
      .default('APPROVED')
      .meta({ description: 'Situação na Meta. `ALL` = todas.' }),
  ),
  connectionId: z.preprocess(blank, id.optional()),
})
export type ListV1WhatsAppTemplatesDTO = z.infer<
  typeof ListV1WhatsAppTemplatesSchema
>

export const SendV1WhatsAppTemplateSchema = z
  .object({
    conversationId: id.optional().meta({
      description:
        'Conversa existente. Ou informe `contactId` + `connectionId`.',
    }),
    contactId: id.optional().meta({
      description:
        'Contato. Com `connectionId`, usa a conversa aberta do contato ou abre uma.',
    }),
    connectionId: id.optional().meta({ description: 'Conexão que envia.' }),
    templateName: z.string().min(1),
    language: z.string().min(1).max(20).meta({ example: 'pt_BR' }),
    components: z.array(z.unknown()).optional().meta({
      description: 'Componentes da Cloud API (variáveis do corpo, cabeçalho).',
    }),
  })
  .refine(
    (data) =>
      data.conversationId
        ? !data.contactId && !data.connectionId
        : !!data.contactId && !!data.connectionId,
    {
      message: 'Informe conversationId, ou contactId e connectionId',
      path: ['conversationId'],
    },
  )
export type SendV1WhatsAppTemplateDTO = z.infer<
  typeof SendV1WhatsAppTemplateSchema
>
