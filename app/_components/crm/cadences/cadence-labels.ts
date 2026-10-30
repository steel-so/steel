import type {
  CrmCadenceDelayUnitDTO,
  CrmCadenceEnrollmentStatusDTO,
  CrmCadenceRunStatusDTO,
  CrmCadenceStatusDTO,
  CrmCadenceStepTypeDTO,
  CrmCadenceStopReasonDTO,
} from '@/types/crm-cadence'

export const STEP_TYPE_LABEL: Record<CrmCadenceStepTypeDTO, string> = {
  EMAIL: 'E-mail',
  WHATSAPP: 'WhatsApp',
  TASK: 'Tarefa',
}

export const CADENCE_STATUS_LABEL: Record<CrmCadenceStatusDTO, string> = {
  ACTIVE: 'Ativa',
  PAUSED: 'Pausada',
  ARCHIVED: 'Arquivada',
}

export const ENROLLMENT_STATUS_LABEL: Record<
  CrmCadenceEnrollmentStatusDTO,
  string
> = {
  ACTIVE: 'Em andamento',
  PAUSED: 'Pausada',
  REPLIED: 'Respondeu',
  COMPLETED: 'Concluída',
  STOPPED: 'Encerrada',
}

export const STOP_REASON_LABEL: Record<CrmCadenceStopReasonDTO, string> = {
  REPLIED: 'O lead respondeu',
  MANUAL: 'Encerrada por um membro',
  LEAD_CLOSED: 'O lead foi fechado',
  LEAD_DELETED: 'O lead foi excluído',
  NO_CONTACT: 'Sem forma de contato',
  CLICKED: 'O lead clicou em um link',
  CADENCE_ARCHIVED: 'A cadência foi arquivada',
}

export const RUN_STATUS_LABEL: Record<CrmCadenceRunStatusDTO, string> = {
  SENT: 'Executado',
  SKIPPED: 'Pulado',
  FAILED: 'Falhou',
  PENDING: 'Enviando',
}

export const DELAY_UNIT_LABEL: Record<CrmCadenceDelayUnitDTO, string> = {
  MINUTES: 'minutos',
  HOURS: 'horas',
  DAYS: 'dias',
}

const SINGULAR: Record<CrmCadenceDelayUnitDTO, string> = {
  MINUTES: 'minuto',
  HOURS: 'hora',
  DAYS: 'dia',
}

/** "Na inscrição" / "Logo em seguida" / "Depois de 2 dias". */
export function describeDelay(
  value: number,
  unit: CrmCadenceDelayUnitDTO,
  isFirst: boolean,
): string {
  if (value === 0) return isFirst ? 'Na inscrição' : 'Logo em seguida'
  const label = value === 1 ? SINGULAR[unit] : DELAY_UNIT_LABEL[unit]
  return isFirst
    ? `${value} ${label} após a inscrição`
    : `${value} ${label} depois do passo anterior`
}

const dateTime = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

/** Cadence windows follow São Paulo time, so every date shown does too. */
export function formatCadenceDate(iso: string | null): string {
  return iso ? dateTime.format(new Date(iso)) : '—'
}

export function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`
}

/** "42 (35%)" — a count with its share of a total, or just the count when there is no total. */
export function formatShare(value: number, total: number): string {
  return total > 0 ? `${value} (${formatPercent(value / total)})` : `${value}`
}

/**
 * "Abriu 2× · clicou 1×" for the history of an e-mail step. A click implies
 * the e-mail was opened even when the pixel was blocked.
 */
export function describeEngagement(run: {
  openCount: number
  clickCount: number
}): string {
  const times = (count: number) => `${count}×`
  const parts: string[] = []
  if (run.openCount > 0) parts.push(`abriu ${times(run.openCount)}`)
  else parts.push(run.clickCount > 0 ? 'abriu' : 'não abriu')
  if (run.clickCount > 0) parts.push(`clicou ${times(run.clickCount)}`)
  const text = parts.join(' · ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}
