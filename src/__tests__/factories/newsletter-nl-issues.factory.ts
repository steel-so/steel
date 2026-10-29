import { createId } from '@paralleldrive/cuid2'
import type {
  CrmNewsletter,
  CrmNewsletterIssue,
  CrmNewsletterIssueRecipient,
  CrmNewsletterSubscriberStatus,
  Prisma,
} from '@prisma/client'
import { createBlankEmailDocument } from '@/src/lib/canvas-email/presets'
import { prisma } from '@/src/lib/prisma'
import type { NewsletterWithWorkspace } from '@/src/repositories/crm-newsletter-issue.repository'
import { seedUser } from './user.factory'
import { seedWorkspace } from './workspace.factory'

/** Newsletter issues slice (nl-issues): fakes for unit tests, seeds for integration. */

const NOW = new Date('2026-10-28T13:00:00.000Z')

export function createFakeNewsletter(
  overrides?: Partial<NewsletterWithWorkspace>,
): NewsletterWithWorkspace {
  return {
    id: 'nl1',
    workspaceId: 'ws1',
    name: 'Novidades Acme',
    slug: 'novidades',
    description: null,
    cadenceLabel: 'Mensal',
    fromName: 'Acme',
    fromEmail: 'news@news.acme.com.br',
    replyTo: null,
    sendingDomainId: null,
    templateId: null,
    doubleOptIn: true,
    legalBasis: 'CONSENT',
    archiveEnabled: true,
    status: 'ACTIVE',
    createdById: 'u1',
    updatedById: null,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    workspace: { slug: 'acme', name: 'Acme' },
    ...overrides,
  }
}

export function createFakeNewsletterIssue(
  overrides?: Partial<CrmNewsletterIssue>,
): CrmNewsletterIssue {
  return {
    id: 'is1',
    newsletterId: 'nl1',
    workspaceId: 'ws1',
    number: null,
    subject: 'Novidades de outubro',
    preheader: null,
    slug: 'novidades-de-outubro',
    builderDocument: createBlankEmailDocument() as unknown as Prisma.JsonValue,
    webHtml: null,
    excerpt: null,
    segment: {},
    status: 'DRAFT',
    scheduledAt: null,
    sendingStartedAt: null,
    sentAt: null,
    canceledAt: null,
    failureReason: null,
    createdById: 'u1',
    updatedById: null,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    abSubjectB: null,
    abTestPercent: null,
    abMetric: null,
    abWaitHours: null,
    abWinner: null,
    abDecidedAt: null,
    digestId: null,
    ...overrides,
  }
}

export function createFakeNewsletterRecipient(
  overrides?: Partial<CrmNewsletterIssueRecipient>,
): CrmNewsletterIssueRecipient {
  return {
    id: 'r1',
    issueId: 'is1',
    workspaceId: 'ws1',
    subscriberId: 's1',
    email: 'ana@example.com',
    name: 'Ana',
    status: 'PENDING',
    skipReason: null,
    providerMessageId: null,
    error: null,
    sentAt: null,
    deliveredAt: null,
    openedAt: null,
    clickedAt: null,
    bouncedAt: null,
    complainedAt: null,
    unsubscribedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    abVariant: null,
    abHeld: false,
    ...overrides,
  }
}

// ─── Integration seeds ──────────────────────────────────────────────────────

export async function seedNewsletterScope(
  overrides: Partial<Prisma.CrmNewsletterUncheckedCreateInput> = {},
): Promise<{
  workspaceId: string
  userId: string
  newsletter: CrmNewsletter
}> {
  const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
  const newsletter = await prisma.crmNewsletter.create({
    data: {
      workspaceId: workspace.id,
      createdById: user.id,
      name: 'Novidades',
      slug: `novidades-${createId().slice(0, 6)}`,
      fromName: 'Acme',
      fromEmail: 'news@news.acme.com.br',
      ...overrides,
    },
  })
  return { workspaceId: workspace.id, userId: user.id, newsletter }
}

export async function seedNewsletterSubscriber(
  newsletter: CrmNewsletter,
  email: string,
  status: CrmNewsletterSubscriberStatus = 'ACTIVE',
) {
  return prisma.crmNewsletterSubscriber.create({
    data: {
      newsletterId: newsletter.id,
      workspaceId: newsletter.workspaceId,
      email: email.toLowerCase(),
      name: email.split('@')[0],
      status,
      source: 'MANUAL',
    },
  })
}

export async function seedNewsletterIssue(
  newsletter: CrmNewsletter,
  userId: string,
  overrides: Partial<Prisma.CrmNewsletterIssueUncheckedCreateInput> = {},
): Promise<CrmNewsletterIssue> {
  return prisma.crmNewsletterIssue.create({
    data: {
      newsletterId: newsletter.id,
      workspaceId: newsletter.workspaceId,
      createdById: userId,
      subject: 'Edição de teste',
      slug: `edicao-${createId().slice(0, 6)}`,
      builderDocument:
        createBlankEmailDocument() as unknown as Prisma.InputJsonValue,
      ...overrides,
    },
  })
}
