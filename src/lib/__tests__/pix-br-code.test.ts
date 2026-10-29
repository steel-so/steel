import { describe, expect, it } from 'vitest'
import { buildBrCode, crc16, isValidBrCode } from '../pix/br-code'

describe('crc16()', () => {
  it('matches the CRC16/CCITT-FALSE check value', () => {
    expect(crc16('123456789')).toBe('29B1')
  })

  it('pads to four digits', () => {
    expect(crc16('')).toBe('FFFF')
    expect(crc16('a')).toHaveLength(4)
  })
})

describe('buildBrCode()', () => {
  const base = {
    key: 'chave@exemplo.com',
    amount: 12.5,
    merchantName: 'Loja São João',
    merchantCity: 'São Paulo',
    txid: 'abc123',
  }

  it('builds a payload with the Pix fields and a valid CRC', () => {
    const code = buildBrCode(base)
    expect(code.startsWith('000201')).toBe(true)
    expect(code).toContain('br.gov.bcb.pix')
    expect(code).toContain('chave@exemplo.com')
    expect(code).toContain('540512.50')
    expect(code).toContain('5303986')
    expect(code).toContain('5802BR')
    expect(code).toContain('LOJA SAO JOAO')
    expect(code).toContain('SAO PAULO')
    expect(code).toContain('0506abc123')
    expect(isValidBrCode(code)).toBe(true)
  })

  it('adds the description to the account info when given', () => {
    const code = buildBrCode({ ...base, description: 'Pedido nº 7' })
    expect(code).toContain('PEDIDO N 7')
    expect(isValidBrCode(code)).toBe(true)
  })

  it('cleans and truncates the txid, falling back to ***', () => {
    expect(buildBrCode({ ...base, txid: 'a-b_c d' })).toContain('0504abcd')
    expect(buildBrCode({ ...base, txid: 'x'.repeat(40) })).toContain(
      `0525${'x'.repeat(25)}`,
    )
    expect(buildBrCode({ ...base, txid: '--' })).toContain('0503***')
  })

  it('truncates long names and cities', () => {
    const code = buildBrCode({
      ...base,
      merchantName: 'N'.repeat(40),
      merchantCity: 'C'.repeat(40),
    })
    expect(code).toContain(`5925${'N'.repeat(25)}`)
    expect(code).toContain(`6015${'C'.repeat(15)}`)
  })
})

describe('isValidBrCode()', () => {
  it('rejects tampered, short and unterminated payloads', () => {
    const code = buildBrCode({
      key: 'k',
      amount: 1,
      merchantName: 'A',
      merchantCity: 'B',
      txid: 't',
    })
    expect(isValidBrCode(code.replace('540', '541'))).toBe(false)
    expect(isValidBrCode('6304')).toBe(false)
    expect(isValidBrCode(`${code.slice(0, -8)}0000ABCD`)).toBe(false)
  })
})
