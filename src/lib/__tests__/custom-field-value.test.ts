import { describe, expect, it } from 'vitest'
import {
  coerceCustomFieldValue,
  customFieldKeyFromLabel,
  formatCustomFieldValue,
  isValidCnpj,
  isValidCpf,
} from '../custom-field-value'

const def = (
  type: Parameters<typeof coerceCustomFieldValue>[0]['type'],
  extra: { options?: string[]; required?: boolean } = {},
) => ({ label: 'Campo', type, ...extra })

describe('isValidCpf()', () => {
  it('accepts a valid CPF with or without punctuation', () => {
    expect(isValidCpf('529.982.247-25')).toBe(true)
    expect(isValidCpf('52998224725')).toBe(true)
  })

  it('rejects wrong check digits, repeated digits and wrong length', () => {
    expect(isValidCpf('529.982.247-24')).toBe(false)
    expect(isValidCpf('111.111.111-11')).toBe(false)
    expect(isValidCpf('1234')).toBe(false)
  })
})

describe('isValidCnpj()', () => {
  it('accepts a valid CNPJ with or without punctuation', () => {
    expect(isValidCnpj('11.222.333/0001-81')).toBe(true)
    expect(isValidCnpj('11222333000181')).toBe(true)
  })

  it('rejects wrong check digits, repeated digits and wrong length', () => {
    expect(isValidCnpj('11.222.333/0001-82')).toBe(false)
    expect(isValidCnpj('00000000000000')).toBe(false)
    expect(isValidCnpj('123')).toBe(false)
  })
})

describe('coerceCustomFieldValue()', () => {
  it('stores CPF and CNPJ as digits only', () => {
    expect(coerceCustomFieldValue(def('CPF'), '529.982.247-25')).toEqual({
      ok: true,
      value: '52998224725',
    })
    expect(coerceCustomFieldValue(def('CNPJ'), '11.222.333/0001-81')).toEqual({
      ok: true,
      value: '11222333000181',
    })
  })

  it('names the field when the document is invalid', () => {
    const result = coerceCustomFieldValue(
      { label: 'CPF', type: 'CPF' },
      '123.456.789-00',
    )
    expect(result).toEqual({ ok: false, message: '"CPF" tem um CPF inválido' })
  })

  it('treats empty as no value, or as an error when required', () => {
    expect(coerceCustomFieldValue(def('CPF'), '  ')).toEqual({
      ok: true,
      value: null,
    })
    expect(
      coerceCustomFieldValue(def('CPF', { required: true }), ''),
    ).toMatchObject({ ok: false })
  })

  it('validates CEP, phone, e-mail and URL', () => {
    expect(coerceCustomFieldValue(def('CEP'), '01310-100')).toEqual({
      ok: true,
      value: '01310100',
    })
    expect(coerceCustomFieldValue(def('CEP'), '123')).toMatchObject({
      ok: false,
    })
    expect(coerceCustomFieldValue(def('PHONE'), '(11) 99999-8888')).toEqual({
      ok: true,
      value: '11999998888',
    })
    expect(coerceCustomFieldValue(def('EMAIL'), 'Ana@Empresa.com.br')).toEqual({
      ok: true,
      value: 'ana@empresa.com.br',
    })
    expect(coerceCustomFieldValue(def('EMAIL'), 'ana@')).toMatchObject({
      ok: false,
    })
    expect(
      coerceCustomFieldValue(def('URL'), 'https://x.com.br'),
    ).toMatchObject({ ok: true })
    expect(
      coerceCustomFieldValue(def('URL'), 'javascript:alert(1)'),
    ).toMatchObject({ ok: false })
  })

  it('handles number, boolean, date and select', () => {
    expect(coerceCustomFieldValue(def('NUMBER'), '12,5')).toEqual({
      ok: true,
      value: 12.5,
    })
    expect(coerceCustomFieldValue(def('NUMBER'), 'abc')).toMatchObject({
      ok: false,
    })
    expect(coerceCustomFieldValue(def('BOOLEAN'), 'Sim')).toEqual({
      ok: true,
      value: true,
    })
    expect(coerceCustomFieldValue(def('BOOLEAN'), 'não')).toEqual({
      ok: true,
      value: false,
    })
    expect(coerceCustomFieldValue(def('DATE'), '25/12/2026')).toEqual({
      ok: true,
      value: new Date('2026-12-25').toISOString(),
    })
    expect(coerceCustomFieldValue(def('DATE'), 'ontem')).toMatchObject({
      ok: false,
    })
    expect(
      coerceCustomFieldValue(def('SELECT', { options: ['A', 'B'] }), 'B'),
    ).toEqual({ ok: true, value: 'B' })
    expect(
      coerceCustomFieldValue(def('SELECT', { options: ['A', 'B'] }), 'C'),
    ).toMatchObject({ ok: false })
  })
})

describe('formatCustomFieldValue()', () => {
  it('applies the Brazilian masks to stored digits', () => {
    expect(formatCustomFieldValue('CPF', '52998224725')).toBe('529.982.247-25')
    expect(formatCustomFieldValue('CNPJ', '11222333000181')).toBe(
      '11.222.333/0001-81',
    )
    expect(formatCustomFieldValue('CEP', '01310100')).toBe('01310-100')
    expect(formatCustomFieldValue('PHONE', '11999998888')).toBe(
      '(11) 99999-8888',
    )
  })

  it('renders booleans, dates and empty values', () => {
    expect(formatCustomFieldValue('BOOLEAN', true)).toBe('Sim')
    expect(formatCustomFieldValue('DATE', '2026-12-25T00:00:00.000Z')).toBe(
      '25/12/2026',
    )
    expect(formatCustomFieldValue('CPF', null)).toBe('')
  })
})

describe('customFieldKeyFromLabel()', () => {
  it('builds a snake_case key without accents', () => {
    expect(customFieldKeyFromLabel('Razão Social')).toBe('razao_social')
    expect(customFieldKeyFromLabel('CPF')).toBe('cpf')
    expect(customFieldKeyFromLabel('2º contato')).toMatch(/^[a-z][a-z0-9_]*$/)
  })
})
