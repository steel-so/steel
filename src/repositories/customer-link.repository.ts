import { Prisma } from '@prisma/client'
import { phoneMatchKey, waIdCandidates } from '@/src/lib/pabx/recording'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'

export interface LinkCompanyRow {
  id: string
  name: string
  cnpj: string | null
}

export interface LinkPersonRow {
  id: string
  name: string
  companyId: string | null
  emails: string[]
  phones: string[]
}

export interface LinkSdCustomerRow {
  id: string
  name: string
  document: string | null
  crmCompanyId: string | null
}

export interface LinkSdContactRow {
  id: string
  name: string
  email: string | null
  phone: string | null
  whatsapp: string | null
  crmPersonId: string | null
}

export interface LinkWhatsAppContactRow {
  id: string
  name: string | null
  waId: string
  crmPersonId: string | null
}

const COMPANY_SELECT = { id: true, name: true, cnpj: true } as const
const PERSON_SELECT = {
  id: true,
  name: true,
  companyId: true,
  emails: true,
  phones: true,
} as const

export function digitsOnly(value: string | null | undefined): string {
  return (value ?? '').replace(/\D/g, '')
}

/** Phone keys (DDD + last 8 digits) of a list of free-text phones. */
export function phoneKeys(phones: (string | null | undefined)[]): string[] {
  const keys = new Set<string>()
  for (const phone of phones) {
    const key = phone ? phoneMatchKey(phone) : null
    if (key) keys.add(key)
  }
  return [...keys]
}

/**
 * Reads and writes of the cadastro-unico links (ADR 0066). Every lookup is
 * scoped by workspace and ignores soft-deleted rows. "Fallback" lookups keep
 * the old text matching (CNPJ, exact name, e-mail, phone key) alive for
 * records that have no stored link.
 */
export const CustomerLinkRepository = {
  async findCompany(
    workspaceId: string,
    id: string,
  ): Promise<Result<LinkCompanyRow | null>> {
    try {
      return ok(
        await prisma.crmCompany.findFirst({
          where: { id, workspaceId, deletedAt: null },
          select: COMPANY_SELECT,
        }),
      )
    } catch (error) {
      return err(dbError('Failed to find a crm company for a link', error))
    }
  },

  async findCompanyByCnpj(
    workspaceId: string,
    cnpj: string,
  ): Promise<Result<LinkCompanyRow | null>> {
    try {
      const digits = digitsOnly(cnpj)
      if (digits.length !== 14) return ok(null)
      const rows = await prisma.$queryRaw<LinkCompanyRow[]>(Prisma.sql`
        SELECT id, name, cnpj
        FROM crm_companies
        WHERE workspace_id = ${workspaceId}
          AND deleted_at IS NULL
          AND cnpj IS NOT NULL
          AND regexp_replace(cnpj, '\\D', '', 'g') = ${digits}
        ORDER BY updated_at DESC
        LIMIT 1
      `)
      return ok(rows[0] ?? null)
    } catch (error) {
      return err(dbError('Failed to find a crm company by cnpj', error))
    }
  },

  async findPerson(
    workspaceId: string,
    id: string,
  ): Promise<Result<LinkPersonRow | null>> {
    try {
      return ok(
        await prisma.crmPerson.findFirst({
          where: { id, workspaceId, deletedAt: null },
          select: PERSON_SELECT,
        }),
      )
    } catch (error) {
      return err(dbError('Failed to find a crm person for a link', error))
    }
  },

  /** CRM people whose phones match one of the phone keys (most recent first). */
  async listPeopleByPhoneKeys(
    workspaceId: string,
    keys: string[],
    limit = 5,
  ): Promise<Result<LinkPersonRow[]>> {
    if (keys.length === 0) return ok([])
    try {
      const rows = await prisma.$queryRaw<
        {
          id: string
          name: string
          company_id: string | null
          emails: string[]
          phones: string[]
        }[]
      >(Prisma.sql`
        SELECT p.id, p.name, p.company_id, p.emails, p.phones
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
              AND left(n, 2) || right(n, 8) IN (${Prisma.join(keys)})
          )
        ORDER BY p.updated_at DESC
        LIMIT ${limit}
      `)
      return ok(
        rows.map((r) => ({
          id: r.id,
          name: r.name,
          companyId: r.company_id,
          emails: r.emails,
          phones: r.phones,
        })),
      )
    } catch (error) {
      return err(dbError('Failed to list crm people by phone', error))
    }
  },

  async listPeopleByEmail(
    workspaceId: string,
    email: string,
    limit = 5,
  ): Promise<Result<LinkPersonRow[]>> {
    try {
      const rows = await prisma.$queryRaw<
        {
          id: string
          name: string
          company_id: string | null
          emails: string[]
          phones: string[]
        }[]
      >(Prisma.sql`
        SELECT p.id, p.name, p.company_id, p.emails, p.phones
        FROM crm_people p
        WHERE p.workspace_id = ${workspaceId}
          AND p.deleted_at IS NULL
          AND EXISTS (
            SELECT 1 FROM unnest(p.emails) AS e WHERE lower(e) = lower(${email})
          )
        ORDER BY p.updated_at DESC
        LIMIT ${limit}
      `)
      return ok(
        rows.map((r) => ({
          id: r.id,
          name: r.name,
          companyId: r.company_id,
          emails: r.emails,
          phones: r.phones,
        })),
      )
    } catch (error) {
      return err(dbError('Failed to list crm people by e-mail', error))
    }
  },

  /** Companies with the same CNPJ or the same name (case-insensitive). */
  async listCompanyCandidates(
    workspaceId: string,
    input: { document: string | null; name: string },
  ): Promise<Result<(LinkCompanyRow & { byCnpj: boolean })[]>> {
    try {
      const document = digitsOnly(input.document)
      const rows = await prisma.$queryRaw<
        { id: string; name: string; cnpj: string | null; by_cnpj: boolean }[]
      >(Prisma.sql`
        SELECT id, name, cnpj,
          (cnpj IS NOT NULL AND ${document} <> ''
            AND regexp_replace(cnpj, '\\D', '', 'g') = ${document}) AS by_cnpj
        FROM crm_companies
        WHERE workspace_id = ${workspaceId}
          AND deleted_at IS NULL
          AND (
            (cnpj IS NOT NULL AND ${document} <> ''
              AND regexp_replace(cnpj, '\\D', '', 'g') = ${document})
            OR lower(name) = lower(${input.name.trim()})
          )
        ORDER BY by_cnpj DESC, updated_at DESC
        LIMIT 5
      `)
      return ok(
        rows.map((r) => ({
          id: r.id,
          name: r.name,
          cnpj: r.cnpj,
          byCnpj: r.by_cnpj,
        })),
      )
    } catch (error) {
      return err(dbError('Failed to list crm company candidates', error))
    }
  },

  // ---- ServiceDesk customers --------------------------------------------

  async findSdCustomer(
    workspaceId: string,
    id: string,
  ): Promise<Result<LinkSdCustomerRow | null>> {
    try {
      return ok(
        await prisma.sdCustomer.findFirst({
          where: { id, workspaceId, deletedAt: null },
          select: {
            id: true,
            name: true,
            document: true,
            crmCompanyId: true,
          },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to find a service desk customer', error))
    }
  },

  /** Customers linked to the company, or matching its CNPJ / exact name. */
  async listSdCustomersForCompany(
    workspaceId: string,
    company: LinkCompanyRow,
  ): Promise<Result<LinkSdCustomerRow[]>> {
    try {
      const document = digitsOnly(company.cnpj)
      const or: Prisma.SdCustomerWhereInput[] = [{ crmCompanyId: company.id }]
      // The fallback only applies to customers that have no stored link.
      const unlinked = { crmCompanyId: null }
      if (document.length === 14) or.push({ ...unlinked, document })
      if (company.name.trim()) {
        or.push({
          ...unlinked,
          name: { equals: company.name.trim(), mode: 'insensitive' },
        })
      }
      return ok(
        await prisma.sdCustomer.findMany({
          where: { workspaceId, deletedAt: null, OR: or },
          select: {
            id: true,
            name: true,
            document: true,
            crmCompanyId: true,
          },
          orderBy: { name: 'asc' },
          take: 20,
        }),
      )
    } catch (error) {
      return err(dbError('Failed to list service desk customers', error))
    }
  },

  // ---- ServiceDesk contacts ---------------------------------------------

  async findSdContact(
    workspaceId: string,
    id: string,
  ): Promise<Result<LinkSdContactRow | null>> {
    try {
      return ok(
        await prisma.sdContact.findFirst({
          where: { id, workspaceId, deletedAt: null },
          select: CONTACT_SELECT,
        }),
      )
    } catch (error) {
      return err(dbError('Failed to find a service desk contact', error))
    }
  },

  /** Contacts linked to the person, or matching an e-mail / phone key. */
  async listSdContactsForPerson(
    workspaceId: string,
    person: LinkPersonRow,
  ): Promise<Result<LinkSdContactRow[]>> {
    try {
      const keys = phoneKeys(person.phones)
      return await CustomerLinkRepository.listSdContacts(workspaceId, {
        personId: person.id,
        emails: person.emails,
        keys,
      })
    } catch (error) {
      return err(dbError('Failed to list service desk contacts', error))
    }
  },

  async listSdContacts(
    workspaceId: string,
    input: { personId: string | null; emails: string[]; keys: string[] },
  ): Promise<Result<LinkSdContactRow[]>> {
    try {
      const emails = input.emails.map((e) => e.toLowerCase()).filter(Boolean)
      const conditions: Prisma.Sql[] = []
      if (input.personId) {
        conditions.push(Prisma.sql`c.crm_person_id = ${input.personId}`)
      }
      if (emails.length > 0) {
        conditions.push(
          Prisma.sql`(c.crm_person_id IS NULL AND lower(c.email) IN (${Prisma.join(emails)}))`,
        )
      }
      if (input.keys.length > 0) {
        conditions.push(Prisma.sql`(
          c.crm_person_id IS NULL AND EXISTS (
            SELECT 1
            FROM (
              SELECT CASE
                WHEN d LIKE '55%' AND length(d) IN (12, 13) THEN substr(d, 3)
                ELSE d
              END AS n
              FROM (
                SELECT regexp_replace(raw, '\\D', '', 'g') AS d
                FROM unnest(ARRAY[c.whatsapp, c.phone]) AS raw
                WHERE raw IS NOT NULL
              ) digits
            ) national
            WHERE length(n) IN (10, 11)
              AND left(n, 2) || right(n, 8) IN (${Prisma.join(input.keys)})
          )
        )`)
      }
      if (conditions.length === 0) return ok([])
      const rows = await prisma.$queryRaw<
        {
          id: string
          name: string
          email: string | null
          phone: string | null
          whatsapp: string | null
          crm_person_id: string | null
        }[]
      >(Prisma.sql`
        SELECT c.id, c.name, c.email, c.phone, c.whatsapp, c.crm_person_id
        FROM sd_contacts c
        WHERE c.workspace_id = ${workspaceId}
          AND c.deleted_at IS NULL
          AND (${Prisma.join(conditions, ' OR ')})
        ORDER BY c.name ASC
        LIMIT 20
      `)
      return ok(
        rows.map((r) => ({
          id: r.id,
          name: r.name,
          email: r.email,
          phone: r.phone,
          whatsapp: r.whatsapp,
          crmPersonId: r.crm_person_id,
        })),
      )
    } catch (error) {
      return err(dbError('Failed to list service desk contacts', error))
    }
  },

  // ---- WhatsApp contacts --------------------------------------------------

  async findWhatsAppContact(
    workspaceId: string,
    id: string,
  ): Promise<Result<LinkWhatsAppContactRow | null>> {
    try {
      return ok(
        await prisma.whatsAppContact.findFirst({
          where: { id, workspaceId },
          select: WA_SELECT,
        }),
      )
    } catch (error) {
      return err(dbError('Failed to find a whatsapp contact', error))
    }
  },

  /** Contacts linked to the person, or whose `waId` is one of the phones. */
  async listWhatsAppContacts(
    workspaceId: string,
    input: { personId: string | null; phones: string[] },
  ): Promise<Result<LinkWhatsAppContactRow[]>> {
    try {
      const waIds = [...new Set(input.phones.flatMap(waIdCandidates))]
      const or: Prisma.WhatsAppContactWhereInput[] = []
      if (input.personId) or.push({ crmPersonId: input.personId })
      if (waIds.length > 0) or.push({ crmPersonId: null, waId: { in: waIds } })
      if (or.length === 0) return ok([])
      return ok(
        await prisma.whatsAppContact.findMany({
          where: { workspaceId, OR: or },
          select: WA_SELECT,
          orderBy: { updatedAt: 'desc' },
          take: 20,
        }),
      )
    } catch (error) {
      return err(dbError('Failed to list whatsapp contacts', error))
    }
  },

  // ---- Writes -------------------------------------------------------------

  /** Sets (or clears, with `null`) the link of a source record. */
  async setLink(
    workspaceId: string,
    kind: 'sd-customer' | 'sd-contact' | 'whatsapp-contact',
    id: string,
    targetId: string | null,
  ): Promise<Result<true>> {
    try {
      const where = { id, workspaceId }
      if (kind === 'sd-customer') {
        await prisma.sdCustomer.updateMany({
          where,
          data: { crmCompanyId: targetId },
        })
      } else if (kind === 'sd-contact') {
        await prisma.sdContact.updateMany({
          where,
          data: { crmPersonId: targetId },
        })
      } else {
        await prisma.whatsAppContact.updateMany({
          where,
          data: { crmPersonId: targetId },
        })
      }
      return ok(true)
    } catch (error) {
      return err(dbError('Failed to update a customer link', error))
    }
  },
}

const CONTACT_SELECT = {
  id: true,
  name: true,
  email: true,
  phone: true,
  whatsapp: true,
  crmPersonId: true,
} as const

const WA_SELECT = {
  id: true,
  name: true,
  waId: true,
  crmPersonId: true,
} as const
