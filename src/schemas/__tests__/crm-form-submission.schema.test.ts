import { describe, expect, it } from 'vitest'
import type { CrmFormFieldDTO } from '../crm-form.schema'
import {
  SUBMISSION_TEXT_MAX,
  SUBMISSION_TEXTAREA_MAX,
  validateCrmFormSubmission,
} from '../crm-form-submission.schema'

function field(
  type: CrmFormFieldDTO['type'],
  extra: Partial<CrmFormFieldDTO> = {},
): CrmFormFieldDTO {
  return {
    key: 'f',
    label: 'Campo',
    type,
    required: false,
    mapping: { target: 'lead', attribute: 'name' },
    ...extra,
  }
}

function check(f: CrmFormFieldDTO, value: string | boolean | undefined) {
  return validateCrmFormSubmission(
    [f],
    value === undefined ? {} : { [f.key]: value },
  )
}

function messageOf(f: CrmFormFieldDTO, value: string | boolean | undefined) {
  return check(f, value).issues[0]?.message ?? null
}

describe('validateCrmFormSubmission()', () => {
  it('should flag required text fields that are missing or blank', () => {
    const f = field('text', { required: true })
    expect(messageOf(f, undefined)).toBe('Campo obrigatório')
    expect(messageOf(f, '   ')).toBe('Campo obrigatório')
    expect(check(f, ' Ana ').values).toEqual({ f: 'Ana' })
  })

  it('should omit empty optional fields', () => {
    expect(check(field('text'), '').values).toEqual({})
    expect(check(field('text'), undefined)).toEqual({ values: {}, issues: [] })
  })

  it('should reject a boolean in a text field', () => {
    expect(messageOf(field('text'), true)).toBe('Valor deve ser um texto')
  })

  it.each([
    ['email', 'ana@acme.com', 'ana@', 'E-mail inválido'],
    ['phone', '+55 (11) 99999-0000', '12-34', 'Telefone inválido'],
    ['number', '1.234', 'doze', 'Informe um número'],
    ['url', 'https://acme.com', 'ftp://acme.com', 'Endereço inválido'],
    ['url', 'http://acme.com/a', 'acme', 'Endereço inválido'],
    ['date', '2026-10-09', '2026-02-30', 'Data inválida (use AAAA-MM-DD)'],
    ['date', '2024-02-29', '09/10/2026', 'Data inválida (use AAAA-MM-DD)'],
  ] as const)('should validate %s values', (type, good, bad, message) => {
    expect(check(field(type), good).issues).toEqual([])
    expect(messageOf(field(type), bad)).toBe(message)
  })

  it('should accept a decimal comma in numbers', () => {
    expect(check(field('number'), '3,5').issues).toEqual([])
  })

  it('should only accept a defined select option', () => {
    const f = field('select', {
      options: [{ label: 'Pequena', value: 'small' }],
    })
    expect(check(f, 'small').values).toEqual({ f: 'small' })
    expect(messageOf(f, 'huge')).toBe('Opção inválida')
    expect(messageOf(field('select'), 'small')).toBe('Opção inválida')
  })

  it('should cap text and textarea lengths', () => {
    expect(messageOf(field('text'), 'a'.repeat(SUBMISSION_TEXT_MAX + 1))).toBe(
      `Use no máximo ${SUBMISSION_TEXT_MAX} caracteres`,
    )
    expect(
      check(field('textarea'), 'a'.repeat(SUBMISSION_TEXT_MAX + 1)).issues,
    ).toEqual([])
    expect(
      messageOf(field('textarea'), 'a'.repeat(SUBMISSION_TEXTAREA_MAX + 1)),
    ).toBe(`Use no máximo ${SUBMISSION_TEXTAREA_MAX} caracteres`)
  })

  it('should validate checkboxes as booleans and require true when required', () => {
    expect(check(field('checkbox'), false).values).toEqual({ f: false })
    expect(check(field('checkbox'), undefined).values).toEqual({})
    expect(messageOf(field('checkbox'), 'yes')).toBe(
      'Valor deve ser verdadeiro ou falso',
    )
    const consent = field('checkbox', { required: true })
    expect(messageOf(consent, false)).toBe('Campo obrigatório')
    expect(messageOf(consent, undefined)).toBe('Campo obrigatório')
    expect(check(consent, true).values).toEqual({ f: true })
  })

  it('should drop keys that are not fields and report the field path', () => {
    const result = validateCrmFormSubmission(
      [field('email', { key: 'email', required: true })],
      { email: 'x', company_website: 'spam' },
    )
    expect(result.values).toEqual({})
    expect(result.issues).toEqual([
      { code: 'custom', path: ['values', 'email'], message: 'E-mail inválido' },
    ])
  })
})
