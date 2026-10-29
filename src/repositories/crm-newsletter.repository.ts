import {
  type CrmCampaignLegalBasis,
  type CrmNewsletter,
  type CrmNewsletterStatus,
  Prisma,
} from '@prisma/client'
import { crmNewsletterNotFound, crmNewsletterSlugTaken } from '@/src/errors'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'

/** Subscriber counts and last sent issue of a newsletter (list and DTO). */
export type CrmNewsletterStats = {
  active: number
  pending: number
  issuesSent: number
  lastIssueSentAt: Date | null
}

export const EMPTY_NEWSLETTER_STATS: CrmNewsletterStats = {
  active: 0,
  pending: 0,
  issuesSent: 0,
  lastIssueSentAt: null,
}

export type CrmNewsletterWrite = {
  name?: string
  slug?: string
  description?: string | null
  cadenceLabel?: string | null
  fromName?: string
  fromEmail?: string
  replyTo?: string | null
  sendingDomainId?: string | null
  templateId?: string | null
  doubleOptIn?: boolean
  legalBasis?: CrmCampaignLegalBasis
  archiveEnabled?: boolean
  status?: CrmNewsletterStatus
  updatedById?: string
}

export type CrmNewsletterWithWorkspace = CrmNewsletter & {
  workspace: { id: string; slug: string; name: string }
}

const isUniqueViolation = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  error.code === 'P2002'

/**
 * CRM newsletters (ADR 0054). Soft delete frees the slug (it is renamed),
 * so a new newsletter can reuse the public address.
 */
export const CrmNewsletterRepository = {
  async listByWorkspace(workspaceId: string): Promise<Result<CrmNewsletter[]>> {
    try {
      const rows = await prisma.crmNewsletter.findMany({
        where: { workspaceId, deletedAt: null },
        orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      })
      return ok(rows)
    } catch (error) {
      return err(dbError('Failed to list CRM newsletters', error))
    }
  },

  async findById(
    id: string,
    workspaceId: string,
  ): Promise<Result<CrmNewsletter>> {
    try {
      const row = await prisma.crmNewsletter.findFirst({
        where: { id, workspaceId, deletedAt: null },
      })
      if (!row) return err(crmNewsletterNotFound())
      return ok(row)
    } catch (error) {
      return err(dbError('Failed to find CRM newsletter', error))
    }
  },

  /** Any live newsletter by id with its workspace (public flows). */
  async findWithWorkspace(
    id: string,
  ): Promise<Result<CrmNewsletterWithWorkspace | null>> {
    try {
      const row = await prisma.crmNewsletter.findFirst({
        where: { id, deletedAt: null },
        include: {
          workspace: { select: { id: true, slug: true, name: true } },
        },
      })
      return ok(row)
    } catch (error) {
      return err(dbError('Failed to find CRM newsletter', error))
    }
  },

  /** Public subscribe: newsletter by workspace slug + newsletter slug. */
  async findBySlugs(
    workspaceSlug: string,
    newsletterSlug: string,
  ): Promise<Result<CrmNewsletterWithWorkspace | null>> {
    try {
      const row = await prisma.crmNewsletter.findFirst({
        where: {
          slug: newsletterSlug,
          deletedAt: null,
          workspace: { slug: workspaceSlug },
        },
        include: {
          workspace: { select: { id: true, slug: true, name: true } },
        },
      })
      return ok(row)
    } catch (error) {
      return err(dbError('Failed to find CRM newsletter by slug', error))
    }
  },

  async slugExists(
    workspaceId: string,
    slug: string,
    excludeId?: string,
  ): Promise<Result<boolean>> {
    try {
      const count = await prisma.crmNewsletter.count({
        where: {
          workspaceId,
          slug,
          ...(excludeId ? { id: { not: excludeId } } : {}),
        },
      })
      return ok(count > 0)
    } catch (error) {
      return err(dbError('Failed to check CRM newsletter slug', error))
    }
  },

  async create(
    data: CrmNewsletterWrite & {
      workspaceId: string
      createdById: string
      name: string
      slug: string
      fromName: string
      fromEmail: string
    },
  ): Promise<Result<CrmNewsletter>> {
    try {
      const row = await prisma.crmNewsletter.create({ data })
      return ok(row)
    } catch (error) {
      if (isUniqueViolation(error)) return err(crmNewsletterSlugTaken())
      return err(dbError('Failed to create CRM newsletter', error))
    }
  },

  async update(
    id: string,
    data: CrmNewsletterWrite,
  ): Promise<Result<CrmNewsletter>> {
    try {
      const row = await prisma.crmNewsletter.update({ where: { id }, data })
      return ok(row)
    } catch (error) {
      if (isUniqueViolation(error)) return err(crmNewsletterSlugTaken())
      return err(dbError('Failed to update CRM newsletter', error))
    }
  },

  /** Soft delete; the slug gets a suffix so the address is free again.
   * Forms pointing at it stop subscribing. */
  async softDelete(id: string, now: Date): Promise<Result<void>> {
    try {
      const row = await prisma.crmNewsletter.findUniqueOrThrow({
        where: { id },
        select: { slug: true },
      })
      await prisma.$transaction([
        prisma.crmNewsletter.update({
          where: { id },
          data: {
            deletedAt: now,
            slug: `${row.slug}--deleted-${now.getTime().toString(36)}`,
          },
        }),
        prisma.crmForm.updateMany({
          where: { newsletterId: id },
          data: { newsletterId: null },
        }),
      ])
      return ok(undefined)
    } catch (error) {
      return err(dbError('Failed to delete CRM newsletter', error))
    }
  },

  /** Counts per newsletter: ACTIVE/PENDING subscribers and SENT issues. */
  async statsFor(
    newsletterIds: string[],
  ): Promise<Result<Map<string, CrmNewsletterStats>>> {
    const stats = new Map<string, CrmNewsletterStats>()
    if (newsletterIds.length === 0) return ok(stats)
    try {
      const [subscribers, issues] = await Promise.all([
        prisma.crmNewsletterSubscriber.groupBy({
          by: ['newsletterId', 'status'],
          where: {
            newsletterId: { in: newsletterIds },
            status: { in: ['ACTIVE', 'PENDING'] },
          },
          _count: { _all: true },
        }),
        prisma.crmNewsletterIssue.groupBy({
          by: ['newsletterId'],
          where: {
            newsletterId: { in: newsletterIds },
            status: 'SENT',
            deletedAt: null,
          },
          _count: { _all: true },
          _max: { sentAt: true },
        }),
      ])
      const entry = (id: string) => {
        let current = stats.get(id)
        if (!current) {
          current = { ...EMPTY_NEWSLETTER_STATS }
          stats.set(id, current)
        }
        return current
      }
      for (const row of subscribers) {
        const current = entry(row.newsletterId)
        if (row.status === 'ACTIVE') current.active = row._count._all
        else current.pending = row._count._all
      }
      for (const row of issues) {
        const current = entry(row.newsletterId)
        current.issuesSent = row._count._all
        current.lastIssueSentAt = row._max.sentAt
      }
      return ok(stats)
    } catch (error) {
      return err(dbError('Failed to count CRM newsletter stats', error))
    }
  },

  /** Newsletters shown in the preference center: live and ACTIVE. */
  async listActiveByWorkspace(
    workspaceId: string,
  ): Promise<Result<CrmNewsletter[]>> {
    try {
      const rows = await prisma.crmNewsletter.findMany({
        where: { workspaceId, deletedAt: null, status: 'ACTIVE' },
        orderBy: { name: 'asc' },
      })
      return ok(rows)
    } catch (error) {
      return err(dbError('Failed to list active CRM newsletters', error))
    }
  },
}
