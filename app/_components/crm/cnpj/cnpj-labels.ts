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
  legalName: 'razão social',
  tradeName: 'nome fantasia',
  emails: 'e-mails',
  phones: 'telefones',
  domain: 'domínio',
  cnae: 'CNAE',
  size: 'porte',
  legalNature: 'natureza jurídica',
  registrationStatus: 'situação cadastral',
  openedAt: 'data de abertura',
  shareCapital: 'capital social',
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

/** `a`, `a e b`, `a, b e c`. */
function joinList(items: string[]): string {
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(', ')} e ${items[items.length - 1]}`
}

/** One-line summary of what a single enrichment changed. */
export function appliedSummary(applied: CrmCnpjAppliedField[]): string {
  if (applied.length === 0) {
    return 'Dados da Receita atualizados — os campos já estavam preenchidos'
  }
  const labels = applied.map((field) => APPLIED_LABELS[field])
  return `Dados da Receita atualizados — ${joinList(labels)} ${
    applied.length === 1 ? 'preenchido' : 'preenchidos'
  }`
}
