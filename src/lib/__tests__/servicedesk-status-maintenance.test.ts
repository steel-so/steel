import { describe, expect, it } from 'vitest'
import {
  sdFormatMaintenanceDate,
  sdIsoToWallTime,
  sdMaintenanceNoticeText,
  sdMaintenancePhase,
  sdWallTimeToIso,
} from '../servicedesk/status-maintenance'

const startsAt = new Date('2026-11-10T22:00:00.000Z')
const endsAt = new Date('2026-11-11T02:00:00.000Z')

describe('sdMaintenancePhase', () => {
  const window = { startsAt, endsAt, canceledAt: null }

  it('follows the clock', () => {
    expect(sdMaintenancePhase(window, new Date('2026-11-10T21:59:00Z'))).toBe(
      'SCHEDULED',
    )
    expect(sdMaintenancePhase(window, startsAt)).toBe('IN_PROGRESS')
    expect(sdMaintenancePhase(window, new Date('2026-11-11T01:00:00Z'))).toBe(
      'IN_PROGRESS',
    )
    expect(sdMaintenancePhase(window, endsAt)).toBe('FINISHED')
  })

  it('a canceled window is canceled whatever the time', () => {
    expect(
      sdMaintenancePhase(
        { ...window, canceledAt: new Date() },
        new Date('2026-11-10T23:00:00Z'),
      ),
    ).toBe('CANCELED')
  })
})

describe('sdFormatMaintenanceDate', () => {
  it('formats in the given zone, not the machine zone', () => {
    expect(sdFormatMaintenanceDate(startsAt, 'America/Sao_Paulo')).toBe(
      '10/11/2026 19:00',
    )
    expect(sdFormatMaintenanceDate(startsAt, 'UTC')).toBe('10/11/2026 22:00')
  })

  it('falls back to Sao Paulo for an unknown zone', () => {
    expect(sdFormatMaintenanceDate(startsAt, 'Nope/Zone')).toBe(
      '10/11/2026 19:00',
    )
  })
})

describe('sdMaintenanceNoticeText', () => {
  const base = {
    pageName: 'Acme',
    title: 'Troca do switch',
    startsAt,
    endsAt,
    timeZone: 'America/Sao_Paulo',
    description: 'Haverá queda curta.',
    url: 'https://x/status-page/acme',
  }

  it('announces the window', () => {
    const text = sdMaintenanceNoticeText({ ...base, kind: 'scheduled' })
    expect(text).toContain('Manutenção programada')
    expect(text).toContain('10/11/2026 19:00 até 10/11/2026 23:00')
    expect(text).toContain('Haverá queda curta.')
    expect(text).toContain('Acompanhe: https://x/status-page/acme')
  })

  it('says rescheduled, and omits the time and empty description on cancel', () => {
    expect(sdMaintenanceNoticeText({ ...base, kind: 'rescheduled' })).toContain(
      'Manutenção reagendada',
    )
    const canceled = sdMaintenanceNoticeText({
      ...base,
      kind: 'canceled',
      description: null,
    })
    expect(canceled).toContain('Manutenção cancelada')
    expect(canceled).not.toContain('Quando:')
  })
})

describe('wall time helpers', () => {
  it('reads a wall time in the given zone, not the machine zone', () => {
    expect(sdWallTimeToIso('2026-11-10T19:00', 'America/Sao_Paulo')).toBe(
      '2026-11-10T22:00:00.000Z',
    )
    expect(sdWallTimeToIso('2026-11-10T19:00', 'UTC')).toBe(
      '2026-11-10T19:00:00.000Z',
    )
    expect(sdWallTimeToIso('2026-07-01T09:30', 'Europe/Lisbon')).toBe(
      '2026-07-01T08:30:00.000Z',
    )
  })

  it('refuses unreadable values', () => {
    expect(sdWallTimeToIso('', 'UTC')).toBeNull()
    expect(sdWallTimeToIso('10/11/2026 19:00', 'UTC')).toBeNull()
  })

  it('round-trips through the zone', () => {
    const iso = '2026-11-10T22:00:00.000Z'
    expect(sdIsoToWallTime(iso, 'America/Sao_Paulo')).toBe('2026-11-10T19:00')
    expect(
      sdWallTimeToIso(
        sdIsoToWallTime(iso, 'America/Sao_Paulo'),
        'America/Sao_Paulo',
      ),
    ).toBe(iso)
    expect(sdIsoToWallTime('nope', 'UTC')).toBe('')
  })
})
