import {
  formatSdTicketCode,
  type SdTicketPrefixes,
} from '@/src/lib/servicedesk/ticket-code'
import { isSourceTicketOpen } from '@/src/lib/servicedesk/ticket-source'
import type { SdLinkedTicketRow } from '@/src/repositories/sd-linked-ticket'
import type { SdTicketSourceLinkDTO } from '@/types/sd-ticket-source'

/** Ticket linked to a conversation or CRM record, as the lists show it. */
export function toSdTicketSourceLinkDTO(
  row: SdLinkedTicketRow,
  context: { prefixes: SdTicketPrefixes; slug: string },
): SdTicketSourceLinkDTO {
  return {
    id: row.id,
    number: row.number,
    code: formatSdTicketCode(row.type, row.number, context.prefixes),
    title: row.title,
    type: row.type,
    phaseName: row.phase.name,
    phaseCategory: row.phase.category,
    open: isSourceTicketOpen(row.phase.category),
    createdAt: row.createdAt.toISOString(),
    href: `/${context.slug}/servicedesk/tickets/${row.number}`,
  }
}
