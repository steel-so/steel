import type {
  CrmNewsletterIssueRecipientDTO,
  CrmNewsletterIssueStatusValue,
  CrmNewsletterRecipientFilter,
} from '@/src/schemas/crm-newsletter-issue.schema'

/**
 * Labels and formatting of the newsletter issue screens. Dates read in
 * São Paulo time (workspaces have no timezone of their own, like the rest
 * of the CRM) — never the browser's.
 */
export const NEWSLETTER_TIME_ZONE = 'America/Sao_Paulo'

export const ISSUE_STATUS_LABEL: Record<CrmNewsletterIssueStatusValue, string> =
  {
    DRAFT: 'Rascunho',
    SCHEDULED: 'Agendada',
    SENDING: 'Enviando',
    SENT: 'Enviada',
    CANCELED: 'Interrompida',
    FAILED: 'Falhou',
  }

export const ISSUE_STATUS_VARIANT: Record<
  CrmNewsletterIssueStatusValue,
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  DRAFT: 'outline',
  SCHEDULED: 'secondary',
  SENDING: 'default',
  SENT: 'secondary',
  CANCELED: 'outline',
  FAILED: 'destructive',
}

export const DELIVERY_STATUS_LABEL: Record<
  CrmNewsletterIssueRecipientDTO['status'],
  string
> = {
  PENDING: 'Na fila',
  SENDING: 'Enviando',
  SENT: 'Enviado',
  SKIPPED: 'Não enviado',
  FAILED: 'Falhou',
}

export const SKIP_REASON_LABEL: Record<string, string> = {
  OPTED_OUT: 'Descadastro geral (LGPD)',
  UNSUBSCRIBED: 'Saiu da newsletter',
  BOUNCED: 'Endereço inválido',
  COMPLAINED: 'Marcou como spam',
  LIMIT_REACHED: 'Limite do mês atingido',
  STOPPED: 'Envio interrompido',
}

export const RECIPIENT_FILTER_LABEL: Record<
  CrmNewsletterRecipientFilter,
  string
> = {
  all: 'Todos',
  delivered: 'Entregues',
  opened: 'Abriram',
  not_opened: 'Não abriram',
  clicked: 'Clicaram',
  bounced: 'Retornaram',
  complained: 'Marcaram como spam',
  unsubscribed: 'Saíram',
  failed: 'Falharam',
  skipped: 'Não enviados',
}

const dateTime = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: NEWSLETTER_TIME_ZONE,
})

const dateOnly = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  timeZone: NEWSLETTER_TIME_ZONE,
})

/** "28 de out. de 2026, 14:32" (São Paulo). */
export function formatIssueDateTime(iso: string | null): string {
  return iso ? dateTime.format(new Date(iso)) : '—'
}

/** "28 de out. de 2026" (São Paulo). */
export function formatIssueDate(iso: string | null): string {
  return iso ? dateOnly.format(new Date(iso)) : '—'
}

/** "12,5%" of `part` over `total`, or "—". */
export function formatRate(part: number, total: number): string {
  if (total <= 0) return '—'
  return `${((part / total) * 100).toLocaleString('pt-BR', {
    maximumFractionDigits: 1,
  })}%`
}

/** 0..1 rate → "12,5%", or "—". */
export function formatRatio(value: number | null): string {
  if (value === null) return '—'
  return `${(value * 100).toLocaleString('pt-BR', {
    maximumFractionDigits: 1,
  })}%`
}

export function formatCount(value: number): string {
  return value.toLocaleString('pt-BR')
}

/** "YYYY-MM" → "outubro de 2026". */
export function formatUsageMonth(month: string): string {
  const [year, mm] = month.split('-').map(Number)
  if (!year || !mm) return month
  return new Intl.DateTimeFormat('pt-BR', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, mm - 1, 15)))
}

/**
 * `<input type="datetime-local">` value (São Paulo wall clock) → ISO with
 * the -03:00 offset. Brazil has no daylight saving since 2019.
 */
export function saoPauloLocalToIso(local: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return null
  return new Date(`${local}:00-03:00`).toISOString()
}

/** ISO → `datetime-local` value in São Paulo wall clock. */
export function isoToSaoPauloLocal(iso: string): string {
  const shifted = new Date(new Date(iso).getTime() - 3 * 60 * 60 * 1000)
  return shifted.toISOString().slice(0, 16)
}

/** Paths of the issue screens. */
export function issueEditorHref(
  slug: string,
  newsletterId: string,
  issueId: string,
): string {
  return `/${slug}/crm/newsletters/${newsletterId}/issues/${issueId}`
}

export function issueReportHref(
  slug: string,
  newsletterId: string,
  issueId: string,
): string {
  return `${issueEditorHref(slug, newsletterId, issueId)}/report`
}

export function newsletterHref(slug: string, newsletterId: string): string {
  return `/${slug}/crm/newsletters/${newsletterId}`
}
