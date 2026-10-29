import { createId } from '@paralleldrive/cuid2'
import type {
  BridgeSubscriber,
  PersonSubscriptionRow,
} from '@/src/repositories/crm-newsletter-bridge.repository'
import { createFakeCrmNewsletterSubscriber } from './newsletter-nl-core.factory'

/** Subscriber as the newsletter ↔ CRM bridge loads it. */
export function createFakeBridgeSubscriber(
  overrides: Partial<BridgeSubscriber> = {},
): BridgeSubscriber {
  return {
    id: createId(),
    workspaceId: 'ws1',
    newsletterId: 'nl1',
    email: 'ana@empresa.com.br',
    name: 'Ana',
    personId: 'p1',
    status: 'ACTIVE',
    newsletter: { id: 'nl1', name: 'Novidades' },
    ...overrides,
  }
}

/** Subscription row of the person "Newsletters" card. */
export function createFakePersonSubscriptionRow(
  overrides: Partial<PersonSubscriptionRow> = {},
): PersonSubscriptionRow {
  const subscriber = createFakeCrmNewsletterSubscriber({
    workspaceId: 'ws1',
    newsletterId: 'nl1',
    email: 'ana@empresa.com.br',
    personId: 'p1',
    status: 'ACTIVE',
    ...overrides,
  })
  return {
    ...subscriber,
    newsletter: overrides.newsletter ?? {
      id: subscriber.newsletterId,
      name: 'Novidades',
      status: 'ACTIVE',
    },
  }
}
