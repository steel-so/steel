import { normalizeCsvHeader, parseCsv } from '@/src/lib/servicedesk/csv'

/**
 * CSV of newsletter subscribers, parsed in the browser before the import
 * (ADR 0054). Pure: accepts `,` or `;`, quotes and a BOM. The e-mail column
 * is found by its header (`email`, `e-mail`, `endereço de e-mail`…) or, in a
 * file without header, by the first column holding an "@".
 */

const EMAIL_HEADERS = [
  'email',
  'e_mail',
  'mail',
  'endereco_de_e_mail',
  'endereco_de_email',
  'email_address',
]
const NAME_HEADERS = ['nome', 'name', 'nome_completo', 'full_name', 'contato']

export type NewsletterCsvParse = {
  rows: { email: string; name?: string }[]
  /** Header used for the e-mail (null in a file without header). */
  emailColumn: string | null
  nameColumn: string | null
  /** Why nothing could be read (no e-mail column). */
  error: string | null
}

const looksLikeEmail = (value: string | undefined) =>
  typeof value === 'string' && /@/.test(value)

export function parseNewsletterCsv(text: string): NewsletterCsvParse {
  const table = parseCsv(text)
  const [head, ...body] = table
  if (!head) {
    return {
      rows: [],
      emailColumn: null,
      nameColumn: null,
      error: 'O arquivo está vazio',
    }
  }

  const headers = head.map(normalizeCsvHeader)
  let emailIndex = headers.findIndex((h) => EMAIL_HEADERS.includes(h))
  const nameIndex = headers.findIndex((h) => NAME_HEADERS.includes(h))
  let data = body
  let emailColumn: string | null = emailIndex >= 0 ? head[emailIndex] : null

  if (emailIndex < 0) {
    // No header: the first row is already data.
    emailIndex = head.findIndex(looksLikeEmail)
    if (emailIndex < 0) {
      return {
        rows: [],
        emailColumn: null,
        nameColumn: null,
        error:
          'Não encontramos a coluna de e-mail. Use um cabeçalho "email" (e, se quiser, "nome").',
      }
    }
    data = table
    emailColumn = null
  }

  const rows = data.map((cells) => {
    const email = (cells[emailIndex] ?? '').trim()
    const name =
      nameIndex >= 0 && emailColumn !== null
        ? (cells[nameIndex] ?? '').trim()
        : ''
    return name ? { email, name } : { email }
  })
  return {
    rows,
    emailColumn,
    nameColumn: nameIndex >= 0 && emailColumn !== null ? head[nameIndex] : null,
    error: null,
  }
}
