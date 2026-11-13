import type { SdTicketTypeDTO } from './sd-ticket'

export type SdTicketSourceKindDTO =
  | 'conversation'
  | 'lead'
  | 'person'
  | 'opportunity'

/** A ticket opened from (or linked to) a conversation or CRM record. */
export interface SdTicketSourceLinkDTO {
  id: string
  number: number
  code: string
  title: string
  type: SdTicketTypeDTO
  /** Phase name and whether the ticket is already done (resolved/closed). */
  phaseName: string
  phaseCategory: string
  open: boolean
  createdAt: string
  /** Internal path to open the ticket (`/<slug>/servicedesk/tickets/<n>`). */
  href: string
}

/** What the dialog shows before the ticket is created. */
export interface SdTicketSourcePrefillDTO {
  source: SdTicketSourceKindDTO
  sourceId: string
  /** Who the source is (contact, lead, person or deal name). */
  sourceLabel: string
  title: string
  /** Plain-text preview of what will go in the description. */
  descriptionPreview: string
  /** How many messages would be quoted. */
  messageCount: number
  requester: {
    name: string
    phone: string | null
    email: string | null
  }
  /** The ServiceDesk record the requester was matched to, if any. */
  contact: { id: string; name: string } | null
  customer: { id: string; name: string } | null
  /** Open tickets of the same source (the dialog warns before duplicating). */
  openTickets: SdTicketSourceLinkDTO[]
  /** Free-text replies on WhatsApp need a ServiceDesk-ready line. */
  connectionNote: string | null
}

export interface SdTicketSourceCreatedDTO {
  ticket: SdTicketSourceLinkDTO
  /** Whether the conversation was linked to the ticket (WhatsApp tab). */
  conversationLinked: boolean
}
