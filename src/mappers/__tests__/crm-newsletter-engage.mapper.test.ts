import { describe, expect, it } from 'vitest'
import {
  createFakeIssueWhatsApp,
  createFakeWhatsAppRecipient,
} from '@/src/__tests__/factories/newsletter2-engage.factory'
import {
  toCrmNewsletterIssueWhatsAppDTO,
  toCrmNewsletterWhatsAppRecipientDTO,
  toWhatsAppVariables,
} from '@/src/mappers/crm-newsletter-engage.mapper'

const extras = {
  available: true,
  unavailableReason: null,
  problems: [],
  reach: null,
}

describe('crm-newsletter-engage mapper', () => {
  it('maps the WhatsApp settings (with defaults when absent)', () => {
    const at = new Date('2026-10-28T13:00:00.000Z')
    expect(
      toCrmNewsletterIssueWhatsAppDTO(
        'is1',
        createFakeIssueWhatsApp({
          startedAt: at,
          variables: { body: { '1': { source: 'summary' } } } as never,
        }),
        extras,
      ),
    ).toMatchObject({
      issueId: 'is1',
      enabled: true,
      connectionId: 'c1',
      legalBasis: 'CONSENT',
      consentConfirmedAt: at.toISOString(),
      startedAt: at.toISOString(),
      variables: {
        header: {},
        body: { '1': { source: 'summary' } },
        buttons: {},
      },
      available: true,
    })
    expect(toCrmNewsletterIssueWhatsAppDTO('is1', null, extras)).toEqual({
      issueId: 'is1',
      enabled: false,
      connectionId: null,
      templateId: null,
      variables: null,
      text: null,
      legalBasis: null,
      consentConfirmedAt: null,
      startedAt: null,
      ...extras,
    })
  })

  it('drops stored variables that no longer parse', () => {
    expect(toWhatsAppVariables(undefined)).toBeNull()
    expect(toWhatsAppVariables({ body: { x: { source: 'nope' } } })).toBeNull()
  })

  it('maps a WhatsApp delivery row', () => {
    const at = new Date('2026-10-28T13:00:00.000Z')
    expect(
      toCrmNewsletterWhatsAppRecipientDTO(
        createFakeWhatsAppRecipient({ status: 'SENT', sentAt: at }),
      ),
    ).toEqual({
      id: 'w1',
      name: 'Ana Lima',
      phone: '+5511999990000',
      personId: 'p1',
      status: 'SENT',
      skipReason: null,
      error: null,
      sentAt: at.toISOString(),
    })
    expect(
      toCrmNewsletterWhatsAppRecipientDTO(createFakeWhatsAppRecipient()).sentAt,
    ).toBeNull()
  })
})
