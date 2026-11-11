import { z } from 'zod'
import {
  DocumentKindSchema,
  DocumentSettingsSchema,
  DocumentStatusSchema,
} from '@/src/schemas/document.schema'
import { dto } from '../../common'

/** DTOs of CRM > Documentos (`types/document.d.ts`, ADR 0063). */

const dateTime = () => z.iso.datetime()
const nullableDateTime = () => z.iso.datetime().nullable()
const ref = () => z.object({ id: z.string(), name: z.string() })
const record = () => z.record(z.string(), z.unknown())

const SourceEnum = z.enum([
  'BLANK',
  'TEMPLATE',
  'DUPLICATE',
  'PDF_IMPORT',
  'AI_PROMPT',
  'LEGACY_PROPOSAL',
])
const RoleEnum = z.enum(['VIEWER', 'APPROVER'])
const RecipientStatusEnum = z.enum([
  'PENDING',
  'VIEWED',
  'ACCEPTED',
  'DECLINED',
])
const ChannelEnum = z.enum(['LINK', 'EMAIL', 'WHATSAPP'])

const listItemShape = {
  id: z.string().meta({ example: 'ckw1doc00000ab7d3k1e5xyz' }),
  workspaceId: z.string(),
  title: z.string().meta({ example: 'Proposta — Implantação ServiceDesk' }),
  kind: DocumentKindSchema,
  status: DocumentStatusSchema,
  isTemplate: z.boolean(),
  source: SourceEnum,
  owner: ref().extend({ image: z.string().nullable() }).nullable(),
  company: ref().nullable(),
  person: ref().nullable(),
  opportunity: ref().nullable(),
  lead: ref().nullable(),
  totalValue: z
    .number()
    .nullable()
    .meta({ description: 'Total das tabelas de preço da versão atual (R$).' }),
  validUntil: nullableDateTime().meta({
    description: 'Vale até o fim deste dia (America/Sao_Paulo).',
  }),
  sentAt: nullableDateTime(),
  firstViewedAt: nullableDateTime(),
  lastViewedAt: nullableDateTime(),
  acceptedAt: nullableDateTime(),
  viewCount: z
    .number()
    .int()
    .meta({ description: 'Sessões de leitura do link público.' }),
  createdAt: dateTime(),
  updatedAt: dateTime(),
}

export const DocumentListItemDTO = dto(
  'DocumentListItem',
  z.object(listItemShape),
)

export const DocumentListPageDTO = dto(
  'DocumentListPage',
  z.object({
    items: z.array(DocumentListItemDTO),
    total: z.number().int(),
    page: z.number().int(),
    pageSize: z.number().int(),
  }),
)

const recipientShape = {
  id: z.string(),
  name: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  role: RoleEnum,
  status: RecipientStatusEnum,
  channel: ChannelEnum,
  url: z.string().meta({
    description: 'Link pessoal `/d/<token>` (absoluto).',
  }),
  sentAt: nullableDateTime(),
  firstViewedAt: nullableDateTime(),
  lastViewedAt: nullableDateTime(),
  respondedAt: nullableDateTime(),
}

export const DocumentRecipientDTO = dto(
  'DocumentRecipient',
  z.object(recipientShape),
)

export const DocumentVersionDTO = dto(
  'DocumentVersion',
  z.object({
    id: z.string(),
    number: z.number().int(),
    sha256: z.string().meta({
      description: 'SHA-256 do JSON canônico de conteúdo + tema + ajustes.',
    }),
    createdAt: dateTime(),
    createdBy: ref().nullable(),
  }),
)

const documentShape = {
  ...listItemShape,
  description: z.string().nullable(),
  content: record().meta({
    description: 'Documento do Steel Canvas (catálogo `document`).',
  }),
  theme: record(),
  settings: DocumentSettingsSchema,
  templateId: z.string().nullable(),
  currentVersion: DocumentVersionDTO.nullable(),
  hasUnsentChanges: z.boolean().meta({
    description:
      'O rascunho difere da versão atual (o link mostra a versão enviada).',
  }),
  publicToken: z.string(),
  publicUrl: z.string().meta({
    description: 'Link genérico `/d/<publicToken>` (absoluto).',
  }),
  linkEnabled: z.boolean(),
  acceptedByName: z.string().nullable(),
  acceptedByEmail: z.string().nullable(),
  declinedAt: nullableDateTime(),
  declineReason: z.string().nullable(),
  expiredAt: nullableDateTime(),
  paidAt: nullableDateTime(),
  recipients: z.array(DocumentRecipientDTO),
}

export const DocumentDTO = dto('Document', z.object(documentShape))

const DeliveryDTO = z.object({
  recipientId: z.string(),
  requested: ChannelEnum,
  channel: ChannelEnum.meta({
    description:
      'Canal usado: sem número de WhatsApp conectado, cai para `LINK`.',
  }),
  delivered: z.boolean(),
  message: z.string().nullable(),
})

export const DocumentSendResultDTO = dto(
  'DocumentSendResult',
  z.object({ ...documentShape, deliveries: z.array(DeliveryDTO) }),
)

export const DocumentRecipientDeliveryDTO = dto(
  'DocumentRecipientDelivery',
  z.object({ ...recipientShape, delivery: DeliveryDTO }),
)

export const DocumentEventDTO = dto(
  'DocumentEvent',
  z.object({
    id: z.string(),
    type: z.string().meta({ example: 'SENT' }),
    recipient: ref().nullable(),
    actor: ref().nullable(),
    data: record(),
    createdAt: dateTime(),
  }),
)

export const DocumentResponseDTO = dto(
  'DocumentResponse',
  z.object({
    id: z.string(),
    action: z.enum(['ACCEPT', 'DECLINE', 'SUBMIT']),
    name: z.string().nullable(),
    email: z.string().nullable(),
    recipientId: z.string().nullable(),
    versionNumber: z.number().int(),
    fields: record(),
    selection: z.record(
      z.string(),
      z.object({ selected: z.boolean(), quantity: z.number() }),
    ),
    totalValue: z.number().nullable(),
    reason: z.string().nullable(),
    createdAt: dateTime(),
  }),
)

export const DocumentSavedDTO = dto(
  'DocumentSaved',
  z.object({ updatedAt: dateTime() }),
)

export const DocumentPublicDTO = dto(
  'DocumentPublic',
  z.object({
    token: z.string(),
    document: z.object({
      id: z.string(),
      title: z.string(),
      kind: DocumentKindSchema,
      status: DocumentStatusSchema,
      validUntil: nullableDateTime(),
      acceptedAt: nullableDateTime(),
      acceptedByName: z.string().nullable(),
      declinedAt: nullableDateTime(),
      settings: DocumentSettingsSchema,
      theme: record(),
    }),
    version: z.object({
      id: z.string(),
      number: z.number().int(),
      content: record(),
    }),
    recipient: z
      .object({
        id: z.string(),
        name: z.string(),
        role: RoleEnum,
        status: RecipientStatusEnum,
      })
      .nullable(),
    variables: z.record(z.string(), z.string()),
    canAccept: z.boolean(),
    canDownload: z.boolean(),
    paymentEnabled: z.boolean(),
    brand: z.object({ name: z.string(), logoUrl: z.string().nullable() }),
  }),
)

export const DocumentIdentifyResultDTO = dto(
  'DocumentIdentifyResult',
  z.object({
    token: z.string(),
    recipientId: z.string(),
    url: z.string(),
  }),
)
