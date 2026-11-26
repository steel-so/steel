import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/env/server', () => ({
  BETTER_AUTH_SECRET: 'ba_test_secret_value_123',
  BETTER_AUTH_URL: 'https://app.example.com/',
}))

import {
  decideNoticeRoute,
  formatWhatsAppNotice,
  generateVerificationCode,
  hashVerificationCode,
  maskNotificationNumber,
  normalizeNotificationNumber,
  noticeLink,
  noticeTemplateComponents,
  noticeTemplateParams,
  verificationCodeMatches,
  WHATSAPP_NOTICE_MAX_LENGTH,
  whatsappEnabledForKind,
} from '@/src/lib/notifications/whatsapp-channel'

describe('normalizeNotificationNumber', () => {
  it('adds the Brazilian country code to a number with area code', () => {
    expect(normalizeNotificationNumber('(11) 99999-0000')).toBe('5511999990000')
  })
  it('keeps a number that already carries the country code', () => {
    expect(normalizeNotificationNumber('+55 11 99999-0000')).toBe(
      '5511999990000',
    )
  })
  it('rejects what is not a phone', () => {
    expect(normalizeNotificationNumber('12345')).toBeNull()
    expect(normalizeNotificationNumber(null)).toBeNull()
  })
})

describe('maskNotificationNumber', () => {
  it('hides the middle digits', () => {
    expect(maskNotificationNumber('5511999990000')).toBe('+55 11 •••••-0000')
  })
})

describe('verification code', () => {
  it('has 6 digits', () => {
    for (let i = 0; i < 50; i++) {
      expect(generateVerificationCode()).toMatch(/^\d{6}$/)
    }
  })
  it('matches only the same user, number and code', () => {
    const hash = hashVerificationCode('u1', '5511999990000', '123456')
    expect(verificationCodeMatches('u1', '5511999990000', '123456', hash)).toBe(
      true,
    )
    expect(verificationCodeMatches('u1', '5511999990000', '123457', hash)).toBe(
      false,
    )
    expect(verificationCodeMatches('u2', '5511999990000', '123456', hash)).toBe(
      false,
    )
    expect(verificationCodeMatches('u1', '5511888880000', '123456', hash)).toBe(
      false,
    )
    expect(verificationCodeMatches('u1', '5511999990000', '123456', null)).toBe(
      false,
    )
  })
})

describe('whatsappEnabledForKind', () => {
  it('lets an explicit choice win', () => {
    expect(whatsappEnabledForKind('WHATSAPP_SLA_BREACHED', false)).toBe(false)
    expect(whatsappEnabledForKind('CRM_LEAD_CREATED', true)).toBe(true)
  })
  it('defaults to the urgent kinds only', () => {
    expect(whatsappEnabledForKind('WHATSAPP_SLA_BREACHED', null)).toBe(true)
    expect(whatsappEnabledForKind('CRM_LEAD_CREATED', undefined)).toBe(false)
  })
})

describe('formatWhatsAppNotice', () => {
  it('builds bold title, body and absolute link', () => {
    expect(
      formatWhatsAppNotice({
        title: 'SLA estourado',
        body: 'Conversa com Ana',
        href: '/acme/zap?c=1',
      }),
    ).toBe(
      '*SLA estourado*\nConversa com Ana\nhttps://app.example.com/acme/zap?c=1',
    )
  })
  it('trims only the body when too long, keeping title and link', () => {
    const text = formatWhatsAppNotice({
      title: 'Título',
      body: 'x'.repeat(5000),
      href: '/acme/crm',
    })
    expect(text.length).toBeLessThanOrEqual(WHATSAPP_NOTICE_MAX_LENGTH)
    expect(text.startsWith('*Título*')).toBe(true)
    expect(text.endsWith('https://app.example.com/acme/crm')).toBe(true)
  })
})

describe('notice template', () => {
  it('has three body variables and never starts or ends with one', () => {
    const [body] = noticeTemplateComponents() as { text: string }[]
    expect(body.text).toContain('{{1}}')
    expect(body.text).toContain('{{3}}')
    expect(body.text.startsWith('{{')).toBe(false)
    expect(body.text.endsWith('}}')).toBe(false)
  })

  it('fills title, message and link without newlines', () => {
    const [component] = noticeTemplateParams({
      title: 'Nova\nconversa',
      body: 'Ana:   oi',
      href: '/acme/zap?conversa=c1',
    }) as { parameters: { text: string }[] }[]
    expect(component.parameters.map((p) => p.text)).toEqual([
      'Nova conversa',
      'Ana: oi',
      'https://app.example.com/acme/zap?conversa=c1',
    ])
  })

  it('links to the app root when the notice has no path', () => {
    expect(noticeLink(null)).toBe('https://app.example.com')
  })
})

describe('decideNoticeRoute', () => {
  const base = { windowOpen: false, templateStatus: null as string | null }
  it('sends text on Z-API and inside the Meta window', () => {
    expect(decideNoticeRoute({ ...base, provider: 'ZAPI' })).toEqual({
      route: 'text',
    })
    expect(
      decideNoticeRoute({ ...base, provider: 'META', windowOpen: true }),
    ).toEqual({ route: 'text' })
  })
  it('uses the approved template outside the window', () => {
    expect(
      decideNoticeRoute({
        ...base,
        provider: 'META',
        templateStatus: 'APPROVED',
      }),
    ).toEqual({ route: 'template' })
  })
  it('skips with the reason when the template is not usable', () => {
    const reason = (templateStatus: string | null) =>
      decideNoticeRoute({ ...base, provider: 'META', templateStatus })
    expect(reason(null)).toEqual({ route: 'skip', reason: 'template_missing' })
    expect(reason('PENDING')).toEqual({
      route: 'skip',
      reason: 'template_pending',
    })
    expect(reason('REJECTED')).toEqual({
      route: 'skip',
      reason: 'template_unavailable',
    })
  })
})
