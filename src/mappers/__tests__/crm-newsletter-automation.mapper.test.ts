import { describe, expect, it } from 'vitest'
import {
  createFakeReengagementSettings,
  createFakeWelcomeStep,
} from '@/src/__tests__/factories/newsletter2-automation.factory'
import { CRM_NEWSLETTER_REENGAGEMENT_DEFAULTS } from '@/src/schemas/crm-newsletter-automation.schema'
import {
  toCrmNewsletterReengagementDTO,
  toCrmNewsletterWelcomeStepDTO,
} from '../crm-newsletter-automation.mapper'

const extra = {
  preview: { candidates: 3, waiting: 1, dueNow: 0 },
  totals: { sent: 4, reengaged: 1, unsubscribed: 2, flagged: 0 },
}

describe('toCrmNewsletterWelcomeStepDTO', () => {
  it('maps a step with zero stats and no document by default', () => {
    const dto = toCrmNewsletterWelcomeStepDTO(createFakeWelcomeStep())
    expect(dto).toEqual({
      id: 'st1',
      newsletterId: 'nl1',
      position: 0,
      delayValue: 0,
      delayUnit: 'DAYS',
      subject: 'Boas-vindas!',
      preheader: null,
      enabled: true,
      stats: { sent: 0, opened: 0, clicked: 0 },
      createdAt: '2026-10-28T13:00:00.000Z',
      updatedAt: '2026-10-28T13:00:00.000Z',
    })
    expect('builderDocument' in dto).toBe(false)
  })

  it('includes the stats and the document when asked', () => {
    const step = createFakeWelcomeStep()
    const dto = toCrmNewsletterWelcomeStepDTO(step, {
      stats: { sent: 5, opened: 2, clicked: 1 },
      includeDocument: true,
    })
    expect(dto.stats).toEqual({ sent: 5, opened: 2, clicked: 1 })
    expect(dto.builderDocument).toBe(step.builderDocument)
  })
})

describe('toCrmNewsletterReengagementDTO', () => {
  it('maps saved settings', () => {
    const settings = createFakeReengagementSettings({ action: 'FLAG' })
    expect(toCrmNewsletterReengagementDTO('nl1', settings, extra)).toEqual({
      newsletterId: 'nl1',
      saved: true,
      enabled: true,
      minIssues: 3,
      inactiveDays: 90,
      graceDays: 30,
      action: 'FLAG',
      subject: CRM_NEWSLETTER_REENGAGEMENT_DEFAULTS.subject,
      heading: CRM_NEWSLETTER_REENGAGEMENT_DEFAULTS.heading,
      body: CRM_NEWSLETTER_REENGAGEMENT_DEFAULTS.body,
      buttonLabel: 'Quero continuar recebendo',
      updatedAt: '2026-10-28T13:00:00.000Z',
      ...extra,
    })
  })

  it('falls back to the defaults (off) when never saved', () => {
    const dto = toCrmNewsletterReengagementDTO('nl1', null, extra)
    expect(dto).toMatchObject({
      saved: false,
      enabled: false,
      updatedAt: null,
      action: 'UNSUBSCRIBE',
    })
  })
})
