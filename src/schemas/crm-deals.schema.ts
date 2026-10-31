import { z } from 'zod'
import { SD_SIGNATURE_MAX_DATA_URL } from '@/src/schemas/sd-ticket-signature.schema'

/**
 * Contracts of the CRM deal tools (nov: crm-deals): C6 proposal signature and
 * charge, C8 shared deal room, C9 contract renewals.
 */

const PNG_DATA_URL = /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/

// ─── Settings ────────────────────────────────────────────────────────────────

export const UpdateCrmDealsSettingsSchema = z.object({
  proposalPaymentEnabled: z.boolean().optional(),
  proposalSignatureEnabled: z.boolean().optional(),
  renewalLeadDays: z.number().int().min(7).max(365).optional(),
  renewalAutoCreate: z.boolean().optional(),
})
export type UpdateCrmDealsSettingsDTO = z.infer<
  typeof UpdateCrmDealsSettingsSchema
>

// ─── C6 · signature and charge ──────────────────────────────────────────────

/** Public: the customer signs the proposal (this also accepts it). */
export const SignCrmProposalSchema = z.object({
  signerName: z
    .string()
    .trim()
    .min(2, 'Informe o nome de quem assina')
    .max(120),
  signerDocument: z.string().trim().max(32).nullable().optional(),
  signerEmail: z
    .string()
    .trim()
    .toLowerCase()
    .max(254)
    .pipe(z.email('E-mail inválido'))
    .nullable()
    .optional(),
  /** `data:image/png;base64,...` drawn on the canvas. */
  image: z
    .string()
    .max(SD_SIGNATURE_MAX_DATA_URL, 'Imagem da assinatura muito grande')
    .regex(PNG_DATA_URL, 'A assinatura deve ser um PNG'),
})
export type SignCrmProposalDTO = z.infer<typeof SignCrmProposalSchema>

export const CrmPaymentMethodSchema = z.enum(['PIX', 'BOLETO'])

export const CreateCrmProposalChargeSchema = z.object({
  method: CrmPaymentMethodSchema,
  /** In reais; defaults to the amount of the deal. */
  amount: z.number().positive().max(100_000_000).optional(),
  description: z.string().trim().min(1).max(140).optional(),
  /** Days the charge stays payable. */
  expiresInDays: z.number().int().min(1).max(30).default(7),
})
export type CreateCrmProposalChargeDTO = z.infer<
  typeof CreateCrmProposalChargeSchema
>

// ─── C8 · deal room ─────────────────────────────────────────────────────────

const httpUrl = z
  .string()
  .trim()
  .max(2000)
  .refine((value) => {
    try {
      const { protocol } = new URL(value)
      return protocol === 'https:' || protocol === 'http:'
    } catch {
      return false
    }
  }, 'Informe um link http(s) válido')

export const DealRoomMaterialInputSchema = z.object({
  id: z.string().optional(),
  title: z.string().trim().min(1, 'Informe o título').max(120),
  url: httpUrl,
})

export const DealRoomActionInputSchema = z.object({
  id: z.string().optional(),
  title: z.string().trim().min(1, 'Informe a ação').max(200),
  owner: z.enum(['SELLER', 'CUSTOMER']),
  dueDate: z.coerce.date().nullable().optional(),
  done: z.boolean().optional(),
})

/** Staff: create or replace the room settings, materials and action plan. */
export const UpsertCrmDealRoomSchema = z.object({
  enabled: z.boolean().optional(),
  title: z.string().trim().max(120).nullable().optional(),
  welcomeMessage: z.string().trim().max(2000).nullable().optional(),
  proposalId: z.string().nullable().optional(),
  materials: z.array(DealRoomMaterialInputSchema).max(30).optional(),
  actions: z.array(DealRoomActionInputSchema).max(60).optional(),
  /** Issues a new token (the old link stops working). */
  rotateToken: z.boolean().optional(),
})
export type UpsertCrmDealRoomDTO = z.infer<typeof UpsertCrmDealRoomSchema>
/** What a client sends (dates as ISO strings). */
export type UpsertCrmDealRoomInput = z.input<typeof UpsertCrmDealRoomSchema>

export const CreateDealRoomMessageSchema = z.object({
  body: z.string().trim().min(1, 'Escreva a mensagem').max(2000),
})
export type CreateDealRoomMessageDTO = z.infer<
  typeof CreateDealRoomMessageSchema
>

export const IdentifyDealRoomVisitorSchema = z.object({
  name: z.string().trim().min(2, 'Informe seu nome').max(120),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(254)
    .pipe(z.email('E-mail inválido')),
})
export type IdentifyDealRoomVisitorDTO = z.infer<
  typeof IdentifyDealRoomVisitorSchema
>

export const DEAL_ROOM_PUBLIC_EVENT_KINDS = [
  'ROOM_OPENED',
  'PROPOSAL_VIEWED',
  'MATERIAL_OPENED',
] as const

export const RecordDealRoomEventSchema = z.object({
  visitorId: z.string().min(1),
  kind: z.enum(DEAL_ROOM_PUBLIC_EVENT_KINDS),
  targetId: z.string().max(64).optional(),
})
export type RecordDealRoomEventDTO = z.infer<typeof RecordDealRoomEventSchema>

/** Public messages and actions carry the visitor who is acting. */
export const PostDealRoomMessageSchema = CreateDealRoomMessageSchema.extend({
  visitorId: z.string().min(1),
})
export type PostDealRoomMessageDTO = z.infer<typeof PostDealRoomMessageSchema>

export const ToggleDealRoomActionSchema = z.object({
  visitorId: z.string().min(1),
  done: z.boolean(),
})
export type ToggleDealRoomActionDTO = z.infer<
  typeof ToggleDealRoomActionSchema
>

export const ListDealRoomMessagesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(100),
})

// ─── C9 · contracts ─────────────────────────────────────────────────────────

export const CrmContractStatusSchema = z.enum([
  'ACTIVE',
  'RENEWED',
  'EXPIRED',
  'CANCELED',
])

const contractFields = {
  name: z.string().trim().min(1, 'Informe o nome do contrato').max(200),
  companyId: z.string().min(1),
  opportunityId: z.string().nullable().optional(),
  ownerId: z.string().nullable().optional(),
  value: z.number().min(0).max(100_000_000_000).nullable().optional(),
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
  autoRenews: z.boolean().default(false),
  notes: z.string().trim().max(2000).nullable().optional(),
}

export const CreateCrmContractSchema = z
  .object(contractFields)
  .refine((value) => value.endDate > value.startDate, {
    message: 'O fim do contrato deve ser depois do início',
    path: ['endDate'],
  })
export type CreateCrmContractDTO = z.infer<typeof CreateCrmContractSchema>

export const UpdateCrmContractSchema = z.object({
  name: contractFields.name.optional(),
  ownerId: contractFields.ownerId,
  value: contractFields.value,
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  autoRenews: z.boolean().optional(),
  status: CrmContractStatusSchema.optional(),
  notes: contractFields.notes,
})
export type UpdateCrmContractDTO = z.infer<typeof UpdateCrmContractSchema>

export const ListCrmContractsQuerySchema = z.object({
  status: CrmContractStatusSchema.optional(),
  companyId: z.string().optional(),
  /** Only contracts ending within this many days (and not ended yet). */
  endsWithinDays: z.coerce.number().int().min(1).max(730).optional(),
})
export type ListCrmContractsQuery = z.infer<typeof ListCrmContractsQuerySchema>
