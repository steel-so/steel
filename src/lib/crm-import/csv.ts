import { normalizeCsvHeader, parseCsv } from '@/src/lib/servicedesk/csv'
import type {
  CrmImportEntity,
  CrmImportRow,
} from '@/src/schemas/crm-import.schema'

/**
 * CSV of leads, people or companies, parsed in the browser before the import.
 * Pure: accepts `,` or `;`, quotes and a BOM. Columns are found by their
 * header in pt-BR or English (`Nome`, `E-mail`, `Telefone`…).
 */

type Field = keyof CrmImportRow

const ALIASES: Record<Field, string[]> = {
  name: ['nome', 'name', 'nome_completo', 'full_name', 'contato'],
  email: [
    'email',
    'e_mail',
    'mail',
    'emails',
    'email_address',
    'endereco_de_email',
    'endereco_de_e_mail',
  ],
  phone: [
    'telefone',
    'phone',
    'celular',
    'whatsapp',
    'fone',
    'telefones',
    'tel',
    'mobile',
  ],
  company: ['empresa', 'company', 'organizacao', 'organization'],
  jobTitle: ['cargo', 'job_title', 'jobtitle', 'funcao', 'title'],
  city: ['cidade', 'city', 'municipio'],
  state: ['estado', 'uf', 'state'],
  linkedin: ['linkedin', 'linkedin_url'],
  source: ['origem', 'source', 'fonte'],
  channel: ['canal', 'channel'],
  cnpj: ['cnpj'],
  domain: ['dominio', 'domain', 'site', 'website', 'url'],
  employees: [
    'funcionarios',
    'employees',
    'numero_de_funcionarios',
    'qtd_funcionarios',
  ],
}

/** Which fields each entity reads from the file. */
const FIELDS: Record<CrmImportEntity, Field[]> = {
  leads: [
    'name',
    'email',
    'phone',
    'company',
    'jobTitle',
    'city',
    'linkedin',
    'source',
    'channel',
  ],
  people: ['name', 'email', 'phone', 'company', 'jobTitle', 'city', 'linkedin'],
  companies: [
    'name',
    'cnpj',
    'domain',
    'employees',
    'city',
    'state',
    'linkedin',
  ],
}

/** In a company file the "Empresa" column is the company's own name. */
const COMPANY_NAME_ALIASES = [
  'empresa',
  'razao_social',
  'nome_fantasia',
  'company',
  'nome',
  'name',
]

export const CRM_IMPORT_ENTITY_LABELS: Record<
  CrmImportEntity,
  { plural: string; columns: string }
> = {
  leads: {
    plural: 'leads',
    columns: 'nome, e-mail, telefone, empresa, cargo, cidade, origem',
  },
  people: {
    plural: 'pessoas',
    columns: 'nome, e-mail, telefone, empresa, cargo, cidade',
  },
  companies: {
    plural: 'empresas',
    columns: 'nome, CNPJ, site, funcionários, cidade, estado',
  },
}

export type CrmImportCsvParse = {
  rows: CrmImportRow[]
  /** Field → header found in the file. */
  columns: Partial<Record<Field, string>>
  /** Why nothing could be read. */
  error: string | null
}

export function parseCrmImportCsv(
  text: string,
  entity: CrmImportEntity,
): CrmImportCsvParse {
  const [head, ...body] = parseCsv(text)
  if (!head) return { rows: [], columns: {}, error: 'O arquivo está vazio.' }

  const headers = head.map(normalizeCsvHeader)
  const used = new Set<number>()
  const indexes: Partial<Record<Field, number>> = {}

  // The name goes first so that "Empresa" is not taken twice.
  const order: Field[] = ['name', ...FIELDS[entity].filter((f) => f !== 'name')]
  for (const field of order) {
    const aliases =
      field === 'name' && entity === 'companies'
        ? COMPANY_NAME_ALIASES
        : ALIASES[field]
    const index = headers.findIndex(
      (h, i) => !used.has(i) && aliases.includes(h),
    )
    if (index >= 0) {
      indexes[field] = index
      used.add(index)
    }
  }

  if (indexes.name === undefined) {
    return {
      rows: [],
      columns: {},
      error:
        entity === 'companies'
          ? 'Não encontramos a coluna do nome da empresa. Use um cabeçalho "nome" ou "empresa".'
          : 'Não encontramos a coluna de nome. Use um cabeçalho "nome".',
    }
  }
  if (
    entity !== 'companies' &&
    indexes.email === undefined &&
    indexes.phone === undefined
  ) {
    return {
      rows: [],
      columns: {},
      error:
        'Não encontramos a coluna de e-mail nem a de telefone. Cada linha precisa de pelo menos um dos dois.',
    }
  }

  const columns: CrmImportCsvParse['columns'] = {}
  for (const [field, index] of Object.entries(indexes) as [Field, number][]) {
    columns[field] = head[index]
  }

  const rows = body.map((cells) => {
    const row: CrmImportRow = {}
    for (const [field, index] of Object.entries(indexes) as [Field, number][]) {
      const value = (cells[index] ?? '').trim()
      if (value) row[field] = value
    }
    return row
  })
  return { rows, columns, error: null }
}

/** Header line + one example row, offered as a download. */
export function crmImportTemplate(entity: CrmImportEntity): string {
  if (entity === 'companies') {
    return 'nome;cnpj;site;funcionarios;cidade;estado\nAcme Ltda;12.345.678/0001-90;acme.com.br;50;São Paulo;SP\n'
  }
  if (entity === 'people') {
    return 'nome;email;telefone;empresa;cargo;cidade\nAna Souza;ana@acme.com.br;(11) 91234-5678;Acme Ltda;Compras;São Paulo\n'
  }
  return 'nome;email;telefone;empresa;cargo;cidade;origem\nAna Souza;ana@acme.com.br;(11) 91234-5678;Acme Ltda;Compras;São Paulo;Feira\n'
}
