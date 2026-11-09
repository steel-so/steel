import { describe, expect, it } from 'vitest'
import {
  CONTACT_IMPORT_MAX_ROWS,
  CONTACT_IMPORT_TEMPLATE_CSV,
  contactImportTemplateCsv,
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

  it('accepts the short sheet (Nome | Número | Detalhes)', () => {
    const result = parseContactImportCsv(
      'Nome;Número;Detalhes\nAna;+55 (11) 98888-7777;VIP\nBia;5511977776666;',
    )
    expect(result.fileError).toBeUndefined()
    expect(result.rejected).toEqual([])
    expect(result.valid).toEqual([
      { line: 2, waId: '5511988887777', name: 'Ana', description: 'VIP' },
      { line: 3, waId: '5511977776666', name: 'Bia', description: undefined },
    ])
  })

  it.each([
    ['comma separated', 'Nome,Telefone,Descrição\nAna,5511988887777,x'],
    [
      'lowercase and no accents',
      'nome;telefone;descricao\nAna;5511988887777;x',
    ],
    ['spaces around names', ' Nome ; NÚMERO ; Detalhes \nAna;5511988887777;x'],
    ['BOM and CRLF', '\ufeffNome;Número;Detalhes\r\nAna;5511988887777;x\r\n'],
    ['columns out of order', 'Detalhes;Número;Nome\nx;5511988887777;Ana'],
    ['extra columns', 'Nome;Telefone;Descrição;Cidade\nAna;5511988887777;x;SP'],
  ])('accepts headers: %s', (_label, csv) => {
    const result = parseContactImportCsv(csv)
    expect(result.fileError).toBeUndefined()
    expect(result.valid).toHaveLength(1)
    expect(result.valid[0]).toMatchObject({
      waId: '5511988887777',
      name: 'Ana',
    })
  })

  it.each([
    ['missing description', 'Nome;Telefone\nAna;5511988887777'],
    ['missing name', 'Telefone;Descrição\n5511988887777;x'],
    ['missing phone', 'Nome;Descrição\nAna;x'],
    ['missing details', 'Nome;Número\nAna;5511988887777'],
    ['wrong phone name', 'Nome;Celular;Descrição\nAna;5511988887777;x'],
    ['wrong name header', 'Contato;Telefone;Descrição\nAna;5511988887777;x'],
    ['mixed formats', 'Nome;Número;Descrição\nAna;5511988887777;x'],
    ['mixed formats (reverse)', 'Nome;Telefone;Detalhes\nAna;5511988887777;x'],
    ['no header row', 'Ana;5511988887777;x\nBia;5511977776666;y'],
    ['phone only', 'Telefone\n5511988887777'],
  ])('rejects the whole file when headers are wrong: %s', (_label, csv) => {
    const result = parseContactImportCsv(csv)
    expect(result.fileError).toMatch(/cabeçalhos/)
    expect(result.valid).toEqual([])
    expect(result.rejected).toEqual([])
  })

  it('rejects invalid, blank and duplicated phones per row', () => {
    const result = parseContactImportCsv(
      'Nome;Telefone;Descrição\nA;123;\nB;;\nC;5511999998888;\nD;5511999998888;',
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

  it('returns a file error for empty files and too many rows', () => {
    expect(parseContactImportCsv('Nome;Telefone;Descrição').fileError).toMatch(
      /não tem linhas/,
    )
    const many = `Nome;Telefone;Descrição\n${Array.from({ length: CONTACT_IMPORT_MAX_ROWS + 1 }, (_, i) => `55119${String(i).padStart(8, '0')}`).join('\n')}`
    expect(parseContactImportCsv(many).fileError).toMatch(/no máximo/)
  })

  it('normalizes phones to digits', () => {
    expect(normalizeContactPhone('+55 (11) 9999-8888')).toBe('551199998888')
  })
})

describe('parseContactImportCsv with contact fields', () => {
  const fields = [
    { id: 'f_cpf', label: 'CPF', type: 'CPF' as const },
    { id: 'f_cnpj', label: 'CNPJ', type: 'CNPJ' as const },
  ]

  it('reads extra columns by field label and stores digits only', () => {
    const result = parseContactImportCsv(
      'Nome;Telefone;Descrição;CPF;CNPJ\nAna;5511988887777;x;529.982.247-25;11.222.333/0001-81',
      fields,
    )
    expect(result.rejected).toEqual([])
    expect(result.valid[0].customFields).toEqual({
      f_cpf: '52998224725',
      f_cnpj: '11222333000181',
    })
  })

  it('rejects only the row with an invalid document', () => {
    const result = parseContactImportCsv(
      'Nome;Telefone;Descrição;CPF\nAna;5511988887777;x;111.111.111-11\nBia;5511977776666;x;529.982.247-25',
      fields,
    )
    expect(result.valid.map((row) => row.waId)).toEqual(['5511977776666'])
    expect(result.rejected).toEqual([
      { line: 2, message: '"CPF" tem um CPF inválido' },
    ])
  })

  it('leaves blank cells out so they never erase stored data', () => {
    const result = parseContactImportCsv(
      'Nome;Telefone;Descrição;CPF\nAna;5511988887777;x;',
      fields,
    )
    expect(result.valid[0].customFields).toBeUndefined()
  })

  it('builds the template with one column per field', () => {
    expect(contactImportTemplateCsv([])).toBe(CONTACT_IMPORT_TEMPLATE_CSV)
    expect(contactImportTemplateCsv(['CPF', 'CNPJ'])).toContain(
      'Nome;Telefone;Descrição;CPF;CNPJ',
    )
  })
})
