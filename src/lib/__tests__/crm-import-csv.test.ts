import { describe, expect, it } from 'vitest'
import { crmImportTemplate, parseCrmImportCsv } from '../crm-import/csv'

describe('parseCrmImportCsv', () => {
  it('reads lead columns by header (semicolon, BOM, accents)', () => {
    const parsed = parseCrmImportCsv(
      '﻿Nome;E-mail;Telefone;Empresa;Cargo;Cidade;Origem\r\nAna;ana@x.com;(11) 91234-5678;Acme;Compras;São Paulo;Feira\r\n',
      'leads',
    )
    expect(parsed.error).toBeNull()
    expect(parsed.rows).toEqual([
      {
        name: 'Ana',
        email: 'ana@x.com',
        phone: '(11) 91234-5678',
        company: 'Acme',
        jobTitle: 'Compras',
        city: 'São Paulo',
        source: 'Feira',
      },
    ])
    expect(parsed.columns.email).toBe('E-mail')
  })

  it('drops empty cells and tolerates short rows', () => {
    const parsed = parseCrmImportCsv('nome,email\nAna\n,b@x.com', 'people')
    expect(parsed.rows).toEqual([{ name: 'Ana' }, { email: 'b@x.com' }])
  })

  it('accepts English headers', () => {
    const parsed = parseCrmImportCsv(
      'name,phone,job_title\nBia,11999990000,CEO',
      'people',
    )
    expect(parsed.rows).toEqual([
      { name: 'Bia', phone: '11999990000', jobTitle: 'CEO' },
    ])
  })

  it('reads the company name from "Empresa" in a company file', () => {
    const parsed = parseCrmImportCsv(
      'Empresa;CNPJ;Site;Funcionários;Cidade;UF\nAcme;12.345.678/0001-90;acme.com.br;50;Recife;PE',
      'companies',
    )
    expect(parsed.error).toBeNull()
    expect(parsed.rows).toEqual([
      {
        name: 'Acme',
        cnpj: '12.345.678/0001-90',
        domain: 'acme.com.br',
        employees: '50',
        city: 'Recife',
        state: 'PE',
      },
    ])
  })

  it('does not take "Empresa" as the name when a name column exists (leads)', () => {
    const parsed = parseCrmImportCsv(
      'Empresa,Nome,Email\nAcme,Ana,a@x.com',
      'leads',
    )
    expect(parsed.rows).toEqual([
      { name: 'Ana', company: 'Acme', email: 'a@x.com' },
    ])
  })

  it('explains what is missing', () => {
    expect(parseCrmImportCsv('', 'leads').error).toBe('O arquivo está vazio.')
    expect(parseCrmImportCsv('email\na@x.com', 'leads').error).toContain(
      'coluna de nome',
    )
    expect(parseCrmImportCsv('cidade\nSP', 'companies').error).toContain(
      'nome da empresa',
    )
    expect(parseCrmImportCsv('nome,cidade\nAna,SP', 'people').error).toContain(
      'e-mail nem a de telefone',
    )
  })

  it('does not require contacts in a company file', () => {
    const parsed = parseCrmImportCsv('nome\nAcme', 'companies')
    expect(parsed.error).toBeNull()
    expect(parsed.rows).toEqual([{ name: 'Acme' }])
  })

  it('offers a download template that parses back for each entity', () => {
    for (const entity of ['leads', 'people', 'companies'] as const) {
      const parsed = parseCrmImportCsv(crmImportTemplate(entity), entity)
      expect(parsed.error).toBeNull()
      expect(parsed.rows).toHaveLength(1)
      expect(parsed.rows[0].name).toBeTruthy()
    }
  })
})
