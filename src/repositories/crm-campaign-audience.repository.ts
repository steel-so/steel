import type { CrmLeadStage } from '@prisma/client'
import type { CampaignCandidate } from '@/src/lib/crm-campaign/audience'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'

/**
 * Reads the CRM sources of a campaign audience and the opt-outs of each
 * channel. Order matters for the dedupe (first candidate wins): mailing
 * list members linked to a person come first, then people, then leads.
 */
export const CrmCampaignAudienceRepository = {
  async collectCandidates(
    workspaceId: string,
    audience: {
      mailingListIds: string[]
      allPeople: boolean
      leadStages: CrmLeadStage[]
    },
  ): Promise<Result<CampaignCandidate[]>> {
    try {
      const candidates: CampaignCandidate[] = []

      if (audience.mailingListIds.length > 0) {
        const members = await prisma.crmMailingListMember.findMany({
          where: {
            mailingListId: { in: audience.mailingListIds },
            mailingList: { workspaceId, deletedAt: null },
          },
          orderBy: { createdAt: 'asc' },
        })
        const personIds = members.flatMap((m) =>
          m.personId ? [m.personId] : [],
        )
        const people = personIds.length
          ? await prisma.crmPerson.findMany({
              where: { id: { in: personIds }, workspaceId, deletedAt: null },
              select: { id: true, name: true, phones: true },
            })
          : []
        const byId = new Map(people.map((p) => [p.id, p]))
        for (const member of members) {
          const person = member.personId ? byId.get(member.personId) : undefined
          candidates.push({
            personId: person?.id ?? null,
            name: person?.name ?? member.name ?? member.email,
            email: member.email,
            phone: person?.phones[0] ?? null,
          })
        }
      }

      if (audience.allPeople) {
        const people = await prisma.crmPerson.findMany({
          where: { workspaceId, deletedAt: null },
          select: { id: true, name: true, emails: true, phones: true },
          orderBy: { createdAt: 'asc' },
        })
        for (const person of people) {
          candidates.push({
            personId: person.id,
            name: person.name,
            email: person.emails[0] ?? null,
            phone: person.phones[0] ?? null,
          })
        }
      }

      if (audience.leadStages.length > 0) {
        const leads = await prisma.crmLead.findMany({
          where: {
            workspaceId,
            deletedAt: null,
            stage: { in: audience.leadStages },
          },
          select: {
            id: true,
            name: true,
            emails: true,
            phones: true,
            convertedPersonId: true,
          },
          orderBy: { createdAt: 'asc' },
        })
        for (const lead of leads) {
          candidates.push({
            // A converted lead is the same contact as its person.
            personId: lead.convertedPersonId,
            leadId: lead.id,
            name: lead.name,
            email: lead.emails[0] ?? null,
            phone: lead.phones[0] ?? null,
          })
        }
      }

      return ok(candidates)
    } catch (error) {
      return err(dbError('Failed to collect CRM campaign audience', error))
    }
  },

  /** E-mail opt-outs (CRM campaigns, LGPD) of the workspace. */
  async emailOptOuts(
    workspaceId: string,
  ): Promise<Result<{ emails: Set<string>; personIds: Set<string> }>> {
    try {
      const rows = await prisma.crmEmailOptOut.findMany({
        where: { workspaceId },
        select: { email: true, personId: true },
      })
      return ok({
        emails: new Set(rows.map((row) => row.email.trim().toLowerCase())),
        personIds: new Set(
          rows.flatMap((row) => (row.personId ? [row.personId] : [])),
        ),
      })
    } catch (error) {
      return err(dbError('Failed to read CRM e-mail opt-outs', error))
    }
  },

  /** WhatsApp numbers that answered SAIR/PARAR (broadcast opt-out). */
  async whatsappOptOuts(workspaceId: string): Promise<Result<Set<string>>> {
    try {
      const rows = await prisma.whatsAppContact.findMany({
        where: { workspaceId, broadcastOptedOutAt: { not: null } },
        select: { waId: true },
      })
      return ok(new Set(rows.map((row) => row.waId)))
    } catch (error) {
      return err(dbError('Failed to read WhatsApp opt-outs', error))
    }
  },

  async isWhatsAppOptedOut(
    workspaceId: string,
    waId: string,
  ): Promise<Result<boolean>> {
    try {
      const contact = await prisma.whatsAppContact.findUnique({
        where: { workspaceId_waId: { workspaceId, waId } },
        select: { broadcastOptedOutAt: true },
      })
      return ok(Boolean(contact?.broadcastOptedOutAt))
    } catch (error) {
      return err(dbError('Failed to read WhatsApp opt-out', error))
    }
  },

  async isEmailOptedOut(
    workspaceId: string,
    email: string,
    personId: string | null,
  ): Promise<Result<boolean>> {
    try {
      const found = await prisma.crmEmailOptOut.findFirst({
        where: {
          workspaceId,
          OR: [
            { email: email.trim().toLowerCase() },
            ...(personId ? [{ personId }] : []),
          ],
        },
        select: { id: true },
      })
      return ok(Boolean(found))
    } catch (error) {
      return err(dbError('Failed to read CRM e-mail opt-out', error))
    }
  },
}
