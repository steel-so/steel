import { createId } from '@paralleldrive/cuid2'
import type { CrmNewsletter, CrmNewsletterDigest, Prisma } from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import type { DigestWithSite } from '@/src/repositories/crm-newsletter-digest.repository'

/** newsletter2 nl2-digest-ai: fakes for unit tests, seeds for integration. */

const NOW = new Date('2026-10-28T13:00:00.000Z')

export function createFakeNewsletterDigest(
  overrides?: Partial<DigestWithSite>,
): DigestWithSite {
  return {
    id: 'dg1',
    workspaceId: 'ws1',
    newsletterId: 'nl1',
    enabled: true,
    siteId: 'site1',
    rssUrl: null,
    cadence: 'WEEKLY',
    weekday: 1,
    monthDay: null,
    hour: 9,
    mode: 'DRAFT',
    maxItems: 5,
    subject: 'Resumo de {data}',
    intro: null,
    nextRunAt: null,
    lastRunAt: null,
    lastItemAt: null,
    lastIssueId: null,
    lastOutcome: null,
    lastMessage: null,
    createdById: 'u1',
    updatedById: null,
    createdAt: NOW,
    updatedAt: NOW,
    site: null,
    ...overrides,
  }
}

export async function seedSite(
  workspaceId: string,
  userId: string,
  overrides: Partial<Prisma.SiteUncheckedCreateInput> = {},
) {
  return prisma.site.create({
    data: {
      workspaceId,
      createdById: userId,
      name: 'Site Acme',
      slug: `acme-${createId().slice(0, 8)}`,
      publishedAt: NOW,
      ...overrides,
    },
  })
}

export async function seedSitePost(
  siteId: string,
  userId: string,
  overrides: Partial<Prisma.SitePostUncheckedCreateInput> = {},
) {
  return prisma.sitePost.create({
    data: {
      siteId,
      createdById: userId,
      title: 'Post',
      slug: `post-${createId().slice(0, 8)}`,
      status: 'PUBLISHED',
      publishedAt: NOW,
      ...overrides,
    },
  })
}

export async function seedNewsletterDigest(
  newsletter: CrmNewsletter,
  userId: string,
  overrides: Partial<Prisma.CrmNewsletterDigestUncheckedCreateInput> = {},
): Promise<CrmNewsletterDigest> {
  return prisma.crmNewsletterDigest.create({
    data: {
      workspaceId: newsletter.workspaceId,
      newsletterId: newsletter.id,
      createdById: userId,
      subject: 'Resumo de {data}',
      ...overrides,
    },
  })
}
