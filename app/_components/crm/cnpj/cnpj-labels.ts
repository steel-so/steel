import type {
  CrmCnpjAppliedField,
  CrmCnpjRunStatusDTO,
  CrmCnpjSizeDTO,
} from '@/types/crm-cnpj'

/** pt-BR copy of the CNPJ enrichment UI. */

export const SIZE_LABELS: Record<CrmCnpjSizeDTO, string> = {
  ME: 'Microempresa (ME)',
  EPP: 'Empresa de pequeno porte (EPP)',
  DEMAIS: 'Demais (médio ou grande porte)',
}

export const APPLIED_LABELS: Record<CrmCnpjAppliedField, string> = {
  name: 'nome',
  address: 'endereço',
}

export const RUN_STATUS_LABELS: Record<CrmCnpjRunStatusDTO, string> = {
  QUEUED: 'Na fila',
  RUNNING: 'Consultando',
  COMPLETED: 'Concluído',
  FAILED: 'Falhou',
  CANCELED: 'Cancelado',
}

export const RUN_STATUS_VARIANT: Record<
  CrmCnpjRunStatusDTO,
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  QUEUED: 'outline',
  RUNNING: 'secondary',
  COMPLETED: 'default',
  FAILED: 'destructive',
  CANCELED: 'outline',
}

/** `4711302` → `4711-3/02`, the notation used on the CNPJ card. */
export function formatCnae(code: string | null): string {
  if (!code) return ''
  const d = code.replace(/\D/g, '')
  if (d.length !== 7) return code
  return `${d.slice(0, 4)}-${d.slice(4, 5)}/${d.slice(5)}`
}

/** Date-only ISO (`2015-03-02`) → `02/03/2015`, with no timezone shift. */
export function formatIsoDate(iso: string | null): string {
  if (!iso) return ''
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}

/** Moment in the workspace's time zone (Brazil), never the browser's. */
export function formatMoment(iso: string | null): string {
  if (!iso) return ''
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Sao_Paulo',
  }).format(new Date(iso))
}

export function formatBrl(value: number | null): string {
  if (value === null) return ''
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value)
}

/** One-line summary of what a single enrichment changed. */
export function appliedSummary(applied: CrmCnpjAppliedField[]): string {
  if (applied.length === 0) {
    return 'Dados da Receita atualizados — nome e endereço já estavam preenchidos'
  }
  return `Dados da Receita atualizados — ${applied
    .map((field) => APPLIED_LABELS[field])
    .join(' e ')} preenchido`
}
