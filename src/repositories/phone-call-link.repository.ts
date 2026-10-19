import { Prisma } from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'

/**
 * Records a call gets attached to besides its conversation (ADR 0043):
 * the ticket of the conversation, the CRM person with the same phone and
 * their open opportunity. Read-only lookups; the rule lives here so the
 * service only chains them.
 */
export const PhoneCallLinkRepository = {
  /** Latest ticket linked to the conversation, open ones first. */
  async findTicketForConversation(
    workspaceId: string,
    conversationId: string,
  ): Promise<Result<string | null>> {
    try {
      const ticket = await prisma.sdTicket.findFirst({
        where: {
          workspaceId,
          whatsappConversationId: conversationId,
          deletedAt: null,
        },
        orderBy: [
          { closedAt: { sort: 'desc', nulls: 'first' } },
          { createdAt: 'desc' },
        ],
        select: { id: true },
      })
      return ok(ticket?.id ?? null)
    } catch (error) {
      return err(dbError('Failed to find the ticket of a conversation', error))
    }
  },

  /**
   * Most recently updated CRM person with a phone matching `phoneKey`
   * (DDD + last 8 digits, see `phoneMatchKey`). The person's phones are
   * free text, so they are normalized the same way in SQL.
   */
  async findPersonByPhoneKey(
    workspaceId: string,
    phoneKey: string,
  ): Promise<Result<string | null>> {
    try {
      const rows = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
        SELECT p.id
        FROM crm_people p
        WHERE p.workspace_id = ${workspaceId}
          AND p.deleted_at IS NULL
          AND EXISTS (
            SELECT 1
            FROM (
              SELECT CASE
                WHEN d LIKE '55%' AND length(d) IN (12, 13) THEN substr(d, 3)
                ELSE d
              END AS n
              FROM (
                SELECT regexp_replace(phone, '\\D', '', 'g') AS d
                FROM unnest(p.phones) AS phone
              ) digits
            ) national
            WHERE length(n) IN (10, 11)
              AND left(n, 2) || right(n, 8) = ${phoneKey}
          )
        ORDER BY p.updated_at DESC
        LIMIT 1
      `)
      return ok(rows[0]?.id ?? null)
    } catch (error) {
      return err(dbError('Failed to find a crm person by phone', error))
    }
  },

  /** Latest open opportunity where the person is the point of contact. */
  async findOpenOpportunityForPerson(
    workspaceId: string,
    personId: string,
  ): Promise<Result<string | null>> {
    try {
      const opportunity = await prisma.crmOpportunity.findFirst({
        where: {
          workspaceId,
          pointOfContactId: personId,
          deletedAt: null,
          stage: { category: 'OPEN' },
        },
        orderBy: { updatedAt: 'desc' },
        select: { id: true },
      })
      return ok(opportunity?.id ?? null)
    } catch (error) {
      return err(
        dbError('Failed to find the open opportunity of a person', error),
      )
    }
  },
}
