import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'

/** Who a list membership lookup is about. */
export type ListMembershipKey = { email: string; personId?: string | null }

/**
 * Mailing-list memberships behind the "Mostrar se: está na lista" content
 * of the e-mail editor (E3). A contact belongs to a list by its e-mail
 * address (case-insensitive) or by its CRM person.
 */
export const CrmEmailConditionRepository = {
  /**
   * Active (not deleted) lists of the workspace each contact belongs to,
   * keyed by lower-cased e-mail. Contacts in no list map to `[]`.
   */
  async findListMemberships(
    workspaceId: string,
    contacts: ListMembershipKey[],
  ): Promise<Result<Map<string, string[]>>> {
    const memberships = new Map<string, string[]>()
    const emails = [
      ...new Set(contacts.map((c) => c.email.trim().toLowerCase())),
    ].filter(Boolean)
    const personIds = [
      ...new Set(contacts.flatMap((c) => (c.personId ? [c.personId] : []))),
    ]
    for (const email of emails) memberships.set(email, [])
    if (emails.length === 0 && personIds.length === 0) return ok(memberships)
    try {
      const rows = await prisma.crmMailingListMember.findMany({
        where: {
          mailingList: { workspaceId, deletedAt: null },
          OR: [
            { email: { in: emails, mode: 'insensitive' } },
            ...(personIds.length > 0 ? [{ personId: { in: personIds } }] : []),
          ],
        },
        select: { mailingListId: true, email: true, personId: true },
      })
      for (const contact of contacts) {
        const email = contact.email.trim().toLowerCase()
        const lists = new Set(memberships.get(email) ?? [])
        for (const row of rows) {
          if (
            row.email.trim().toLowerCase() === email ||
            (contact.personId && row.personId === contact.personId)
          ) {
            lists.add(row.mailingListId)
          }
        }
        memberships.set(email, [...lists])
      }
      return ok(memberships)
    } catch (error) {
      return err(dbError('Failed to find CRM mailing list memberships', error))
    }
  },

  /** Lists of one CRM person (by the person or any of its e-mails). */
  async findPersonListIds(
    workspaceId: string,
    personId: string,
  ): Promise<Result<string[] | null>> {
    try {
      const person = await prisma.crmPerson.findFirst({
        where: { id: personId, workspaceId, deletedAt: null },
        select: { emails: true },
      })
      if (!person) return ok(null)
      const rows = await prisma.crmMailingListMember.findMany({
        where: {
          mailingList: { workspaceId, deletedAt: null },
          OR: [
            { personId },
            ...(person.emails.length > 0
              ? [{ email: { in: person.emails, mode: 'insensitive' as const } }]
              : []),
          ],
        },
        select: { mailingListId: true },
      })
      return ok([...new Set(rows.map((row) => row.mailingListId))])
    } catch (error) {
      return err(dbError('Failed to find CRM person mailing lists', error))
    }
  },
}
