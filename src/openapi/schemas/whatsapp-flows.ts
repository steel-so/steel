import { z } from 'zod'
import {
  FLOW_CATEGORIES,
  FLOW_CRM_ACTIONS,
  FLOW_STATUSES,
  FlowDefinitionSchema,
} from '@/src/schemas/whatsapp-flow.schema'
import { dto } from '../common'

/**
 * Schemas de resposta dos WhatsApp Flows (Z3). Alinhados a
 * `src/mappers/whatsapp-flow.mapper.ts` e `types/whatsapp-flow.d.ts`.
 */

const dateTime = () => z.iso.datetime()
const nullableDateTime = () => z.iso.datetime().nullable()

const FlowBase = z.object({
  id: z.string().meta({ example: 'cm0flow' }),
  workspaceId: z.string(),
  connectionId: z
    .string()
    .meta({ description: 'Conexão Meta cuja WABA hospeda o Flow.' }),
  name: z.string(),
  description: z.string().nullable(),
  category: z.enum(FLOW_CATEGORIES),
  status: z.enum(FLOW_STATUSES),
  definition: FlowDefinitionSchema.meta({
    description:
      'Telas e campos. É convertido no Flow JSON da Meta ao enviar o rascunho ou publicar.',
  }),
  bodyText: z.string(),
  ctaLabel: z.string(),
  confirmationText: z.string().nullable(),
  crmAction: z.enum(FLOW_CRM_ACTIONS),
  sourceCrmFormId: z.string().nullable(),
  metaFlowId: z.string().nullable(),
  metaStatus: z.string().nullable(),
  publishError: z
    .string()
    .nullable()
    .meta({ description: 'Última recusa da Meta, quando houve.' }),
  publishedVersion: z.number().int(),
  publishedAt: nullableDateTime(),
  hasUnpublishedChanges: z.boolean(),
  sendable: z.boolean(),
  createdAt: dateTime(),
  updatedAt: dateTime(),
})

export const WhatsAppFlowDTO = dto('WhatsAppFlow', FlowBase)

export const WhatsAppFlowListItemDTO = dto(
  'WhatsAppFlowListItem',
  FlowBase.extend({
    sent: z.number().int(),
    completed: z.number().int(),
  }),
)

export const WhatsAppFlowResponseDTO = dto(
  'WhatsAppFlowResponse',
  z.object({
    id: z.string(),
    flowId: z.string(),
    contactId: z.string(),
    contactName: z.string().nullable(),
    contactWaId: z.string(),
    conversationId: z.string().nullable(),
    status: z.enum(['SENT', 'COMPLETED']),
    answers: z
      .record(z.string(), z.unknown())
      .nullable()
      .meta({ description: 'Respostas por chave de campo.' }),
    createdLeadId: z.string().nullable(),
    createdPersonId: z.string().nullable(),
    createdCompanyId: z.string().nullable(),
    mappingNote: z
      .string()
      .nullable()
      .meta({ description: 'Por que o CRM não recebeu a resposta.' }),
    sentAt: dateTime(),
    respondedAt: nullableDateTime(),
  }),
)

export const WhatsAppFlowResponsesPageDTO = dto(
  'WhatsAppFlowResponsesPage',
  z.object({
    items: z.array(WhatsAppFlowResponseDTO),
    nextCursor: z.string().nullable(),
  }),
)

export const WhatsAppFlowPublishDTO = dto(
  'WhatsAppFlowPublish',
  z.object({
    flow: WhatsAppFlowDTO,
    published: z.boolean(),
  }),
)

export const WhatsAppFlowMetaJsonDTO = dto(
  'WhatsAppFlowMetaJson',
  z.object({
    json: z.record(z.string(), z.unknown()).meta({
      description: 'Flow JSON gerado a partir das telas salvas.',
    }),
  }),
)

export const WhatsAppFlowPreviewDTO = dto(
  'WhatsAppFlowPreview',
  z.object({
    previewUrl: z.string().nullable(),
    status: z.string(),
  }),
)

export const WhatsAppFlowSendDTO = dto(
  'WhatsAppFlowSend',
  z.object({
    messageId: z.string(),
    responseId: z.string(),
  }),
)
