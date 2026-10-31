import { describe, expect, it } from 'vitest'
import {
  computeSdLicenseCompliance,
  normalizeSdLicensePattern,
  sdLicenseDaysLeft,
  sdLicenseExpiryState,
  sdLicenseFit,
  sdLicenseNoticeKind,
  sdLicenseStatus,
  sdLicenseToday,
} from '../servicedesk/license'

const d = (s: string) => new Date(`${s}T00:00:00.000Z`)

describe('sdLicenseToday', () => {
  it('uses the São Paulo calendar day', () => {
    expect(sdLicenseToday(new Date('2026-10-30T02:00:00Z'))).toBe('2026-10-29')
    expect(sdLicenseToday(new Date('2026-10-30T12:00:00Z'))).toBe('2026-10-30')
  })

  it('falls back to UTC on an invalid zone', () => {
    expect(sdLicenseToday(new Date('2026-10-30T02:00:00Z'), 'Nope/Zone')).toBe(
      '2026-10-30',
    )
  })
})

describe('sdLicenseDaysLeft', () => {
  it('counts calendar days and is null without a date', () => {
    expect(sdLicenseDaysLeft(null, '2026-10-30')).toBeNull()
    expect(sdLicenseDaysLeft(d('2026-11-09'), '2026-10-30')).toBe(10)
    expect(sdLicenseDaysLeft(d('2026-10-30'), '2026-10-30')).toBe(0)
    expect(sdLicenseDaysLeft(d('2026-10-28'), '2026-10-30')).toBe(-2)
  })
})

describe('sdLicenseExpiryState', () => {
  it.each([
    [null, 'NONE'],
    [-1, 'EXPIRED'],
    [0, 'EXPIRING'],
    [30, 'EXPIRING'],
    [31, 'OK'],
  ] as const)('%s days left is %s', (days, state) => {
    expect(sdLicenseExpiryState(days, 30)).toBe(state)
  })
})

describe('sdLicenseFit / sdLicenseStatus', () => {
  it('compares seats and installs', () => {
    expect(sdLicenseFit(5, 6)).toBe('UNDER_LICENSED')
    expect(sdLicenseFit(5, 4)).toBe('OVER_LICENSED')
    expect(sdLicenseFit(5, 5)).toBe('COMPLIANT')
  })

  it('ranks expired, then missing seats, then expiring, then surplus', () => {
    expect(sdLicenseStatus('UNDER_LICENSED', 'EXPIRED')).toBe('EXPIRED')
    expect(sdLicenseStatus('UNDER_LICENSED', 'EXPIRING')).toBe('UNDER_LICENSED')
    expect(sdLicenseStatus('OVER_LICENSED', 'EXPIRING')).toBe('EXPIRING')
    expect(sdLicenseStatus('OVER_LICENSED', 'OK')).toBe('OVER_LICENSED')
    expect(sdLicenseStatus('COMPLIANT', 'NONE')).toBe('COMPLIANT')
  })
})

describe('computeSdLicenseCompliance', () => {
  it('builds the whole picture', () => {
    expect(
      computeSdLicenseCompliance({
        seats: 10,
        installed: 12,
        expiresAt: d('2026-11-10'),
        renewalNoticeDays: 30,
        today: '2026-10-30',
      }),
    ).toEqual({
      installed: 12,
      seats: 10,
      balance: -2,
      fit: 'UNDER_LICENSED',
      expiryState: 'EXPIRING',
      daysLeft: 11,
      status: 'UNDER_LICENSED',
    })
  })
})

describe('sdLicenseNoticeKind', () => {
  it('warns inside the window and after recent expiry only', () => {
    expect(sdLicenseNoticeKind('EXPIRING', 5)).toBe('NOTICE')
    expect(sdLicenseNoticeKind('EXPIRED', -1)).toBe('EXPIRED')
    expect(sdLicenseNoticeKind('EXPIRED', -31)).toBeNull()
    expect(sdLicenseNoticeKind('EXPIRED', null)).toBeNull()
    expect(sdLicenseNoticeKind('OK', 90)).toBeNull()
    expect(sdLicenseNoticeKind('NONE', null)).toBeNull()
  })
})

describe('normalizeSdLicensePattern', () => {
  it('trims and collapses spaces', () => {
    expect(normalizeSdLicensePattern('  Microsoft   Office ')).toBe(
      'Microsoft Office',
    )
  })
})
