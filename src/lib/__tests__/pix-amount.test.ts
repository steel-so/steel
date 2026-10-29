import { describe, expect, it } from 'vitest'
import {
  PIX_EXPIRY_OPTIONS,
  parsePixAmount,
  pixExpiryLabel,
} from '../whatsapp/pix-amount'

describe('parsePixAmount()', () => {
  it.each([
    ['150', 150],
    ['150,5', 150.5],
    ['150,50', 150.5],
    ['1.234,50', 1234.5],
    ['R$ 99,9', 99.9],
    ['1.234', 1234],
    ['12.5', 12.5],
    ['0,01', 0.01],
    ['  42  ', 42],
  ])('reads %s as %d', (text, expected) => {
    expect(parsePixAmount(text)).toBe(expected)
  })

  it.each([
    '',
    '   ',
    'abc',
    '0',
    '0,00',
    '-5',
    '1,234',
    '10,999',
    '1,2,3',
    '12.345.6',
  ])('rejects %j', (text) => {
    expect(parsePixAmount(text)).toBeNull()
  })
})

describe('pixExpiryLabel()', () => {
  it('names the known choices and falls back to minutes', () => {
    for (const option of PIX_EXPIRY_OPTIONS) {
      expect(pixExpiryLabel(option.minutes)).toBe(option.label)
    }
    expect(pixExpiryLabel(45)).toBe('45 minutos')
  })
})
