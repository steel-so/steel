import {
  DOCUMENT_KIND_LABELS,
  DOCUMENT_STATUS_LABELS,
  type DocumentKindDTO,
  type DocumentStatusDTO,
} from '@/src/schemas/document.schema'
import type { DocumentRecipientDTO } from '@/types/document'

/**
 * Colors and formatting of CRM > Documentos — the only place with palette
 * colors in this area (same pattern as `deals-tone.ts`); everything else
 * uses semantic tokens. Dates are shown in the workspace timezone
 * (workspaces have no timezone setting yet: São Paulo, like the rest of
 * the CRM), never the browser's.
 */

export const DOCUMENT_STATUS_TONE: Record<DocumentStatusDTO, string> = {
  DRAFT: 'border-border bg-muted text-muted-foreground',
  SENT: 'border-sky-500/25 bg-sky-500/10 text-sky-700 dark:text-sky-300',
  VIEWED:
    'border-violet-500/25 bg-violet-500/10 text-violet-700 dark:text-violet-300',
  ACCEPTED:
    'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  DECLINED:
    'border-rose-500/25 bg-rose-500/10 text-rose-700 dark:text-rose-300',
  EXPIRED:
    'border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  ARCHIVED: 'border-border bg-muted text-muted-foreground',
}

export const RECIPIENT_STATUS_LABELS: Record<
  DocumentRecipientDTO['status'],
  string
> = {
  PENDING: 'Não abriu',
  VIEWED: 'Abriu',
  ACCEPTED: 'Aceitou',
  DECLINED: 'Recusou',
}

export const RECIPIENT_STATUS_TONE: Record<
  DocumentRecipientDTO['status'],
  string
> = {
  PENDING: 'border-border bg-muted text-muted-foreground',
  VIEWED:
    'border-violet-500/25 bg-violet-500/10 text-violet-700 dark:text-violet-300',
  ACCEPTED:
    'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  DECLINED:
    'border-rose-500/25 bg-rose-500/10 text-rose-700 dark:text-rose-300',
}

export const RECIPIENT_ROLE_LABELS: Record<
  DocumentRecipientDTO['role'],
  string
> = {
  APPROVER: 'Aprovador',
  VIEWER: 'Leitor',
}

export const RECIPIENT_CHANNEL_LABELS: Record<
  DocumentRecipientDTO['channel'],
  string
> = {
  LINK: 'Link',
  EMAIL: 'E-mail',
  WHATSAPP: 'WhatsApp',
}

/** Timezone the CRM shows dates in. */
export const DOCUMENT_TIME_ZONE = 'America/Sao_Paulo'

/** dd/mm/aaaa in the workspace timezone. */
export function formatDocumentDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('pt-BR', {
    timeZone: DOCUMENT_TIME_ZONE,
  })
}

/** dd/mm/aaaa HH:mm in the workspace timezone. */
export function formatDocumentDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('pt-BR', {
    timeZone: DOCUMENT_TIME_ZONE,
    dateStyle: 'short',
    timeStyle: 'short',
  })
}

/** "há 5 min", "há 3 h", "há 2 dias" or the date, relative to `now`. */
export function formatDocumentRelative(
  iso: string | null | undefined,
  now: number,
): string {
  if (!iso) return '—'
  const diff = Math.max(0, now - new Date(iso).getTime())
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return 'agora'
  if (minutes < 60) return `há ${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `há ${hours} h`
  const days = Math.floor(hours / 24)
  if (days < 7) return days === 1 ? 'há 1 dia' : `há ${days} dias`
  return formatDocumentDate(iso)
}

const BRL = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
})

export function formatDocumentMoney(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : BRL.format(value)
}

/** `yyyy-mm-dd` of an ISO date in the workspace timezone (date inputs). */
export function toDateInputValue(iso: string | null | undefined): string {
  if (!iso) return ''
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: DOCUMENT_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso))
}

/**
 * ISO of the end of a `yyyy-mm-dd` day in São Paulo (UTC−3, no DST since
 * 2019): a document valid "until 30/11" stays open the whole day.
 */
export function fromDateInputValue(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  return new Date(`${value}T23:59:59.000-03:00`).toISOString()
}

export function kindLabel(kind: DocumentKindDTO): string {
  return DOCUMENT_KIND_LABELS[kind] ?? kind
}

export function statusLabel(status: DocumentStatusDTO): string {
  return DOCUMENT_STATUS_LABELS[status] ?? status
}
