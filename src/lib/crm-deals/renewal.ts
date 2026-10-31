const DAY_MS = 24 * 60 * 60 * 1000

export type RenewalState = 'OVERDUE' | 'EXPIRING' | 'HEALTHY'

/** Whole days from `now` to `endDate` (negative once it ended). */
export function daysUntil(endDate: Date, now: Date): number {
  return Math.ceil((endDate.getTime() - now.getTime()) / DAY_MS)
}

export function renewalState(
  endDate: Date,
  leadDays: number,
  now: Date,
): RenewalState {
  const days = daysUntil(endDate, now)
  if (days < 0) return 'OVERDUE'
  return days <= leadDays ? 'EXPIRING' : 'HEALTHY'
}

export const RENEWAL_STATE_LABEL: Record<RenewalState, string> = {
  OVERDUE: 'Vencido',
  EXPIRING: 'A vencer',
  HEALTHY: 'Em dia',
}

/** Name of the deal opened for a renewal. */
export function renewalDealName(contractName: string): string {
  return `Renovação — ${contractName}`.slice(0, 200)
}

/** Upper bound of the contract end for the "expiring" scan. */
export function renewalWindowEnd(leadDays: number, now: Date): Date {
  return new Date(now.getTime() + leadDays * DAY_MS)
}

/** Text of the owner alert. */
export function renewalAlertBody(
  contractName: string,
  companyName: string,
  days: number,
): string {
  if (days < 0) {
    return `O contrato "${contractName}" de ${companyName} venceu há ${Math.abs(days)} dia(s) e ainda não foi renovado.`
  }
  if (days === 0) {
    return `O contrato "${contractName}" de ${companyName} vence hoje.`
  }
  return `O contrato "${contractName}" de ${companyName} vence em ${days} dia(s).`
}
