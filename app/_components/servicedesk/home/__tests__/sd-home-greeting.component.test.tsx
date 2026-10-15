import { describe, expect, it } from 'vitest'
import { sdGreeting } from '../sd-home'

// 00:30 UTC is 21:30 in São Paulo: the server (UTC) and the browser used to
// disagree here, which broke hydration (#418).
const LATE_UTC = new Date('2026-10-15T00:30:00Z')

describe('sdGreeting()', () => {
  it('uses the given timezone, not the machine clock', () => {
    expect(sdGreeting(LATE_UTC, 'America/Sao_Paulo')).toBe('Boa noite')
    expect(sdGreeting(LATE_UTC, 'UTC')).toBe('Bom dia')
  })

  it('splits the day at 12h and 18h', () => {
    expect(
      sdGreeting(new Date('2026-10-15T14:59:00Z'), 'America/Sao_Paulo'),
    ).toBe('Bom dia')
    expect(
      sdGreeting(new Date('2026-10-15T15:00:00Z'), 'America/Sao_Paulo'),
    ).toBe('Boa tarde')
    expect(
      sdGreeting(new Date('2026-10-15T21:00:00Z'), 'America/Sao_Paulo'),
    ).toBe('Boa noite')
  })

  it('falls back to São Paulo when the timezone is invalid', () => {
    expect(sdGreeting(LATE_UTC, 'Not/AZone')).toBe('Boa noite')
  })
})
