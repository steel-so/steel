import { describe, expect, it } from 'vitest'
import {
  CrmNewsletterWhatsAppVariablesSchema,
  ListCrmNewsletterWhatsAppRecipientsQuerySchema,
  UpdateCrmNewsletterIssueWhatsAppSchema,
} from '@/src/schemas/crm-newsletter-engage.schema'

describe('crm-newsletter-engage schemas', () => {
  it('accepts a partial WhatsApp update', () => {
    expect(UpdateCrmNewsletterIssueWhatsAppSchema.parse({})).toEqual({})
    expect(
      UpdateCrmNewsletterIssueWhatsAppSchema.parse({
        enabled: true,
        connectionId: 'c1',
        templateId: null,
        variables: { body: { '1': { source: 'summary' } } },
        text: 'Leia {link}',
        legalBasis: 'CONSENT',
        confirmLegalBasis: true,
      }).variables,
    ).toEqual({ header: {}, body: { '1': { source: 'summary' } }, buttons: {} })
  })

  it('refuses bad sources, empty static values, long texts and bad bases', () => {
    const bad = [
      { variables: { body: { '1': { source: 'email' } } } },
      { variables: { body: { a: { source: 'name' } } } },
      { variables: { body: { '1': { source: 'static', value: ' ' } } } },
      { text: 'x'.repeat(1001) },
      { legalBasis: 'MARKETING' },
      { connectionId: '' },
    ]
    for (const input of bad) {
      expect(
        UpdateCrmNewsletterIssueWhatsAppSchema.safeParse(input).success,
        JSON.stringify(input).slice(0, 60),
      ).toBe(false)
    }
    expect(
      CrmNewsletterWhatsAppVariablesSchema.safeParse({
        body: { '1': { source: 'static', value: 'fixo' } },
      }).success,
    ).toBe(true)
  })

  it('pages the WhatsApp report with an optional status', () => {
    expect(ListCrmNewsletterWhatsAppRecipientsQuerySchema.parse({})).toEqual({
      page: 1,
      pageSize: 25,
    })
    expect(
      ListCrmNewsletterWhatsAppRecipientsQuerySchema.parse({
        page: '2',
        pageSize: '10',
        status: 'FAILED',
      }),
    ).toEqual({ page: 2, pageSize: 10, status: 'FAILED' })
    expect(
      ListCrmNewsletterWhatsAppRecipientsQuerySchema.safeParse({ status: 'X' })
        .success,
    ).toBe(false)
  })
})
