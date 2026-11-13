import { describe, expect, it } from 'vitest'
import {
  explainSendFailure,
  failureCode,
} from '@/src/lib/whatsapp/failure-reason'
import {
  SERVICE_WINDOW_MS,
  serviceWindowState,
} from '@/src/lib/whatsapp/service-window'

describe('serviceWindowState()', () => {
  const now = Date.parse('2026-11-13T12:00:00.000Z')

  it('is closed when the contact never wrote', () => {
    expect(serviceWindowState(null, now)).toEqual({
      open: false,
      closesAt: null,
    })
    expect(serviceWindowState(undefined, now).open).toBe(false)
  })

  it('is closed for an unparseable date', () => {
    expect(serviceWindowState('nope', now)).toEqual({
      open: false,
      closesAt: null,
    })
  })

  it('is open within 24 hours of the last inbound message', () => {
    const state = serviceWindowState('2026-11-13T00:00:00.000Z', now)
    expect(state.open).toBe(true)
    expect(state.closesAt?.toISOString()).toBe('2026-11-14T00:00:00.000Z')
  })

  it('closes exactly 24 hours after the last inbound message', () => {
    const last = new Date(now - SERVICE_WINDOW_MS).toISOString()
    expect(serviceWindowState(last, now).open).toBe(false)
    expect(serviceWindowState(last, now - 1).open).toBe(true)
  })
})

describe('explainSendFailure()', () => {
  it('parses the numeric code', () => {
    expect(failureCode('131047: Re-engagement message')).toBe(131047)
    expect(failureCode('sem código')).toBeNull()
    expect(failureCode(null)).toBeNull()
  })

  it('points to a template when the 24h window expired', () => {
    const result = explainSendFailure('131047: Re-engagement message')
    expect(result.needsTemplate).toBe(true)
    expect(result.title).toContain('24 horas')
  })

  it('explains a known code without asking for a template', () => {
    const result = explainSendFailure('131026: Message undeliverable')
    expect(result.needsTemplate).toBe(false)
    expect(result.title).toContain('não pôde ser entregue')
  })

  it('falls back to a generic message for unknown or missing details', () => {
    expect(explainSendFailure('999999: x').title).toContain('não foi entregue')
    expect(explainSendFailure(null).action).toContain('reenviar')
  })
})
