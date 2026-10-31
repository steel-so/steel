import type {
  CrmProposalChargeStatusDTO,
  CrmRenewalStateDTO,
} from '@/types/crm-deals'

/**
 * Tons das ferramentas de negócio do CRM (cobrança da proposta, renovações e
 * momento de oferecer mais) - o único lugar com cor da paleta nesta área, no
 * mesmo padrão do `health-tone.ts`. O resto usa token semântico.
 */

export const CHARGE_STATUS_LABEL: Record<CrmProposalChargeStatusDTO, string> = {
  PENDING: 'Aguardando pagamento',
  PAID: 'Paga',
  EXPIRED: 'Expirada',
  CANCELED: 'Cancelada',
}

export const CHARGE_STATUS_TONE: Record<CrmProposalChargeStatusDTO, string> = {
  PENDING:
    'border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  PAID: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  EXPIRED: 'border-border bg-muted text-muted-foreground',
  CANCELED: 'border-border bg-muted text-muted-foreground',
}

export const RENEWAL_STATE_TONE: Record<CrmRenewalStateDTO, string> = {
  OVERDUE: 'border-rose-500/25 bg-rose-500/10 text-rose-700 dark:text-rose-300',
  EXPIRING:
    'border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  HEALTHY:
    'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
}

export const UPSELL_TIMING_LABEL = {
  GO: 'Bom momento',
  WAIT: 'Espere',
  NEUTRAL: 'Sem sinal forte',
} as const

export const UPSELL_TIMING_TONE = {
  GO: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  WAIT: 'border-rose-500/25 bg-rose-500/10 text-rose-700 dark:text-rose-300',
  NEUTRAL: 'border-border bg-muted text-muted-foreground',
} as const

const SAO_PAULO = 'America/Sao_Paulo'

/** dd/mm/aaaa no fuso do workspace (nunca o do navegador). */
export function formatDealDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', { timeZone: SAO_PAULO })
}

/** dd/mm/aaaa HH:mm no fuso do workspace. */
export function formatDealDateTime(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    timeZone: SAO_PAULO,
    dateStyle: 'short',
    timeStyle: 'short',
  })
}

export function formatBRL(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}
