import { describe, expect, it } from 'vitest'
import {
  CreateCrmLeadRoutingRuleSchema,
  CreateCrmLeadScoringRuleSchema,
  UpdateCrmLeadScoringRuleSchema,
} from '../crm-lead.schema'
import { SubscribeCrmPersonNewsletterSchema } from '../crm-newsletter-bridge.schema'
import { CrmWorkflowTriggerDataSchema } from '../crm-workflow.schema'

describe('SubscribeCrmPersonNewsletterSchema', () => {
  it('needs a newsletter and defaults to no confirmation', () => {
    expect(
      SubscribeCrmPersonNewsletterSchema.parse({ newsletterId: 'nl1' }),
    ).toEqual({ newsletterId: 'nl1', sendConfirmation: false })
    expect(
      SubscribeCrmPersonNewsletterSchema.safeParse({ newsletterId: ' ' })
        .success,
    ).toBe(false)
  })

  it('validates the optional e-mail', () => {
    expect(
      SubscribeCrmPersonNewsletterSchema.safeParse({
        newsletterId: 'nl1',
        email: 'nope',
      }).success,
    ).toBe(false)
    expect(
      SubscribeCrmPersonNewsletterSchema.parse({
        newsletterId: 'nl1',
        email: 'ana@x.com',
        sendConfirmation: true,
      }),
    ).toMatchObject({ email: 'ana@x.com', sendConfirmation: true })
  })
})

describe('newsletter event scoring fields', () => {
  it('accepts the event fields on scoring rules only', () => {
    for (const field of [
      'newsletter_subscribed',
      'newsletter_opened',
      'newsletter_clicked',
    ]) {
      expect(
        CreateCrmLeadScoringRuleSchema.safeParse({
          field,
          operator: 'contains',
          points: 5,
        }).success,
      ).toBe(true)
      expect(UpdateCrmLeadScoringRuleSchema.safeParse({ field }).success).toBe(
        true,
      )
      expect(
        CreateCrmLeadRoutingRuleSchema.safeParse({
          field,
          operator: 'contains',
          ownerId: 'u1',
        }).success,
      ).toBe(false)
    }
  })
})

describe('newsletter workflow triggers', () => {
  it('parses each trigger with its optional filters', () => {
    expect(
      CrmWorkflowTriggerDataSchema.parse({ type: 'newsletter-subscribed' }),
    ).toEqual({ type: 'newsletter-subscribed' })
    expect(
      CrmWorkflowTriggerDataSchema.parse({
        type: 'newsletter-unsubscribed',
        newsletterId: 'nl1',
      }),
    ).toEqual({ type: 'newsletter-unsubscribed', newsletterId: 'nl1' })
    expect(
      CrmWorkflowTriggerDataSchema.parse({
        type: 'newsletter-issue-opened',
      }),
    ).toEqual({ type: 'newsletter-issue-opened' })
    expect(
      CrmWorkflowTriggerDataSchema.parse({
        type: 'newsletter-link-clicked',
        urlContains: ' /precos ',
      }),
    ).toEqual({ type: 'newsletter-link-clicked', urlContains: '/precos' })
  })

  it('rejects an empty newsletter filter and a long URL filter', () => {
    expect(
      CrmWorkflowTriggerDataSchema.safeParse({
        type: 'newsletter-subscribed',
        newsletterId: '',
      }).success,
    ).toBe(false)
    expect(
      CrmWorkflowTriggerDataSchema.safeParse({
        type: 'newsletter-link-clicked',
        urlContains: 'x'.repeat(501),
      }).success,
    ).toBe(false)
  })
})
