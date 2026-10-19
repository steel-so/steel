import {
  APOLLO_EMAIL_STATUSES,
  APOLLO_EMPLOYEE_RANGES,
  APOLLO_SENIORITIES,
} from '@/src/lib/integrations/apollo'
import type { ApolloSearchFiltersDTO } from '@/src/schemas/crm-apollo.schema'
import type { CrmApolloImportStatusDTO } from '@/types/crm-apollo'

/** pt-BR copy of the Apollo import UI (labels live next to the pure catalog). */

export const SENIORITY_OPTIONS = APOLLO_SENIORITIES
export const EMPLOYEE_RANGE_OPTIONS = APOLLO_EMPLOYEE_RANGES
export const EMAIL_STATUS_OPTIONS = APOLLO_EMAIL_STATUSES

export const EMPTY_FILTERS: ApolloSearchFiltersDTO = {
  personTitles: [],
  includeSimilarTitles: true,
  seniorities: [],
  personLocations: [],
  organizationLocations: [],
  organizationDomains: [],
  employeeRanges: [],
  keywords: '',
  emailStatuses: [],
}

export const IMPORT_STATUS_LABELS: Record<CrmApolloImportStatusDTO, string> = {
  QUEUED: 'Na fila',
  RUNNING: 'Importando',
  DONE: 'Concluída',
  FAILED: 'Falhou',
  PAUSED_RATE_LIMIT: 'Pausada pelo limite da Apollo',
}

export const IMPORT_STATUS_VARIANT: Record<
  CrmApolloImportStatusDTO,
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  QUEUED: 'outline',
  RUNNING: 'secondary',
  DONE: 'default',
  FAILED: 'destructive',
  PAUSED_RATE_LIMIT: 'outline',
}

/** Company/email-only note shown wherever an import can be started. */
export const WHATSAPP_NOTE =
  'Leads da Apollo são contatos frios. Antes de campanhas por e-mail ou WhatsApp, a workspace responde pela base legal (LGPD) e pela política de templates da Meta; o descadastro é respeitado nos dois canais.'

export const MAX_IMPORT = 1000

export function pluralize(count: number, one: string, many: string): string {
  return `${count.toLocaleString('pt-BR')} ${count === 1 ? one : many}`
}

const DATE_TIME = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'America/Sao_Paulo',
})

export function formatDateTime(iso: string | null): string {
  if (!iso) return '—'
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '—' : DATE_TIME.format(date)
}
