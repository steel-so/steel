import { describe, expect, it } from 'vitest'
import { toDialedNumber, toPabxDestination } from '../pabx/destination'

describe('toPabxDestination', () => {
  it('drops the Brazilian country code from mobile and landline numbers', () => {
    expect(toPabxDestination('5511999999999')).toBe('11999999999')
    expect(toPabxDestination('551133334444')).toBe('1133334444')
  })

  it('keeps numbers without the country code and strips formatting', () => {
    expect(toPabxDestination('(11) 99999-9999')).toBe('11999999999')
    expect(toPabxDestination('+1 415 555 0100')).toBe('14155550100')
  })
})

describe('toDialedNumber', () => {
  it('prefixes the outside-line 0 to the national number', () => {
    expect(toDialedNumber('5513996374317')).toBe('013996374317')
    expect(toDialedNumber('(13) 3226-1900')).toBe('01332261900')
  })

  it('does not double the 0 of a number that already has it', () => {
    expect(toDialedNumber('013996374317')).toBe('013996374317')
  })
})
