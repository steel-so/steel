import type { WhatsAppConnection, WhatsAppTemplate } from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'

export interface TicketRecipient {
  name: string
  phone: string | null
  email: string | null
  company: string | null
}

/** Reads used by the automation engines when they send a WhatsApp message. */
export const CrossEngineWhatsappRepository = {
  async findConnection(
    workspaceId: string,
    connectionId: string,
  ): Promise<Result<WhatsAppConnection | null>> {
    try {
      return ok(
        await prisma.whatsAppConnection.findFirst({
          where: { id: connectionId, workspaceId },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to find the WhatsApp connection', error))
    }
  },

  async findTemplate(
    workspaceId: string,
    connectionId: string,
    templateId: string,
  ): Promise<Result<WhatsAppTemplate | null>> {
    try {
      return ok(
        await prisma.whatsAppTemplate.findFirst({
          where: { id: templateId, workspaceId, connectionId },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to find the WhatsApp template', error))
    }
  },

  /** Last message the contact sent on this connection (24 h window). */
  async lastInboundAt(
    workspaceId: string,
    connectionId: string,
    waId: string,
  ): Promise<Result<Date | null>> {
    try {
      const row = await prisma.whatsAppMessage.findFirst({
        where: {
          direction: 'IN',
          deletedAt: null,
          conversation: { workspaceId, connectionId, contact: { waId } },
        },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      })
      return ok(row?.createdAt ?? null)
    } catch (error) {
      return err(dbError('Failed to read the last inbound message', error))
    }
  },

  /**
   * Who the ticket is about, as the automation needs to reach them: the SD
   * contact first, then the customer, then the company.
   */
  async ticketRecipient(
    workspaceId: string,
    ticketId: string,
  ): Promise<Result<TicketRecipient | null>> {
    try {
      const channel = {
        select: { name: true, email: true, phone: true, whatsapp: true },
      } as const
      const row = await prisma.sdTicket.findFirst({
        where: { id: ticketId, workspaceId },
        select: {
          contact: channel,
          customer: channel,
          company: channel,
        },
      })
      if (!row) return ok(null)
      const holder = [row.contact, row.customer, row.company].find(
        (item) => item && (item.whatsapp || item.phone || item.email),
      )
      if (!holder) return ok(null)
      return ok({
        name: holder.name,
        phone: holder.whatsapp ?? holder.phone,
        email: holder.email,
        company: row.company?.name ?? row.customer?.name ?? null,
      })
    } catch (error) {
      return err(dbError('Failed to read the ticket recipient', error))
    }
  },
}
