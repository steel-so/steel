import type {
  SteelAgentRiskFlagDTO,
  SteelGovernanceRoleDTO,
} from '@/types/steel-governance'

/** pt-BR labels and formatters of the governance panel (A6/A8). */

export const ROLE_LABEL: Record<SteelGovernanceRoleDTO, string> = {
  OWNER: 'Proprietário',
  ADMIN: 'Administrador',
  MEMBER: 'Membro',
  VIEWER: 'Leitor',
}

export const RISK_LABEL: Record<SteelAgentRiskFlagDTO, string> = {
  NO_OWNER: 'Sem responsável ativo',
  AUTO_WRITES: 'Escreve sozinho',
  CONTACTS_THIRD_PARTIES: 'Usa servidor externo',
  DELEGATES: 'Delega a outros agentes',
}

export const PERIOD_OPTIONS = [
  { value: 7, label: 'Últimos 7 dias' },
  { value: 30, label: 'Últimos 30 dias' },
  { value: 90, label: 'Últimos 90 dias' },
] as const

const USD = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
})

export function formatUsd(value: number | null): string {
  return value === null ? '—' : USD.format(value)
}

export function formatRate(value: number | null): string {
  return value === null ? '—' : `${Math.round(value * 100)}%`
}
