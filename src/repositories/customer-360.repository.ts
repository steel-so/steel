import { Prisma } from '@prisma/client'
import { phoneMatchKey, waIdCandidates } from '@/src/lib/pabx/recording'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { normalizeDocument } from '@/src/lib/servicedesk/document'
import type { Customer360MatchDTO } from '@/types/customer-360'
import { dbError } from './db-error'

/**
 * Read-only joins behind the "Visão 360". CRM, ServiceDesk and WhatsApp keep
 * independent tables with no foreign key between them, so the link is
 * resolved here. A stored link (ADR 0066: `SdCustomer.crmCompanyId`,
 * `SdContact.crmPersonId`, `WhatsAppContact.crmPersonId`) always wins; only
 * when there is none does the text matching apply: phone key (DDD + last 8
 * digits), CNPJ, e-mail and exact name. The whole matching sits behind
 * `resolveIdentity`, so callers never see which path found the customer.
 */

const SECTION_LIMIT = 15
const SD_TICKET_LIMIT = 15

const personSelect = {
  id: true,
  name: true,
  jobTitle: true,
  emails: true,
  phones: true,
  companyId: true,
} satisfies Prisma.CrmPersonSelect

const companySelect = {
  id: true,
  name: true,
  cnpj: true,
  arr: true,
  accountOwnerId: true,
  accountOwner: { select: { name: true } },
} satisfies Prisma.CrmCompanySelect

export type Customer360PersonRow = Prisma.CrmPersonGetPayload<{
  select: typeof personSelect
}>
export type Customer360CompanyRow = Prisma.CrmCompanyGetPayload<{
  select: typeof companySelect
}>

/** The anchors a caller can hand over (already authorized by the service). */
export interface Customer360Seed {
  personId?: string
  companyId?: string
  phone?: string
  sdCustomerId?: string
  sdContactId?: string
}

export interface Customer360Identity {
  person: Customer360PersonRow | null
  company: Customer360CompanyRow | null
  /** `SdCustomer` ids that stand for the same company (CNPJ or exact name). */
  sdCustomerIds: string[]
  /** `SdContact` ids that stand for the same person (e-mail or phone). */
  sdContactIds: string[]
  /** Every phone known for the customer, to find WhatsApp contacts and leads. */
  phones: string[]
  emails: string[]
  match: Customer360MatchDTO
}

const NATIONAL = (column: Prisma.Sql) => Prisma.sql`
  CASE
    WHEN regexp_replace(${column}, '\\D', '', 'g') LIKE '55%'
      AND length(regexp_replace(${column}, '\\D', '', 'g')) IN (12, 13)
    THEN substr(regexp_replace(${column}, '\\D', '', 'g'), 3)
    ELSE regexp_replace(${column}, '\\D', '', 'g')
  END`

/** Ids of the non-deleted rows of `crm_people`/`crm_leads` that own the phone. */
async function idsByPhoneKey(
  table: 'crm_people' | 'crm_leads',
  workspaceId: string,
  key: string,
): Promise<string[]> {
  const from = Prisma.raw(table)
  const rows = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT t.id
    FROM ${from} t
    WHERE t.workspace_id = ${workspaceId}
      AND t.deleted_at IS NULL
      AND EXISTS (
        SELECT 1
        FROM unnest(t.phones) AS phone
        WHERE length(${NATIONAL(Prisma.sql`phone`)}) IN (10, 11)
          AND left(${NATIONAL(Prisma.sql`phone`)}, 2)
              || right(${NATIONAL(Prisma.sql`phone`)}, 8) = ${key}
      )
    ORDER BY t.updated_at DESC
    LIMIT ${SECTION_LIMIT}
  `)
  return rows.map((row) => row.id)
}

async function companyByDocument(
  workspaceId: string,
  document: string,
): Promise<string | null> {
  const rows = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT id FROM crm_companies
    WHERE workspace_id = ${workspaceId}
      AND deleted_at IS NULL
      AND cnpj IS NOT NULL
      AND regexp_replace(cnpj, '\\D', '', 'g') = ${document}
    ORDER BY updated_at DESC
    LIMIT 1
  `)
  return rows[0]?.id ?? null
}

const uniq = <T>(values: T[]): T[] => [...new Set(values)]

export const Customer360Repository = {
  /**
   * Works out who the customer is from the seeds: person first, then phone,
   * then the ServiceDesk customer / contact; the company comes from the
   * person, the seed or the ServiceDesk customer's CNPJ / name.
   */
  async resolveIdentity(
    workspaceId: string,
    seed: Customer360Seed,
  ): Promise<Result<Customer360Identity>> {
    try {
      let match: Customer360MatchDTO = 'none'
      let person: Customer360PersonRow | null = null
      let company: Customer360CompanyRow | null = null
      const sdCustomerIds: string[] = []
      const sdContactIds: string[] = []
      const phones: string[] = []
      const emails: string[] = []

      const loadPerson = (personId: string) =>
        prisma.crmPerson.findFirst({
          where: { id: personId, workspaceId, deletedAt: null },
          select: personSelect,
        })
      const loadCompany = (companyId: string) =>
        prisma.crmCompany.findFirst({
          where: { id: companyId, workspaceId, deletedAt: null },
          select: companySelect,
        })

      if (seed.personId) {
        person = await loadPerson(seed.personId)
        if (person) match = 'person'
      }

      if (!person && seed.phone) {
        const key = phoneMatchKey(seed.phone)
        // A WhatsApp contact linked to a person wins over the phone key.
        const waIds = uniq([
          ...waIdCandidates(seed.phone),
          seed.phone.replace(/\D/g, ''),
        ]).filter(Boolean)
        const linked = waIds.length
          ? await prisma.whatsAppContact.findFirst({
              where: {
                workspaceId,
                waId: { in: waIds },
                crmPersonId: { not: null },
              },
              select: { crmPersonId: true },
              orderBy: { updatedAt: 'desc' },
            })
          : null
        if (linked?.crmPersonId) {
          person = await loadPerson(linked.crmPersonId)
          if (person) match = 'link'
        }
        if (!person && key) {
          const [personId] = await idsByPhoneKey('crm_people', workspaceId, key)
          if (personId) {
            person = await loadPerson(personId)
            if (person) match = 'phone'
          }
        }
        phones.push(seed.phone)
      }

      let sdCustomer: {
        id: string
        name: string
        document: string | null
        crmCompanyId: string | null
      } | null = null
      if (seed.sdCustomerId) {
        sdCustomer = await prisma.sdCustomer.findFirst({
          where: { id: seed.sdCustomerId, workspaceId, deletedAt: null },
          select: {
            id: true,
            name: true,
            document: true,
            crmCompanyId: true,
          },
        })
        if (sdCustomer) sdCustomerIds.push(sdCustomer.id)
      }

      if (seed.sdContactId) {
        const contact = await prisma.sdContact.findFirst({
          where: { id: seed.sdContactId, workspaceId, deletedAt: null },
          select: {
            id: true,
            email: true,
            phone: true,
            whatsapp: true,
            crmPersonId: true,
          },
        })
        if (contact) {
          sdContactIds.push(contact.id)
          if (contact.email) emails.push(contact.email)
          for (const value of [contact.whatsapp, contact.phone]) {
            if (value) phones.push(value)
          }
          if (!person && contact.crmPersonId) {
            person = await loadPerson(contact.crmPersonId)
            if (person) match = 'link'
          }
          if (!person && contact.email) {
            const email = contact.email.trim()
            const byEmail = await prisma.crmPerson.findFirst({
              where: {
                workspaceId,
                deletedAt: null,
                emails: { hasSome: uniq([email, email.toLowerCase()]) },
              },
              select: personSelect,
              orderBy: { updatedAt: 'desc' },
            })
            if (byEmail) {
              person = byEmail
              match = 'email'
            }
          }
          if (!person) {
            for (const value of [contact.whatsapp, contact.phone]) {
              const key = value ? phoneMatchKey(value) : null
              if (!key) continue
              const [personId] = await idsByPhoneKey(
                'crm_people',
                workspaceId,
                key,
              )
              if (personId) {
                person = await loadPerson(personId)
                if (person) {
                  match = 'phone'
                  break
                }
              }
            }
          }
        }
      }

      const companyId = person?.companyId ?? seed.companyId
      if (companyId) {
        company = await loadCompany(companyId)
        if (company && match === 'none') match = 'company'
      }

      if (!company && sdCustomer?.crmCompanyId) {
        company = await loadCompany(sdCustomer.crmCompanyId)
        if (company) match = 'link'
      }

      if (!company && sdCustomer) {
        const document = sdCustomer.document
          ? normalizeDocument(sdCustomer.document)
          : ''
        const byDocument = document
          ? await companyByDocument(workspaceId, document)
          : null
        if (byDocument) {
          company = await loadCompany(byDocument)
          if (company) match = 'cnpj'
        }
        if (!company && sdCustomer.name.trim()) {
          company = await prisma.crmCompany.findFirst({
            where: {
              workspaceId,
              deletedAt: null,
              name: { equals: sdCustomer.name.trim(), mode: 'insensitive' },
            },
            select: companySelect,
            orderBy: { updatedAt: 'desc' },
          })
          if (company) match = 'name'
        }
      }

      if (company) {
        const document = company.cnpj ? normalizeDocument(company.cnpj) : ''
        // Linked to this company always counts; text matching only for the
        // customers that have no link (one linked elsewhere is not ours).
        const matchers: Prisma.SdCustomerWhereInput[] = []
        if (document) matchers.push({ document })
        if (company.name.trim()) {
          matchers.push({
            name: { equals: company.name.trim(), mode: 'insensitive' },
          })
        }
        const customerWhere: Prisma.SdCustomerWhereInput[] = [
          { crmCompanyId: company.id },
        ]
        if (matchers.length > 0) {
          customerWhere.push({ crmCompanyId: null, OR: matchers })
        }
        const customers = await prisma.sdCustomer.findMany({
          where: {
            workspaceId,
            deletedAt: null,
            OR: customerWhere,
          },
          select: { id: true },
          take: SECTION_LIMIT,
        })
        sdCustomerIds.push(...customers.map((customer) => customer.id))
      }

      if (person) {
        phones.push(...person.phones)
        emails.push(...person.emails)
        const email = person.emails[0]
        const contactWhere: Prisma.SdContactWhereInput[] = [
          { crmPersonId: person.id },
        ]
        if (email) {
          contactWhere.push({
            crmPersonId: null,
            email: { equals: email.trim(), mode: 'insensitive' },
          })
        }
        const contacts = await prisma.sdContact.findMany({
          where: {
            workspaceId,
            deletedAt: null,
            OR: contactWhere,
          },
          select: { id: true },
          take: SECTION_LIMIT,
        })
        sdContactIds.push(...contacts.map((contact) => contact.id))
      }

      return ok({
        person,
        company,
        sdCustomerIds: uniq(sdCustomerIds),
        sdContactIds: uniq(sdContactIds),
        phones: uniq(phones),
        emails: uniq(emails),
        match,
      })
    } catch (error) {
      return err(dbError('Failed to resolve the customer identity', error))
    }
  },

  /** Seeds taken from a ServiceDesk ticket (customer, company and contact). */
  async ticketAnchors(
    workspaceId: string,
    ticketId: string,
  ): Promise<
    Result<{
      sdCustomerId?: string
      sdContactId?: string
      conversationId: string | null
    } | null>
  > {
    try {
      const ticket = await prisma.sdTicket.findFirst({
        where: { id: ticketId, workspaceId, deletedAt: null },
        select: {
          customerId: true,
          companyId: true,
          contactId: true,
          whatsappConversationId: true,
        },
      })
      if (!ticket) return ok(null)
      return ok({
        sdCustomerId: ticket.companyId ?? ticket.customerId ?? undefined,
        sdContactId: ticket.contactId ?? undefined,
        conversationId: ticket.whatsappConversationId,
      })
    } catch (error) {
      return err(dbError('Failed to read the ticket anchors', error))
    }
  },

  /** Phone (`waId`) of a conversation's contact, for the zap side panel. */
  async conversationPhone(
    workspaceId: string,
    conversationId: string,
  ): Promise<Result<string | null>> {
    try {
      const conversation = await prisma.whatsAppConversation.findFirst({
        where: { id: conversationId, workspaceId, deletedAt: null },
        select: { contact: { select: { waId: true } } },
      })
      return ok(conversation?.contact.waId ?? null)
    } catch (error) {
      return err(dbError('Failed to read the conversation phone', error))
    }
  },

  async listOpportunities(
    workspaceId: string,
    identity: Pick<Customer360Identity, 'person' | 'company'>,
  ) {
    const anchors: Prisma.CrmOpportunityWhereInput[] = []
    if (identity.company) anchors.push({ companyId: identity.company.id })
    if (identity.person) anchors.push({ pointOfContactId: identity.person.id })
    try {
      const rows = await prisma.crmOpportunity.findMany({
        where: { workspaceId, deletedAt: null, OR: anchors },
        select: {
          id: true,
          name: true,
          amount: true,
          closeDate: true,
          updatedAt: true,
          stage: { select: { name: true, category: true } },
          pipeline: { select: { name: true } },
          owner: { select: { name: true } },
        },
        orderBy: { updatedAt: 'desc' },
        take: SECTION_LIMIT,
      })
      return ok(rows)
    } catch (error) {
      return err(dbError('Failed to list the customer opportunities', error))
    }
  },

  /** Open leads that share a phone or e-mail with the customer. */
  async listLeads(
    workspaceId: string,
    identity: Pick<Customer360Identity, 'phones' | 'emails'>,
  ) {
    try {
      const ids = new Set<string>()
      for (const phone of identity.phones) {
        const key = phoneMatchKey(phone)
        if (!key) continue
        for (const id of await idsByPhoneKey('crm_leads', workspaceId, key)) {
          ids.add(id)
        }
      }
      const emails = uniq(
        identity.emails.flatMap((email) => [email, email.toLowerCase()]),
      )
      const anchors: Prisma.CrmLeadWhereInput[] = []
      if (ids.size > 0) anchors.push({ id: { in: [...ids] } })
      if (emails.length > 0) anchors.push({ emails: { hasSome: emails } })
      const where: Prisma.CrmLeadWhereInput = {
        workspaceId,
        deletedAt: null,
        convertedPersonId: null,
        closedAt: null,
        OR: anchors,
      }
      const rows = await prisma.crmLead.findMany({
        where,
        select: {
          id: true,
          name: true,
          stage: true,
          createdAt: true,
          owner: { select: { name: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: SECTION_LIMIT,
      })
      return ok(rows)
    } catch (error) {
      return err(dbError('Failed to list the customer leads', error))
    }
  },

  async listTickets(
    workspaceId: string,
    identity: Pick<Customer360Identity, 'sdCustomerIds' | 'sdContactIds'>,
    conversationId: string | null,
  ) {
    const anchors: Prisma.SdTicketWhereInput[] = []
    if (identity.sdCustomerIds.length > 0) {
      anchors.push(
        { customerId: { in: identity.sdCustomerIds } },
        { companyId: { in: identity.sdCustomerIds } },
      )
    }
    if (identity.sdContactIds.length > 0) {
      anchors.push({ contactId: { in: identity.sdContactIds } })
    }
    if (conversationId) anchors.push({ whatsappConversationId: conversationId })
    try {
      const where: Prisma.SdTicketWhereInput = {
        workspaceId,
        deletedAt: null,
        OR: anchors,
      }
      const [rows, open] = await Promise.all([
        prisma.sdTicket.findMany({
          where,
          select: {
            id: true,
            number: true,
            title: true,
            type: true,
            createdAt: true,
            closedAt: true,
            resolvedAt: true,
            resolutionDueAt: true,
            resolutionBreached: true,
            firstResponseBreached: true,
            csatScore: true,
            phase: { select: { name: true, category: true } },
            priority: { select: { name: true } },
          },
          orderBy: { createdAt: 'desc' },
          take: SD_TICKET_LIMIT,
        }),
        prisma.sdTicket.count({
          where: { ...where, closedAt: null, resolvedAt: null },
        }),
      ])
      return ok({ rows, open })
    } catch (error) {
      return err(dbError('Failed to list the customer tickets', error))
    }
  },

  /** Conversations with the customer's phones (visibility is applied later). */
  async listConversations(
    workspaceId: string,
    identity: Pick<Customer360Identity, 'phones'>,
  ) {
    const waIds = uniq(
      identity.phones.flatMap((phone) => waIdCandidates(phone)),
    )
    try {
      const rows = await prisma.whatsAppConversation.findMany({
        where: {
          workspaceId,
          deletedAt: null,
          contact: { waId: { in: waIds } },
        },
        select: {
          id: true,
          status: true,
          assignedUserId: true,
          teamId: true,
          lastMessageAt: true,
          contact: { select: { name: true, waId: true } },
          connection: { select: { label: true } },
        },
        orderBy: { lastMessageAt: { sort: 'desc', nulls: 'last' } },
        take: SECTION_LIMIT * 2,
      })
      return ok(rows)
    } catch (error) {
      return err(dbError('Failed to list the customer conversations', error))
    }
  },

  async listCalls(
    workspaceId: string,
    identity: Pick<Customer360Identity, 'person'>,
    opportunityIds: string[],
  ) {
    const anchors: Prisma.WhatsAppPhoneCallWhereInput[] = []
    if (identity.person) anchors.push({ crmPersonId: identity.person.id })
    if (opportunityIds.length > 0) {
      anchors.push({ crmOpportunityId: { in: opportunityIds } })
    }
    try {
      const rows = await prisma.whatsAppPhoneCall.findMany({
        where: { workspaceId, OR: anchors },
        select: {
          id: true,
          direction: true,
          status: true,
          durationSeconds: true,
          summary: true,
          conversationId: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: SECTION_LIMIT,
      })
      return ok(rows)
    } catch (error) {
      return err(dbError('Failed to list the customer calls', error))
    }
  },

  async listDocuments(
    workspaceId: string,
    identity: Pick<Customer360Identity, 'person' | 'company'>,
    opportunityIds: string[],
  ) {
    const anchors: Prisma.DocumentWhereInput[] = []
    if (identity.company) anchors.push({ companyId: identity.company.id })
    if (identity.person) anchors.push({ personId: identity.person.id })
    if (opportunityIds.length > 0) {
      anchors.push({ opportunityId: { in: opportunityIds } })
    }
    try {
      const rows = await prisma.document.findMany({
        where: {
          workspaceId,
          deletedAt: null,
          isTemplate: false,
          OR: anchors,
        },
        select: {
          id: true,
          title: true,
          kind: true,
          status: true,
          totalValue: true,
          updatedAt: true,
        },
        orderBy: { updatedAt: 'desc' },
        take: SECTION_LIMIT,
      })
      return ok(rows)
    } catch (error) {
      return err(dbError('Failed to list the customer documents', error))
    }
  },

  async getHealth(workspaceId: string, companyId: string) {
    try {
      const row = await prisma.crmCustomerHealth.findFirst({
        where: { workspaceId, companyId },
        select: {
          riskScore: true,
          level: true,
          nextAction: true,
          computedAt: true,
        },
      })
      return ok(row)
    } catch (error) {
      return err(dbError('Failed to read the customer health', error))
    }
  },

  /**
   * Phone to dial for a record: the explicit one when it belongs to the
   * record, else the first usable phone of the person, the deal's point of
   * contact or the company's first contact with a phone.
   */
  async phoneTargets(
    workspaceId: string,
    target: { personId?: string; companyId?: string; opportunityId?: string },
  ): Promise<Result<{ name: string; phones: string[] } | null>> {
    try {
      let personId = target.personId
      let companyId = target.companyId
      if (!personId && target.opportunityId) {
        const deal = await prisma.crmOpportunity.findFirst({
          where: { id: target.opportunityId, workspaceId, deletedAt: null },
          select: { pointOfContactId: true, companyId: true },
        })
        if (!deal) return ok(null)
        personId = deal.pointOfContactId ?? undefined
        companyId = companyId ?? deal.companyId ?? undefined
      }
      if (personId) {
        const person = await prisma.crmPerson.findFirst({
          where: { id: personId, workspaceId, deletedAt: null },
          select: { name: true, phones: true },
        })
        if (person && person.phones.length > 0) return ok(person)
        if (!companyId && !person) return ok(null)
        if (person && !companyId) return ok(person)
      }
      if (companyId) {
        const people = await prisma.crmPerson.findMany({
          where: {
            workspaceId,
            companyId,
            deletedAt: null,
            NOT: { phones: { isEmpty: true } },
          },
          select: { name: true, phones: true },
          orderBy: { updatedAt: 'desc' },
          take: 1,
        })
        if (people[0]) return ok(people[0])
        const company = await prisma.crmCompany.findFirst({
          where: { id: companyId, workspaceId, deletedAt: null },
          select: { name: true },
        })
        return ok(company ? { name: company.name, phones: [] } : null)
      }
      return ok(null)
    } catch (error) {
      return err(dbError('Failed to read the phones of the record', error))
    }
  },
}
