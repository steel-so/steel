import { describe, expect, it } from 'vitest'
import {
  createPiiVault,
  createStreamUnmasker,
  isValidCnpj,
  isValidCpf,
  mapStrings,
  passesLuhn,
} from '@/src/lib/ai/guardrails/pii'

describe('PII validators', () => {
  it('should check CPF digits', () => {
    expect(isValidCpf('123.456.789-09')).toBe(true)
    expect(isValidCpf('12345678909')).toBe(true)
    expect(isValidCpf('123.456.789-00')).toBe(false)
    expect(isValidCpf('111.111.111-11')).toBe(false)
    expect(isValidCpf('1234567890')).toBe(false)
  })

  it('should check CNPJ digits', () => {
    expect(isValidCnpj('11.222.333/0001-81')).toBe(true)
    expect(isValidCnpj('11222333000181')).toBe(true)
    expect(isValidCnpj('11.222.333/0001-82')).toBe(false)
    expect(isValidCnpj('00000000000000')).toBe(false)
    expect(isValidCnpj('1122233300018')).toBe(false)
  })

  it('should run Luhn on 13 to 19 digits', () => {
    expect(passesLuhn('4111 1111 1111 1111')).toBe(true)
    expect(passesLuhn('4111-1111-1111-1112')).toBe(false)
    expect(passesLuhn('4111')).toBe(false)
    expect(passesLuhn('0000000000000000')).toBe(false)
  })
})

describe('createPiiVault()', () => {
  it('should mask every kind and unmask back to the original text', () => {
    const vault = createPiiVault()
    const text =
      'CPF 123.456.789-09, CNPJ 11.222.333/0001-81, cartão 4111 1111 1111 1111, fone (11) 98765-4321, e-mail Ana.Silva@Example.com'
    const masked = vault.mask(text)
    expect(masked).toBe(
      'CPF [CPF_1], CNPJ [CNPJ_1], cartão [CARD_1], fone [PHONE_1], e-mail [EMAIL_1]',
    )
    expect(vault.unmask(masked)).toBe(text)
    expect(vault.counts()).toEqual({
      EMAIL: 1,
      CNPJ: 1,
      CPF: 1,
      CARD: 1,
      PHONE: 1,
    })
    expect(vault.size()).toBe(5)
  })

  it('should reuse the placeholder for the same value written differently', () => {
    const vault = createPiiVault()
    expect(vault.mask('12345678909 e 123.456.789-09')).toBe('[CPF_1] e [CPF_1]')
    expect(vault.mask('+55 11 98765-4321 ou 11987654321')).toBe(
      '[PHONE_1] ou [PHONE_1]',
    )
    expect(vault.mask('outro: 987.654.321-00')).toBe('outro: [CPF_2]')
  })

  it('should leave numbers that fail the checks alone', () => {
    const vault = createPiiVault()
    expect(
      vault.mask('pedido 123.456.789-00 e cartão 4111 1111 1111 1112'),
    ).toBe('pedido 123.456.789-00 e cartão 4111 1111 1111 1112')
    expect(vault.mask('')).toBe('')
    expect(vault.size()).toBe(0)
  })

  it('should keep unknown placeholders and skip unmasking with an empty vault', () => {
    const vault = createPiiVault()
    expect(vault.unmask('[CPF_9]')).toBe('[CPF_9]')
    vault.mask('a@b.co')
    expect(vault.unmask('[EMAIL_1] [CPF_9]')).toBe('a@b.co [CPF_9]')
    expect(vault.unmask('')).toBe('')
  })
})

describe('mapStrings()', () => {
  it('should map nested strings and keep other values', () => {
    expect(
      mapStrings({ a: 'x', b: [1, 'y', { c: 'z' }], d: null, e: true }, (s) =>
        s.toUpperCase(),
      ),
    ).toEqual({ a: 'X', b: [1, 'Y', { c: 'Z' }], d: null, e: true })
  })
})

describe('createStreamUnmasker()', () => {
  it('should hold back a placeholder split across deltas', () => {
    const vault = createPiiVault()
    vault.mask('123.456.789-09')
    const unmasker = createStreamUnmasker(vault)
    expect(unmasker.push('Seu CPF é [CP')).toBe('Seu CPF é ')
    expect(unmasker.push('F_1], certo')).toBe('123.456.789-09, certo')
    expect(unmasker.push(' [nota')).toBe(' ')
    expect(unmasker.flush()).toBe('[nota')
    expect(unmasker.flush()).toBe('')
  })

  it('should release a bracket that grew too long to be a placeholder', () => {
    const unmasker = createStreamUnmasker(createPiiVault())
    expect(unmasker.push('[isto não é um marcador')).toBe(
      '[isto não é um marcador',
    )
  })
})
