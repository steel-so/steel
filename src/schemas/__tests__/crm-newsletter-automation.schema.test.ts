import { describe, expect, it } from 'vitest'
import {
  CRM_NEWSLETTER_REENGAGEMENT_DEFAULTS,
  CreateCrmNewsletterWelcomeStepSchema,
  CrmNewsletterReengagementPreviewQuerySchema,
  ReorderCrmNewsletterWelcomeStepsSchema,
  UpdateCrmNewsletterReengagementSchema,
  UpdateCrmNewsletterWelcomeStepSchema,
  welcomeDelayHours,
} from '../crm-newsletter-automation.schema'

describe('welcome step schemas', () => {
  it('converts delays to hours', () => {
    expect(welcomeDelayHours(3, 'HOURS')).toBe(3)
    expect(welcomeDelayHours(2, 'DAYS')).toBe(48)
  })

  it('accepts a new step and coerces the delay', () => {
    const parsed = CreateCrmNewsletterWelcomeStepSchema.parse({
      subject: '  Boas-vindas  ',
      delayValue: '2',
      delayUnit: 'DAYS',
    })
    expect(parsed).toEqual({
      subject: 'Boas-vindas',
      delayValue: 2,
      delayUnit: 'DAYS',
    })
  })

  it('rejects empty subjects, negative, fractional and too long delays', () => {
    const bad = [
      { subject: ' ', delayValue: 0, delayUnit: 'DAYS' },
      { subject: 'a', delayValue: -1, delayUnit: 'DAYS' },
      { subject: 'a', delayValue: 1.5, delayUnit: 'HOURS' },
      { subject: 'a', delayValue: 366, delayUnit: 'DAYS' },
      { subject: 'a', delayValue: 365 * 24 + 1, delayUnit: 'HOURS' },
      { subject: 'a', delayValue: 1, delayUnit: 'WEEKS' },
    ]
    for (const input of bad) {
      expect(
        CreateCrmNewsletterWelcomeStepSchema.safeParse(input).success,
      ).toBe(false)
    }
    expect(
      CreateCrmNewsletterWelcomeStepSchema.safeParse({
        subject: 'a',
        delayValue: 365,
        delayUnit: 'DAYS',
      }).success,
    ).toBe(true)
  })

  it('updates need something, and delay value and unit together', () => {
    expect(UpdateCrmNewsletterWelcomeStepSchema.safeParse({}).success).toBe(
      false,
    )
    expect(
      UpdateCrmNewsletterWelcomeStepSchema.safeParse({ delayValue: 2 }).success,
    ).toBe(false)
    expect(
      UpdateCrmNewsletterWelcomeStepSchema.safeParse({
        delayValue: 400,
        delayUnit: 'DAYS',
      }).success,
    ).toBe(false)
    expect(
      UpdateCrmNewsletterWelcomeStepSchema.parse({
        enabled: false,
        preheader: null,
      }),
    ).toEqual({ enabled: false, preheader: null })
  })

  it('reorders with distinct ids only', () => {
    expect(
      ReorderCrmNewsletterWelcomeStepsSchema.safeParse({ ids: ['a', 'b'] })
        .success,
    ).toBe(true)
    expect(
      ReorderCrmNewsletterWelcomeStepsSchema.safeParse({ ids: ['a', 'a'] })
        .success,
    ).toBe(false)
    expect(
      ReorderCrmNewsletterWelcomeStepsSchema.safeParse({ ids: [] }).success,
    ).toBe(false)
  })
})

describe('re-engagement schemas', () => {
  it('accepts the defaults and enforces the limits', () => {
    expect(
      UpdateCrmNewsletterReengagementSchema.safeParse(
        CRM_NEWSLETTER_REENGAGEMENT_DEFAULTS,
      ).success,
    ).toBe(true)
    const bad = [
      { minIssues: 0 },
      { minIssues: 51 },
      { inactiveDays: 29 },
      { inactiveDays: 366 },
      { graceDays: 6 },
      { graceDays: 91 },
      { action: 'DELETE' },
      { subject: '' },
      { heading: '' },
      { body: ' ' },
      { buttonLabel: 'x'.repeat(61) },
    ]
    for (const override of bad) {
      expect(
        UpdateCrmNewsletterReengagementSchema.safeParse({
          ...CRM_NEWSLETTER_REENGAGEMENT_DEFAULTS,
          ...override,
        }).success,
      ).toBe(false)
    }
  })

  it('preview query is optional and coerced', () => {
    expect(CrmNewsletterReengagementPreviewQuerySchema.parse({})).toEqual({})
    expect(
      CrmNewsletterReengagementPreviewQuerySchema.parse({
        minIssues: '4',
        inactiveDays: '60',
      }),
    ).toEqual({ minIssues: 4, inactiveDays: 60 })
    expect(
      CrmNewsletterReengagementPreviewQuerySchema.safeParse({ minIssues: '0' })
        .success,
    ).toBe(false)
  })
})
