import { createId } from '@paralleldrive/cuid2'
import type { CrmNewsletter, CrmNewsletterIssue } from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import type {
  ArchiveIssueSummaryRow,
  ArchiveNewsletterRow,
  SiteNewsletterRow,
} from '@/src/repositories/crm-newsletter-archive.repository'

/** Factories of the public newsletter archive (slice nl-archive). */

export function createFakeArchiveNewsletterRow(
  overrides?: Partial<ArchiveNewsletterRow>,
): ArchiveNewsletterRow {
  return {
    id: createId(),
    workspaceId: createId(),
    name: 'Novidades Acme',
    slug: 'novidades',
    description: 'O que acontece na Acme, todo mês.',
    cadenceLabel: 'Mensal',
    doubleOptIn: true,
    archiveEnabled: true,
    workspace: {
      name: 'Acme',
      slug: 'acme',
      crmEmailBrand: {
        logoUrl: 'https://cdn.acme.com/logo.png',
        primaryColor: '#0055ff',
      },
    },
    ...overrides,
  }
}

export function createFakeArchiveIssueRow(
  overrides?: Partial<ArchiveIssueSummaryRow>,
): ArchiveIssueSummaryRow {
  return {
    number: 1,
    subject: 'Edição de outubro',
    slug: 'edicao-de-outubro',
    excerpt: 'Resumo da edição.',
    sentAt: new Date('2026-10-01T12:00:00.000Z'),
    ...overrides,
  }
}

export function createFakeSiteNewsletterRow(
  overrides?: Partial<SiteNewsletterRow>,
): SiteNewsletterRow {
  return {
    ...createFakeArchiveNewsletterRow(),
    issues: [createFakeArchiveIssueRow()],
    ...overrides,
  }
}

export async function seedArchiveNewsletter(
  workspaceId: string,
  createdById: string,
  overrides?: Partial<
    Pick<
      CrmNewsletter,
      | 'name'
      | 'slug'
      | 'description'
      | 'cadenceLabel'
      | 'doubleOptIn'
      | 'archiveEnabled'
      | 'status'
      | 'deletedAt'
    >
  >,
) {
  return prisma.crmNewsletter.create({
    data: {
      workspaceId,
      createdById,
      name: 'Novidades',
      slug: `news-${createId().slice(0, 8)}`,
      fromName: 'Acme',
      fromEmail: 'news@news.acme.com',
      ...overrides,
    },
  })
}

export async function seedArchiveIssue(
  newsletter: Pick<CrmNewsletter, 'id' | 'workspaceId' | 'createdById'>,
  overrides?: Partial<
    Pick<
      CrmNewsletterIssue,
      | 'number'
      | 'subject'
      | 'slug'
      | 'status'
      | 'sentAt'
      | 'webHtml'
      | 'excerpt'
      | 'preheader'
      | 'deletedAt'
    >
  >,
) {
  return prisma.crmNewsletterIssue.create({
    data: {
      newsletterId: newsletter.id,
      workspaceId: newsletter.workspaceId,
      createdById: newsletter.createdById,
      subject: 'Edição',
      slug: `edicao-${createId().slice(0, 8)}`,
      status: 'SENT',
      sentAt: new Date('2026-10-01T12:00:00.000Z'),
      webHtml: '<html><head></head><body><p>Olá</p></body></html>',
      excerpt: 'Resumo.',
      ...overrides,
    },
  })
}
