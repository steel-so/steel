import type {
  SteelAgentDTO,
  SteelAgentEventDTO,
  SteelAgentRunStatusDTO,
  SteelAgentRunStepStatusDTO,
  SteelAgentTriggerTypeDTO,
  SteelAgentVersionStatusDTO,
} from '@/types/steel-agent'

/** pt-BR labels shared by the Steel Agents screens. */

export const RUN_STATUS_LABEL: Record<SteelAgentRunStatusDTO, string> = {
  QUEUED: 'Na fila',
  RUNNING: 'Executando',
  WAITING_APPROVAL: 'Aguardando aprovação',
  SUCCEEDED: 'Concluída',
  FAILED: 'Falhou',
  SKIPPED: 'Não executada',
}

export const RUN_STATUS_VARIANT: Record<
  SteelAgentRunStatusDTO,
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  QUEUED: 'outline',
  RUNNING: 'secondary',
  WAITING_APPROVAL: 'default',
  SUCCEEDED: 'secondary',
  FAILED: 'destructive',
  SKIPPED: 'outline',
}

export const STEP_STATUS_LABEL: Record<SteelAgentRunStepStatusDTO, string> = {
  OK: 'Concluída',
  FAILED: 'Falhou',
  PENDING: 'Aguardando aprovação',
  APPROVED: 'Aprovada',
  REJECTED: 'Rejeitada',
  EXPIRED: 'Expirou',
  SIMULATED: 'Simulada',
}

/** Badge of a "Testar agente" run (writes simulated, nothing changed). */
export const TEST_RUN_LABEL = 'Teste'

export const TRIGGER_LABEL: Record<SteelAgentTriggerTypeDTO, string> = {
  SCHEDULE: 'Agenda',
  EVENT: 'Evento',
  MANUAL: 'Manual',
}

export const CRON_PRESETS: { cron: string; label: string }[] = [
  { cron: '0 * * * *', label: 'A cada hora' },
  { cron: '0 8 * * *', label: 'Todo dia às 8h' },
  { cron: '0 8 * * 1-5', label: 'Dias úteis às 8h' },
  { cron: '0 18 * * 1-5', label: 'Dias úteis às 18h' },
  { cron: '0 9 * * 1', label: 'Segundas às 9h' },
  { cron: '0 8 1 * *', label: 'Dia 1 de cada mês às 8h' },
]

export const TIMEZONES = [
  'America/Sao_Paulo',
  'America/Manaus',
  'America/Cuiaba',
  'America/Belem',
  'America/Fortaleza',
  'America/Recife',
  'America/Rio_Branco',
  'America/Noronha',
  'UTC',
] as const

/** One line describing when the agent runs. */
export function describeTrigger(
  agent: Pick<SteelAgentDTO, 'triggerType' | 'cron' | 'timezone' | 'eventKey'>,
  events: SteelAgentEventDTO[] = [],
): string {
  if (agent.triggerType === 'SCHEDULE') {
    const preset = CRON_PRESETS.find((p) => p.cron === agent.cron)
    return `${preset?.label ?? `Cron ${agent.cron ?? ''}`} (${agent.timezone})`
  }
  if (agent.triggerType === 'EVENT') {
    const event = events.find((e) => e.key === agent.eventKey)
    return `Quando: ${event?.label ?? agent.eventKey ?? '—'}`
  }
  return 'Só pelo botão "Executar agora"'
}

/** Date/time in the agent timezone (never the browser's). */
export function formatAgentDate(iso: string | null, timezone: string): string {
  if (!iso) return '—'
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone: timezone,
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(new Date(iso))
  } catch {
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(new Date(iso))
  }
}

export const VERSION_STATUS_LABEL: Record<SteelAgentVersionStatusDTO, string> =
  {
    PENDING_EVAL: 'Em avaliação',
    REJECTED: 'Reprovada',
    PUBLISHED: 'Publicada',
    CHALLENGER: 'Teste A/B',
    SUPERSEDED: 'Substituída',
    DISCARDED: 'Descartada',
  }

export const VERSION_STATUS_VARIANT: Record<
  SteelAgentVersionStatusDTO,
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  PENDING_EVAL: 'outline',
  REJECTED: 'destructive',
  PUBLISHED: 'default',
  CHALLENGER: 'secondary',
  SUPERSEDED: 'outline',
  DISCARDED: 'outline',
}

/** "80%" from a 0..1 rate, "—" when there is none. */
export function formatRate(rate: number | null): string {
  return rate === null ? '—' : `${Math.round(rate * 100)}%`
}

/** USD with enough digits for fractions of a cent per run. */
export function formatUsd(value: number | null): string {
  if (value === null) return '—'
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(value)
}
