import z from 'zod'
import { SdTicketTypeEnum } from '@/src/schemas/sd-rule.schema'

/**
 * Contract of "open a ticket from a conversation or CRM record"
 * (`/api/workspaces/[id]/servicedesk/tickets/from-source` and `.../by-source`).
 * Rules in `SdTicketSourceService` and `docs/servicedesk/README.md`.
 */

/** Where the ticket is opened from. */
export const SD_TICKET_SOURCE_KINDS = [
  'conversation',
  'lead',
  'person',
  'opportunity',
] as const

export type SdTicketSourceKind = (typeof SD_TICKET_SOURCE_KINDS)[number]

const sourceFields = {
  source: z.enum(SD_TICKET_SOURCE_KINDS),
  sourceId: z.string().trim().min(1).max(64),
}

/** Query of the preview (prefill) and of the linked-tickets listing. */
export const SdTicketSourceQuerySchema = z.object(sourceFields)

export type SdTicketSourceQueryDTO = z.infer<typeof SdTicketSourceQuerySchema>

/** Body of the creation. Everything but the source is optional (prefilled). */
export const CreateSdTicketFromSourceSchema = z.object({
  ...sourceFields,
  type: SdTicketTypeEnum.default('SERVICE_REQUEST'),
  title: z.string().trim().min(1, 'Título é obrigatório').max(200).optional(),
  /** Plain text the agent adds above the quoted messages. */
  note: z.string().trim().max(5000).optional(),
  /** Quote the last messages of the conversation in the description. */
  includeMessages: z.boolean().default(true),
  messageCount: z.number().int().min(1).max(30).default(10),
  /**
   * The source already has an open ticket: create another one anyway. Without
   * it the call answers `SD_TICKET_SOURCE_HAS_OPEN_TICKET`.
   */
  allowDuplicate: z.boolean().default(false),
  departmentId: z.string().trim().min(1).max(64).optional(),
})

export type CreateSdTicketFromSourceDTO = z.infer<
  typeof CreateSdTicketFromSourceSchema
>
