import type {
  CrmNewsletter,
  CrmNewsletterReengagement,
  CrmNewsletterReengagementSettings,
  CrmNewsletterSubscriber,
  CrmNewsletterWelcomeDelivery,
  CrmNewsletterWelcomeStep,
  Prisma,
} from '@prisma/client'
import { createBlankEmailDocument } from '@/src/lib/canvas-email/presets'
import { prisma } from '@/src/lib/prisma'
import { CRM_NEWSLETTER_REENGAGEMENT_DEFAULTS } from '@/src/schemas/crm-newsletter-automation.schema'

/**
 * Newsletter automation (newsletter2, nl2-automation): fakes for unit
 * tests, seeds for integration tests. Newsletter scope / subscriber /
 * issue seeds come from `newsletter-nl-issues.factory.ts`.
 */

const NOW = new Date('2026-10-28T13:00:00.000Z')

export function createFakeWelcomeStep(
  overrides?: Partial<CrmNewsletterWelcomeStep>,
): CrmNewsletterWelcomeStep {
  return {
    id: 'st1',
    newsletterId: 'nl1',
    workspaceId: 'ws1',
    position: 0,
    delayValue: 0,
    delayUnit: 'DAYS',
    subject: 'Boas-vindas!',
    preheader: null,
    builderDocument: createBlankEmailDocument() as unknown as Prisma.JsonValue,
    enabled: true,
    createdById: 'u1',
    updatedById: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

export function createFakeWelcomeDelivery(
  overrides?: Partial<CrmNewsletterWelcomeDelivery>,
): CrmNewsletterWelcomeDelivery {
  return {
    id: 'wd1',
    stepId: 'st1',
    newsletterId: 'nl1',
    workspaceId: 'ws1',
    subscriberId: 's1',
    email: 'ana@example.com',
    status: 'SENT',
    skipReason: null,
    providerMessageId: 'msg-1',
    error: null,
    sentAt: NOW,
    deliveredAt: null,
    openedAt: null,
    clickedAt: null,
    bouncedAt: null,
    complainedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

export function createFakeReengagementSettings(
  overrides?: Partial<CrmNewsletterReengagementSettings>,
): CrmNewsletterReengagementSettings {
  return {
    newsletterId: 'nl1',
    workspaceId: 'ws1',
    ...CRM_NEWSLETTER_REENGAGEMENT_DEFAULTS,
    enabled: true,
    updatedById: 'u1',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

export function createFakeReengagement(
  overrides?: Partial<CrmNewsletterReengagement>,
): CrmNewsletterReengagement {
  return {
    id: 're1',
    newsletterId: 'nl1',
    workspaceId: 'ws1',
    subscriberId: 's1',
    email: 'ana@example.com',
    cycle: '2026-10',
    status: 'WAITING',
    providerMessageId: 'msg-r1',
    error: null,
    sentAt: NOW,
    openedAt: null,
    clickedAt: null,
    reengagedAt: null,
    resolvedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

// ─── Integration seeds ──────────────────────────────────────────────────────

export async function seedWelcomeStep(
  newsletter: CrmNewsletter,
  userId: string,
  overrides: Partial<Prisma.CrmNewsletterWelcomeStepUncheckedCreateInput> = {},
): Promise<CrmNewsletterWelcomeStep> {
  const last = await prisma.crmNewsletterWelcomeStep.aggregate({
    where: { newsletterId: newsletter.id },
    _max: { position: true },
  })
  return prisma.crmNewsletterWelcomeStep.create({
    data: {
      newsletterId: newsletter.id,
      workspaceId: newsletter.workspaceId,
      position: (last._max.position ?? -1) + 1,
      delayValue: 0,
      delayUnit: 'DAYS',
      subject: 'Boas-vindas!',
      builderDocument:
        createBlankEmailDocument() as unknown as Prisma.InputJsonValue,
      createdById: userId,
      ...overrides,
    },
  })
}

/** ACTIVE subscriber confirmed at `confirmedAt` (source MANUAL by default). */
export async function seedConfirmedSubscriber(
  newsletter: CrmNewsletter,
  email: string,
  overrides: Partial<Prisma.CrmNewsletterSubscriberUncheckedCreateInput> = {},
): Promise<CrmNewsletterSubscriber> {
  return prisma.crmNewsletterSubscriber.create({
    data: {
      newsletterId: newsletter.id,
      workspaceId: newsletter.workspaceId,
      email: email.toLowerCase(),
      name: email.split('@')[0],
      status: 'ACTIVE',
      source: 'MANUAL',
      confirmedAt: NOW,
      ...overrides,
    },
  })
}

export async function seedReengagementSettings(
  newsletter: CrmNewsletter,
  overrides: Partial<Prisma.CrmNewsletterReengagementSettingsUncheckedCreateInput> = {},
): Promise<CrmNewsletterReengagementSettings> {
  return prisma.crmNewsletterReengagementSettings.create({
    data: {
      newsletterId: newsletter.id,
      workspaceId: newsletter.workspaceId,
      ...CRM_NEWSLETTER_REENGAGEMENT_DEFAULTS,
      enabled: true,
      ...overrides,
    },
  })
}

/** `count` SENT issue deliveries to `subscriber`, all at `sentAt`. */
export async function seedSentIssues(
  newsletter: CrmNewsletter,
  userId: string,
  subscriber: CrmNewsletterSubscriber,
  count: number,
  sentAt: Date,
  extra: Partial<Prisma.CrmNewsletterIssueRecipientUncheckedCreateInput> = {},
): Promise<void> {
  for (let index = 0; index < count; index++) {
    const existing = await prisma.crmNewsletterIssue.findFirst({
      where: { newsletterId: newsletter.id, number: index + 1 },
    })
    const issue =
      existing ??
      (await prisma.crmNewsletterIssue.create({
        data: {
          newsletterId: newsletter.id,
          workspaceId: newsletter.workspaceId,
          createdById: userId,
          subject: `Edição ${index + 1}`,
          slug: `edicao-${index + 1}`,
          number: index + 1,
          status: 'SENT',
          sentAt,
        },
      }))
    await prisma.crmNewsletterIssueRecipient.create({
      data: {
        issueId: issue.id,
        workspaceId: newsletter.workspaceId,
        subscriberId: subscriber.id,
        email: subscriber.email,
        status: 'SENT',
        sentAt,
        ...extra,
      },
    })
  }
}

export async function seedReengagement(
  newsletter: CrmNewsletter,
  subscriber: CrmNewsletterSubscriber,
  overrides: Partial<Prisma.CrmNewsletterReengagementUncheckedCreateInput> = {},
): Promise<CrmNewsletterReengagement> {
  return prisma.crmNewsletterReengagement.create({
    data: {
      newsletterId: newsletter.id,
      workspaceId: newsletter.workspaceId,
      subscriberId: subscriber.id,
      email: subscriber.email,
      cycle: '2026-09',
      status: 'WAITING',
      sentAt: new Date('2026-09-01T12:00:00.000Z'),
      ...overrides,
    },
  })
}
