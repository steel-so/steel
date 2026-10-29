import { describe, expect, it } from 'vitest'
import { parseNewsletterCsv } from '../newsletter/import-csv'

describe('parseNewsletterCsv', () => {
  it('reads the e-mail and name columns by header (semicolon, BOM)', () => {
    const parsed = parseNewsletterCsv(
      '﻿Nome;E-mail;Empresa\r\nAna;ana@x.com;Acme\r\n;bruno@x.com;\r\n',
    )
    expect(parsed).toEqual({
      rows: [{ email: 'ana@x.com', name: 'Ana' }, { email: 'bruno@x.com' }],
      emailColumn: 'E-mail',
      nameColumn: 'Nome',
      error: null,
    })
  })

  it('accepts a header with only the e-mail', () => {
    const parsed = parseNewsletterCsv('email\n a@x.com \n')
    expect(parsed.rows).toEqual([{ email: 'a@x.com' }])
    expect(parsed.nameColumn).toBeNull()
  })

  it('reads a file without header by the first column with "@"', () => {
    const parsed = parseNewsletterCsv('Ana,ana@x.com\nBia,bia@x.com')
    expect(parsed.rows).toEqual([
      { email: 'ana@x.com' },
      { email: 'bia@x.com' },
    ])
    expect(parsed.emailColumn).toBeNull()
  })

  it('explains what is missing', () => {
    expect(parseNewsletterCsv('').error).toBe('O arquivo está vazio')
    expect(parseNewsletterCsv('nome,cidade\nAna,SP').error).toContain(
      'coluna de e-mail',
    )
  })

  it('keeps short rows as empty e-mails (the server rejects them)', () => {
    expect(parseNewsletterCsv('nome,email\nAna').rows).toEqual([
      { email: '', name: 'Ana' },
    ])
  })
})
