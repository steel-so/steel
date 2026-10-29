import type {
  CrmNewsletter,
  CrmNewsletterSubscriber,
  CrmNewsletterWelcomeDelivery,
  CrmNewsletterWelcomeStep,
  Prisma,
} from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import type { BridgeWelcomeStep } from '@/src/repositories/crm-newsletter-bridge.repository'

/**
 * Factories of the welcome series ↔ CRM bridge (slice nl3-welcome-bridge).
 */

/** Welcome step as the bridge loads it (1-based position). */
export function createFakeBridgeWelcomeStep(
  overrides: Partial<BridgeWelcomeStep> = {},
): BridgeWelcomeStep {
  return { id: 'st1', subject: 'Bem-vindo!', position: 1, ...overrides }
}

/** A SENT welcome delivery of `step` to `subscriber`. */
export async function seedWelcomeDelivery(
  newsletter: CrmNewsletter,
  step: CrmNewsletterWelcomeStep,
  subscriber: CrmNewsletterSubscriber,
  overrides: Partial<Prisma.CrmNewsletterWelcomeDeliveryUncheckedCreateInput> = {},
): Promise<CrmNewsletterWelcomeDelivery> {
  return prisma.crmNewsletterWelcomeDelivery.create({
    data: {
      stepId: step.id,
      newsletterId: newsletter.id,
      workspaceId: newsletter.workspaceId,
      subscriberId: subscriber.id,
      email: subscriber.email,
      status: 'SENT',
      ...overrides,
    },
  })
}
