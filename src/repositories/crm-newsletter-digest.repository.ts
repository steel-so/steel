import type {
  CrmNewsletterDigest,
  CrmNewsletterIssue,
  Prisma,
} from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import type { UpsertCrmNewsletterDigestDTO } from '@/src/schemas/crm-newsletter-digest.schema'
import { dbError } from './db-error'

/**
 * Newsletter digest (newsletter2 nl2-digest-ai): the per-newsletter
 * settings, the due list of the worker with a conditional claim (two
 * workers never run the same digest twice), the Site blog posts it reads
 * and the issue it creates. Tenant scope is explicit; the worker uses the
 * `*Unscoped` reads.
 */

export type DigestWithSite = CrmNewsletterDigest & {
  site: {
    id: string
    name: string
    slug: string
    publishedAt: Date | null
    deletedAt: Date | null
  } | null
}

export type DigestPostRow = {
  id: string
  title: string
  slug: string
  excerpt: string | null
  autoExcerpt: string
  coverImageUrl: string | null
  publishedAt: Date | null
}

const SITE_SELECT = {
  select: {
    id: true,
    name: true,
    slug: true,
    publishedAt: true,
    deletedAt: true,
  },
} as const

export type DigestRunData = {
  lastRunAt?: Date
  lastItemAt?: Date | null
  lastIssueId?: string | null
  lastOutcome: string
  lastMessage: string | null
}

export const CrmNewsletterDigestRepository = {
  async findByNewsletter(
    workspaceId: string,
    newsletterId: string,
  ): Promise<Result<DigestWithSite | null>> {
    try {
      const digest = await prisma.crmNewsletterDigest.findFirst({
        where: { workspaceId, newsletterId },
        include: { site: SITE_SELECT },
      })
      return ok(digest)
    } catch (error) {
      return err(dbError('Failed to find CRM newsletter digest', error))
    }
  },

  async findByIdUnscoped(id: string): Promise<Result<DigestWithSite | null>> {
    try {
      const digest = await prisma.crmNewsletterDigest.findUnique({
        where: { id },
        include: { site: SITE_SELECT },
      })
      return ok(digest)
    } catch (error) {
      return err(dbError('Failed to find CRM newsletter digest', error))
    }
  },

  async upsert(input: {
    workspaceId: string
    newsletterId: string
    actorId: string
    data: UpsertCrmNewsletterDigestDTO
    nextRunAt: Date | null
  }): Promise<Result<DigestWithSite>> {
    const fields = {
      enabled: input.data.enabled,
      siteId: input.data.siteId,
      rssUrl: input.data.rssUrl,
      cadence: input.data.cadence,
      weekday: input.data.cadence === 'WEEKLY' ? input.data.weekday : null,
      monthDay: input.data.cadence === 'MONTHLY' ? input.data.monthDay : null,
      hour: input.data.hour,
      mode: input.data.mode,
      maxItems: input.data.maxItems,
      subject: input.data.subject,
      intro: input.data.intro,
      nextRunAt: input.nextRunAt,
    }
    try {
      const digest = await prisma.crmNewsletterDigest.upsert({
        where: { newsletterId: input.newsletterId },
        create: {
          ...fields,
          workspaceId: input.workspaceId,
          newsletterId: input.newsletterId,
          createdById: input.actorId,
        },
        update: { ...fields, updatedById: input.actorId },
        include: { site: SITE_SELECT },
      })
      return ok(digest)
    } catch (error) {
      return err(dbError('Failed to save CRM newsletter digest', error))
    }
  },

  async remove(
    workspaceId: string,
    newsletterId: string,
  ): Promise<Result<boolean>> {
    try {
      const deleted = await prisma.crmNewsletterDigest.deleteMany({
        where: { workspaceId, newsletterId },
      })
      return ok(deleted.count > 0)
    } catch (error) {
      return err(dbError('Failed to delete CRM newsletter digest', error))
    }
  },

  /** Sites of the workspace (not deleted), for the source picker. */
  async listSites(
    workspaceId: string,
  ): Promise<Result<{ id: string; name: string; publishedAt: Date | null }[]>> {
    try {
      const sites = await prisma.site.findMany({
        where: { workspaceId, deletedAt: null },
        select: { id: true, name: true, publishedAt: true },
        orderBy: { name: 'asc' },
        take: 100,
      })
      return ok(sites)
    } catch (error) {
      return err(dbError('Failed to list sites for the digest', error))
    }
  },

  async findSite(
    workspaceId: string,
    siteId: string,
  ): Promise<
    Result<{
      id: string
      name: string
      slug: string
      publishedAt: Date | null
    } | null>
  > {
    try {
      const site = await prisma.site.findFirst({
        where: { id: siteId, workspaceId, deletedAt: null },
        select: { id: true, name: true, slug: true, publishedAt: true },
      })
      return ok(site)
    } catch (error) {
      return err(dbError('Failed to find site for the digest', error))
    }
  },

  /** Live posts of a site published in (`since`, `until`], newest first. */
  async listLivePosts(
    siteId: string,
    since: Date,
    until: Date,
    limit: number,
  ): Promise<Result<DigestPostRow[]>> {
    try {
      const posts = await prisma.sitePost.findMany({
        where: {
          siteId,
          status: { in: ['PUBLISHED', 'SCHEDULED'] },
          publishedAt: { gt: since, lte: until },
        },
        select: {
          id: true,
          title: true,
          slug: true,
          excerpt: true,
          autoExcerpt: true,
          coverImageUrl: true,
          publishedAt: true,
        },
        orderBy: { publishedAt: 'desc' },
        take: limit,
      })
      return ok(posts)
    } catch (error) {
      return err(dbError('Failed to list site posts for the digest', error))
    }
  },

  /** Enabled digests whose run is due (oldest first). */
  async listDue(now: Date, limit = 50): Promise<Result<CrmNewsletterDigest[]>> {
    try {
      const digests = await prisma.crmNewsletterDigest.findMany({
        where: { enabled: true, nextRunAt: { lte: now } },
        orderBy: { nextRunAt: 'asc' },
        take: limit,
      })
      return ok(digests)
    } catch (error) {
      return err(dbError('Failed to list due CRM newsletter digests', error))
    }
  },

  /**
   * Takes a due run: moves `nextRunAt` from the value read to the next
   * one. `false` when someone else took it (or the settings changed).
   */
  async claimRun(
    id: string,
    expectedNextRunAt: Date,
    nextRunAt: Date | null,
    now: Date,
  ): Promise<Result<boolean>> {
    try {
      const updated = await prisma.crmNewsletterDigest.updateMany({
        where: { id, enabled: true, nextRunAt: expectedNextRunAt },
        data: { nextRunAt, lastRunAt: now },
      })
      return ok(updated.count === 1)
    } catch (error) {
      return err(dbError('Failed to claim CRM newsletter digest run', error))
    }
  },

  async recordRun(id: string, data: DigestRunData): Promise<Result<void>> {
    try {
      await prisma.crmNewsletterDigest.updateMany({
        where: { id },
        data: { ...data, lastMessage: data.lastMessage?.slice(0, 500) ?? null },
      })
      return ok(undefined)
    } catch (error) {
      return err(dbError('Failed to record CRM newsletter digest run', error))
    }
  },

  /** The digest issue (DRAFT), linked to its digest. */
  async createIssue(data: {
    workspaceId: string
    newsletterId: string
    digestId: string
    subject: string
    preheader: string | null
    slug: string
    builderDocument: Prisma.InputJsonValue
    createdById: string
  }): Promise<Result<CrmNewsletterIssue>> {
    try {
      const issue = await prisma.crmNewsletterIssue.create({ data })
      return ok(issue)
    } catch (error) {
      return err(dbError('Failed to create CRM newsletter digest issue', error))
    }
  },
}
