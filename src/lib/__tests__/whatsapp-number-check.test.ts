import { describe, expect, it } from 'vitest'
import {
  maskPhone,
  needsWhatsappCheck,
  WHATSAPP_BADGE_LABEL,
  whatsappBadgeState,
} from '@/src/lib/whatsapp/number-check'

const now = new Date('2026-10-22T12:00:00.000Z')
const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000)

describe('needsWhatsappCheck()', () => {
  const options = { ttlDays: 30, now, force: false }

  it('checks contacts never verified', () => {
    expect(
      needsWhatsappCheck(
        { hasWhatsapp: null, whatsappCheckedAt: null },
        options,
      ),
    ).toBe(true)
  })

  it('reuses a result younger than the TTL', () => {
    expect(
      needsWhatsappCheck(
        { hasWhatsapp: true, whatsappCheckedAt: daysAgo(10) },
        options,
      ),
    ).toBe(false)
    expect(
      needsWhatsappCheck(
        { hasWhatsapp: false, whatsappCheckedAt: daysAgo(29) },
        options,
      ),
    ).toBe(false)
  })

  it('checks again once the TTL has passed', () => {
    expect(
      needsWhatsappCheck(
        { hasWhatsapp: true, whatsappCheckedAt: daysAgo(30) },
        options,
      ),
    ).toBe(true)
  })

  it('checks again when forced', () => {
    expect(
      needsWhatsappCheck(
        { hasWhatsapp: true, whatsappCheckedAt: daysAgo(1) },
        { ...options, force: true },
      ),
    ).toBe(true)
  })
})

describe('maskPhone()', () => {
  it('keeps only the country and area prefix', () => {
    expect(maskPhone('+55 (11) 99999-8888')).toBe('5511****')
  })

  it('hides very short values entirely', () => {
    expect(maskPhone('123')).toBe('****')
  })
})

describe('whatsappBadgeState()', () => {
  it('maps the tri-state to labels', () => {
    expect(WHATSAPP_BADGE_LABEL[whatsappBadgeState(true)]).toBe('Tem WhatsApp')
    expect(WHATSAPP_BADGE_LABEL[whatsappBadgeState(false)]).toBe('Sem WhatsApp')
    expect(WHATSAPP_BADGE_LABEL[whatsappBadgeState(null)]).toBe(
      'Não verificado',
    )
  })
})
