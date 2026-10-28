import { createId } from '@paralleldrive/cuid2'
import type {
  CrmNewsletter,
  CrmNewsletterIssue,
  CrmNewsletterSubscriber,
} from '@prisma/client'
import { prisma } from '@/src/lib/prisma'

/** Factories of the nl-core slice (newsletters + subscribers, ADR 0054). */

export function createFakeCrmNewsletter(
  overrides?: Partial<CrmNewsletter>,
): CrmNewsletter {
  const now = new Date('2026-10-28T12:00:00.000Z')
  return {
    id: createId(),
    workspaceId: createId(),
    name: 'Novidades da Acme',
    slug: 'novidades',
    description: null,
    cadenceLabel: null,
    fromName: 'Acme',
    fromEmail: 'news@news.acme.com.br',
    replyTo: null,
    sendingDomainId: null,
    templateId: null,
    doubleOptIn: true,
    legalBasis: 'CONSENT',
    archiveEnabled: true,
    status: 'ACTIVE',
    createdById: createId(),
    updatedById: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...overrides,
  }
}

export function createFakeCrmNewsletterSubscriber(
  overrides?: Partial<CrmNewsletterSubscriber>,
): CrmNewsletterSubscriber {
  const now = new Date('2026-10-28T12:00:00.000Z')
  return {
    id: createId(),
    newsletterId: createId(),
    workspaceId: createId(),
    email: 'ana@empresa.com.br',
    name: null,
    personId: null,
    status: 'ACTIVE',
    source: 'MANUAL',
    sourceRef: null,
    consentAt: now,
    consentIp: null,
    consentUserAgent: null,
    consentText: null,
    confirmSentAt: null,
    confirmedAt: now,
    unsubscribedAt: null,
    unsubscribeReason: null,
    bouncedAt: null,
    complainedAt: null,
    lastSentAt: null,
    lastOpenedAt: null,
    lastClickedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

export async function seedCrmNewsletter(
  workspaceId: string,
  createdById: string,
  overrides?: Partial<
    Pick<
      CrmNewsletter,
      'name' | 'slug' | 'status' | 'fromEmail' | 'deletedAt' | 'doubleOptIn'
    >
  >,
) {
  return prisma.crmNewsletter.create({
    data: {
      workspaceId,
      createdById,
      name: 'Seed Newsletter',
      slug: `nl-${createId().slice(0, 8)}`,
      fromName: 'Seed',
      fromEmail: 'news@seed.example.com',
      ...overrides,
    },
  })
}

export async function seedCrmNewsletterSubscriber(
  newsletterId: string,
  workspaceId: string,
  overrides?: Partial<
    Pick<
      CrmNewsletterSubscriber,
      'email' | 'name' | 'status' | 'source' | 'createdAt' | 'personId'
    >
  >,
) {
  return prisma.crmNewsletterSubscriber.create({
    data: {
      newsletterId,
      workspaceId,
      email: `sub-${createId().slice(0, 8)}@example.com`,
      status: 'ACTIVE',
      source: 'MANUAL',
      ...overrides,
    },
  })
}

export async function seedCrmNewsletterIssue(
  newsletterId: string,
  workspaceId: string,
  createdById: string,
  overrides?: Partial<
    Pick<CrmNewsletterIssue, 'status' | 'sentAt' | 'deletedAt' | 'number'>
  >,
) {
  return prisma.crmNewsletterIssue.create({
    data: {
      newsletterId,
      workspaceId,
      createdById,
      subject: 'Edição',
      slug: `ed-${createId().slice(0, 8)}`,
      ...overrides,
    },
  })
}
