import { describe, expect, it } from 'vitest'
import {
  CONTACT_IMPORT_MAX_ROWS,
  CONTACT_IMPORT_TEMPLATE_CSV,
  normalizeContactPhone,
  parseContactImportCsv,
} from '../whatsapp/contact-import'

describe('parseContactImportCsv', () => {
  it('parses the standard template (semicolon, BOM, accents)', () => {
    const result = parseContactImportCsv(CONTACT_IMPORT_TEMPLATE_CSV)
    expect(result.fileError).toBeUndefined()
    expect(result.rejected).toEqual([])
    expect(result.valid).toEqual([
      {
        line: 2,
        waId: '5511999998888',
        name: 'Maria Silva',
        description: 'Cliente desde 2024',
      },
    ])
  })

  it('accepts comma separated files and column aliases', () => {
    const result = parseContactImportCsv(
      'Celular,Nome\n+55 (11) 98888-7777,Ana',
    )
    expect(result.valid).toEqual([
      { line: 2, waId: '5511988887777', name: 'Ana', description: undefined },
    ])
  })

  it('rejects invalid, blank and duplicated phones per row', () => {
    const result = parseContactImportCsv(
      'Nome;Telefone\nA;123\nB;\nC;5511999998888\nD;5511999998888',
    )
    expect(result.valid.map((r) => r.line)).toEqual([4])
    expect(result.rejected).toEqual([
      { line: 2, message: expect.stringContaining('Telefone inválido') },
      { line: 3, message: 'Telefone em branco.' },
      { line: 5, message: expect.stringContaining('linha 4') },
    ])
  })

  it('rejects names and descriptions that are too long', () => {
    const result = parseContactImportCsv(
      `Nome;Telefone;Descrição\n${'x'.repeat(121)};5511999998888;\nB;5511999998887;${'y'.repeat(501)}`,
    )
    expect(result.valid).toEqual([])
    expect(result.rejected.map((r) => r.line)).toEqual([2, 3])
  })

  it('returns a file error for empty files, missing phone column and too many rows', () => {
    expect(parseContactImportCsv('Nome;Telefone').fileError).toMatch(
      /não tem linhas/,
    )
    expect(parseContactImportCsv('Nome\nAna').fileError).toMatch(/Telefone/)
    const many = `Telefone\n${Array.from({ length: CONTACT_IMPORT_MAX_ROWS + 1 }, (_, i) => `55119${String(i).padStart(8, '0')}`).join('\n')}`
    expect(parseContactImportCsv(many).fileError).toMatch(/no máximo/)
  })

  it('normalizes phones to digits', () => {
    expect(normalizeContactPhone('+55 (11) 9999-8888')).toBe('551199998888')
  })
})
