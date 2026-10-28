import {
  type CrmNewsletterSubscriber,
  type CrmNewsletterSubscriberSource,
  type CrmNewsletterSubscriberStatus,
  Prisma,
} from '@prisma/client'
import {
  crmNewsletterSubscriberExists,
  crmNewsletterSubscriberNotFound,
} from '@/src/errors'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import type { ListCrmNewsletterSubscribersQuery } from '@/src/schemas/crm-newsletter.schema'
import { dbError } from './db-error'

/** Rows per `IN (...)`/`createMany` call: stays far from the 32k bind
 * parameter limit of Postgres for a 50k-row import. */
const CHUNK = 2_000

function chunks<T>(items: T[]): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += CHUNK) {
    out.push(items.slice(i, i + CHUNK))
  }
  return out
}

export type CrmNewsletterSubscriberWrite = {
  name?: string | null
  personId?: string | null
  status?: CrmNewsletterSubscriberStatus
  source?: CrmNewsletterSubscriberSource
  sourceRef?: string | null
  consentAt?: Date | null
  consentIp?: string | null
  consentUserAgent?: string | null
  consentText?: string | null
  confirmSentAt?: Date | null
  confirmedAt?: Date | null
  unsubscribedAt?: Date | null
  unsubscribeReason?: string | null
}

export type CrmNewsletterSubscriberCreate = CrmNewsletterSubscriberWrite & {
  newsletterId: string
  workspaceId: string
  email: string
  source: CrmNewsletterSubscriberSource
}

export type CrmNewsletterSubscriberWithNewsletter = CrmNewsletterSubscriber & {
  newsletter: {
    id: string
    name: string
    slug: string
    status: 'ACTIVE' | 'ARCHIVED'
    doubleOptIn: boolean
    fromName: string
    fromEmail: string
    replyTo: string | null
    deletedAt: Date | null
    workspace: { id: string; slug: string; name: string }
  }
}

const withNewsletter = {
  newsletter: {
    select: {
      id: true,
      name: true,
      slug: true,
      status: true,
      doubleOptIn: true,
      fromName: true,
      fromEmail: true,
      replyTo: true,
      deletedAt: true,
      workspace: { select: { id: true, slug: true, name: true } },
    },
  },
} as const

const isUniqueViolation = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  error.code === 'P2002'

/**
 * Subscribers of a CRM newsletter (ADR 0054): one row per newsletter ×
 * lower-case e-mail, with the consent evidence.
 */
export const CrmNewsletterSubscriberRepository = {
  async list(
    newsletterId: string,
    query: ListCrmNewsletterSubscribersQuery,
  ): Promise<Result<{ items: CrmNewsletterSubscriber[]; total: number }>> {
    const where: Prisma.CrmNewsletterSubscriberWhereInput = {
      newsletterId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.source ? { source: query.source } : {}),
      ...(query.search
        ? {
            OR: [
              { email: { contains: query.search, mode: 'insensitive' } },
              { name: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    }
    try {
      const [items, total] = await Promise.all([
        prisma.crmNewsletterSubscriber.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        prisma.crmNewsletterSubscriber.count({ where }),
      ])
      return ok({ items, total })
    } catch (error) {
      return err(dbError('Failed to list CRM newsletter subscribers', error))
    }
  },

  /** Every row of a newsletter, oldest first (CSV export). */
  async listAll(
    newsletterId: string,
  ): Promise<Result<CrmNewsletterSubscriber[]>> {
    try {
      const rows = await prisma.crmNewsletterSubscriber.findMany({
        where: { newsletterId },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      })
      return ok(rows)
    } catch (error) {
      return err(dbError('Failed to export CRM newsletter subscribers', error))
    }
  },

  async findById(
    id: string,
    newsletterId: string,
  ): Promise<Result<CrmNewsletterSubscriber>> {
    try {
      const row = await prisma.crmNewsletterSubscriber.findFirst({
        where: { id, newsletterId },
      })
      if (!row) return err(crmNewsletterSubscriberNotFound())
      return ok(row)
    } catch (error) {
      return err(dbError('Failed to find CRM newsletter subscriber', error))
    }
  },

  /** Public flows (signed tokens): the row plus its newsletter/workspace. */
  async findWithNewsletter(
    id: string,
  ): Promise<Result<CrmNewsletterSubscriberWithNewsletter | null>> {
    try {
      const row = await prisma.crmNewsletterSubscriber.findUnique({
        where: { id },
        include: withNewsletter,
      })
      return ok(row as CrmNewsletterSubscriberWithNewsletter | null)
    } catch (error) {
      return err(dbError('Failed to find CRM newsletter subscriber', error))
    }
  },

  async findByEmail(
    newsletterId: string,
    email: string,
  ): Promise<Result<CrmNewsletterSubscriber | null>> {
    try {
      const row = await prisma.crmNewsletterSubscriber.findUnique({
        where: { newsletterId_email: { newsletterId, email } },
      })
      return ok(row)
    } catch (error) {
      return err(dbError('Failed to find CRM newsletter subscriber', error))
    }
  },

  async findByEmails(
    newsletterId: string,
    emails: string[],
  ): Promise<Result<CrmNewsletterSubscriber[]>> {
    try {
      const rows: CrmNewsletterSubscriber[] = []
      for (const part of chunks(emails)) {
        rows.push(
          ...(await prisma.crmNewsletterSubscriber.findMany({
            where: { newsletterId, email: { in: part } },
          })),
        )
      }
      return ok(rows)
    } catch (error) {
      return err(dbError('Failed to find CRM newsletter subscribers', error))
    }
  },

  /** Every subscription of one address in a workspace (preference center). */
  async listByWorkspaceEmail(
    workspaceId: string,
    email: string,
  ): Promise<Result<CrmNewsletterSubscriber[]>> {
    try {
      const rows = await prisma.crmNewsletterSubscriber.findMany({
        where: { workspaceId, email },
      })
      return ok(rows)
    } catch (error) {
      return err(dbError('Failed to list CRM newsletter subscriptions', error))
    }
  },

  async create(
    data: CrmNewsletterSubscriberCreate,
  ): Promise<Result<CrmNewsletterSubscriber>> {
    try {
      const row = await prisma.crmNewsletterSubscriber.create({ data })
      return ok(row)
    } catch (error) {
      if (isUniqueViolation(error)) return err(crmNewsletterSubscriberExists())
      return err(dbError('Failed to create CRM newsletter subscriber', error))
    }
  },

  /** Bulk insert (import); rows already there are skipped. */
  async createMany(
    rows: CrmNewsletterSubscriberCreate[],
  ): Promise<Result<number>> {
    try {
      let created = 0
      for (const part of chunks(rows)) {
        const result = await prisma.crmNewsletterSubscriber.createMany({
          data: part,
          skipDuplicates: true,
        })
        created += result.count
      }
      return ok(created)
    } catch (error) {
      return err(dbError('Failed to import CRM newsletter subscribers', error))
    }
  },

  async update(
    id: string,
    data: CrmNewsletterSubscriberWrite,
  ): Promise<Result<CrmNewsletterSubscriber>> {
    try {
      const row = await prisma.crmNewsletterSubscriber.update({
        where: { id },
        data,
      })
      return ok(row)
    } catch (error) {
      return err(dbError('Failed to update CRM newsletter subscriber', error))
    }
  },

  /** Same change on many rows (import reactivation, "sair de tudo"). */
  async updateMany(
    ids: string[],
    data: CrmNewsletterSubscriberWrite,
  ): Promise<Result<number>> {
    try {
      let count = 0
      for (const part of chunks(ids)) {
        const result = await prisma.crmNewsletterSubscriber.updateMany({
          where: { id: { in: part } },
          data,
        })
        count += result.count
      }
      return ok(count)
    } catch (error) {
      return err(dbError('Failed to update CRM newsletter subscribers', error))
    }
  },

  /** Hard delete (LGPD removal); delivery rows go with it (cascade). */
  async delete(id: string): Promise<Result<void>> {
    try {
      await prisma.crmNewsletterSubscriber.delete({ where: { id } })
      return ok(undefined)
    } catch (error) {
      return err(dbError('Failed to delete CRM newsletter subscriber', error))
    }
  },

  /**
   * CRM person ids by lower-case e-mail (oldest person wins). Links a
   * subscriber to the person; never creates people.
   */
  async personIdsByEmails(
    workspaceId: string,
    emails: string[],
  ): Promise<Result<Map<string, string>>> {
    const map = new Map<string, string>()
    if (emails.length === 0) return ok(map)
    try {
      const rows = await prisma.$queryRaw<{ email: string; id: string }[]>`
        SELECT DISTINCT ON (lower(trim(e))) lower(trim(e)) AS email, p.id
        FROM crm_people p, unnest(p.emails) e
        WHERE p.workspace_id = ${workspaceId}
          AND p.deleted_at IS NULL
          AND lower(trim(e)) = ANY(${emails}::text[])
        ORDER BY lower(trim(e)), p.created_at ASC
      `
      for (const row of rows) map.set(row.email, row.id)
      return ok(map)
    } catch (error) {
      return err(dbError('Failed to match CRM people by e-mail', error))
    }
  },

  /** Unsubscribe from an issue footer: attribute it to the delivery row. */
  async markRecipientUnsubscribed(
    recipientId: string,
    subscriberId: string,
    at: Date,
  ): Promise<Result<void>> {
    try {
      await prisma.crmNewsletterIssueRecipient.updateMany({
        where: { id: recipientId, subscriberId, unsubscribedAt: null },
        data: { unsubscribedAt: at },
      })
      return ok(undefined)
    } catch (error) {
      return err(dbError('Failed to mark newsletter recipient', error))
    }
  },

  /** Lifts the workspace-wide opt-out when the person resubscribes from the
   * preference center (their own explicit choice). */
  async deleteWorkspaceOptOut(
    workspaceId: string,
    email: string,
  ): Promise<Result<void>> {
    try {
      await prisma.crmEmailOptOut.deleteMany({ where: { workspaceId, email } })
      return ok(undefined)
    } catch (error) {
      return err(dbError('Failed to delete CRM e-mail opt-out', error))
    }
  },

  async isOptedOut(
    workspaceId: string,
    email: string,
  ): Promise<Result<boolean>> {
    try {
      const count = await prisma.crmEmailOptOut.count({
        where: { workspaceId, email },
      })
      return ok(count > 0)
    } catch (error) {
      return err(dbError('Failed to check CRM e-mail opt-out', error))
    }
  },
}
