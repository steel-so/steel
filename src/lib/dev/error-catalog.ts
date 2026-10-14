import type { ErrorCode } from '@/src/errors/codes'
import {
  defaultMessage,
  ERROR_CODE_LIST,
  STATUS_TITLES,
  statusOf,
} from '@/src/openapi/errors'

/**
 * The error code table of the developer guide ("Formato de resposta e
 * erros"), built from `src/errors/codes.ts` — the same registry the API
 * answers with — so a new code shows up in the guide on the next deploy and
 * a removed one disappears. Never typed by hand.
 */

/**
 * Status titles of the API reference, plus the ones only a few codes use
 * (the reference shows those per route, so it never needed a title).
 */
export const ERROR_STATUS_TITLES: Record<number, string> = {
  ...STATUS_TITLES,
  413: 'Conteúdo grande demais',
  415: 'Formato não suportado',
  423: 'Recurso bloqueado',
}

export interface ErrorCatalogEntry {
  code: ErrorCode
  /** Default message of the code's factory in `app-error.ts`, if any. */
  message: string | null
}

export interface ErrorCatalogGroup {
  status: number
  title: string
  codes: ErrorCatalogEntry[]
}

/** Codes grouped by HTTP status (ascending), alphabetical inside a group. */
export function buildErrorCatalog(
  codes: readonly ErrorCode[] = ERROR_CODE_LIST,
  titles: Record<number, string> = ERROR_STATUS_TITLES,
): ErrorCatalogGroup[] {
  const byStatus = new Map<number, ErrorCatalogEntry[]>()
  for (const code of codes) {
    const status = statusOf(code)
    const group = byStatus.get(status) ?? []
    group.push({ code, message: defaultMessage(code) ?? null })
    byStatus.set(status, group)
  }
  return [...byStatus.entries()]
    .sort(([a], [b]) => a - b)
    .map(([status, entries]) => ({
      status,
      title: titles[status] ?? `HTTP ${status}`,
      codes: entries.sort((a, b) => (a.code < b.code ? -1 : 1)),
    }))
}

const cell = (text: string) => text.replace(/\|/g, '\\|').replace(/\n/g, ' ')

/**
 * The same table as markdown, for `llms-full.txt`, where the page's
 * `<ErrorCodeTable />` component can't render.
 */
export function errorCatalogMarkdown(
  groups: ErrorCatalogGroup[] = buildErrorCatalog(),
): string {
  return groups
    .map((group) =>
      [
        `#### ${group.status} — ${group.title}`,
        '',
        '| Código | Mensagem padrão |',
        '| ------ | --------------- |',
        ...group.codes.map(
          (entry) =>
            `| \`${entry.code}\` | ${entry.message ? cell(entry.message) : '—'} |`,
        ),
      ].join('\n'),
    )
    .join('\n\n')
}
