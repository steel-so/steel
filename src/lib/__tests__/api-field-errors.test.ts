import { describe, expect, it } from 'vitest'
import {
  fieldErrorsFromIssues,
  formatFieldErrors,
  readFieldErrors,
} from '@/src/lib/api-field-errors'

describe('fieldErrorsFromIssues', () => {
  it('groups issues by dotted path and uses _ for root issues', () => {
    expect(
      fieldErrorsFromIssues([
        { path: ['email'], message: 'Inválido' },
        { path: ['email'], message: 'Obrigatório' },
        { path: ['address', 'zip'], message: 'CEP inválido' },
        { path: [], message: 'Dados inválidos' },
        { message: 'Sem caminho' },
      ]),
    ).toEqual({
      email: ['Inválido', 'Obrigatório'],
      'address.zip': ['CEP inválido'],
      _: ['Dados inválidos', 'Sem caminho'],
    })
  })

  it('returns null for anything that is not a list of issues', () => {
    expect(fieldErrorsFromIssues(undefined)).toBeNull()
    expect(fieldErrorsFromIssues([])).toBeNull()
    expect(fieldErrorsFromIssues([1, 2])).toBeNull()
    expect(fieldErrorsFromIssues({ a: 1 })).toBeNull()
  })
})

describe('readFieldErrors', () => {
  it('reads error.fieldErrors', () => {
    expect(readFieldErrors({ fieldErrors: { name: ['Obrigatório'] } })).toEqual({
      name: ['Obrigatório'],
    })
  })

  it('reads details.fieldErrors (Zod flatten)', () => {
    expect(
      readFieldErrors({ details: { fieldErrors: { name: ['Curto'], x: [] } } }),
    ).toEqual({ name: ['Curto'] })
  })

  it('reads details as the raw issues array', () => {
    expect(
      readFieldErrors({ details: [{ path: ['name'], message: 'Obrigatório' }] }),
    ).toEqual({ name: ['Obrigatório'] })
  })

  it('returns null when there is nothing usable', () => {
    expect(readFieldErrors(null)).toBeNull()
    expect(readFieldErrors('x')).toBeNull()
    expect(readFieldErrors({ fieldErrors: {} })).toBeNull()
    expect(readFieldErrors({ fieldErrors: [] })).toBeNull()
    expect(readFieldErrors({ details: { other: 1 } })).toBeNull()
  })
})

describe('formatFieldErrors', () => {
  it('writes "campo: motivo" joined by a middle dot', () => {
    expect(
      formatFieldErrors({ name: ['Obrigatório', 'x'], email: ['Inválido'] }),
    ).toBe('name: Obrigatório · email: Inválido')
  })

  it('omits the field label for root issues', () => {
    expect(formatFieldErrors({ _: ['Dados inválidos'] })).toBe('Dados inválidos')
  })
})
