import { createId } from '@paralleldrive/cuid2'
import type {
  CrmNewsletter,
  CrmNewsletterSegment,
  Prisma,
} from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import type { NewsletterSegment } from '@/src/schemas/crm-newsletter-segment.schema'

/** Factories of the nl2-segments slice (saved audience segments). */

const NOW = new Date('2026-10-28T13:00:00.000Z')

export const SAMPLE_SEGMENT: NewsletterSegment = {
  conditions: [{ type: 'source', sources: ['FORM'] }],
  groups: [
    {
      conditions: [
        { type: 'city', op: 'equals', value: 'Campinas' },
        { type: 'neverOpened' },
      ],
    },
  ],
}

export function createFakeNewsletterSegment(
  overrides?: Partial<CrmNewsletterSegment>,
): CrmNewsletterSegment {
  return {
    id: 'seg1',
    newsletterId: 'nl1',
    workspaceId: 'ws1',
    name: 'Engajados',
    definition: SAMPLE_SEGMENT as unknown as Prisma.JsonValue,
    createdById: 'u1',
    updatedById: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

export async function seedNewsletterSegment(
  newsletter: CrmNewsletter,
  createdById: string,
  overrides: Partial<Prisma.CrmNewsletterSegmentUncheckedCreateInput> = {},
) {
  return prisma.crmNewsletterSegment.create({
    data: {
      newsletterId: newsletter.id,
      workspaceId: newsletter.workspaceId,
      name: `Segmento ${createId().slice(0, 6)}`,
      definition: SAMPLE_SEGMENT as unknown as Prisma.InputJsonValue,
      createdById,
      ...overrides,
    },
  })
}

/** A subscriber with any column set (person, source, dates, engagement). */
export async function seedSegmentSubscriber(
  newsletter: CrmNewsletter,
  email: string,
  overrides: Partial<Prisma.CrmNewsletterSubscriberUncheckedCreateInput> = {},
) {
  return prisma.crmNewsletterSubscriber.create({
    data: {
      newsletterId: newsletter.id,
      workspaceId: newsletter.workspaceId,
      email: email.toLowerCase(),
      name: email.split('@')[0],
      status: 'ACTIVE',
      source: 'MANUAL',
      ...overrides,
    },
  })
}
