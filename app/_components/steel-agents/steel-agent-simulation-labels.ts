import type {
  SteelAgentSimulationCaseStatusDTO,
  SteelAgentSimulationStatusDTO,
  SteelAgentSimulationVerdictDTO,
} from '@/types/steel-agent-simulation'

/** pt-BR labels of the persona simulation screens. */

export const SIMULATION_STATUS_LABEL: Record<
  SteelAgentSimulationStatusDTO,
  string
> = {
  QUEUED: 'Na fila',
  RUNNING: 'Simulando',
  COMPLETED: 'Concluída',
  FAILED: 'Falhou',
  SKIPPED: 'Não executada',
}

export const SIMULATION_STATUS_VARIANT: Record<
  SteelAgentSimulationStatusDTO,
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  QUEUED: 'outline',
  RUNNING: 'secondary',
  COMPLETED: 'secondary',
  FAILED: 'destructive',
  SKIPPED: 'outline',
}

export const SIMULATION_CASE_STATUS_LABEL: Record<
  SteelAgentSimulationCaseStatusDTO,
  string
> = {
  QUEUED: 'Aguardando',
  RUNNING: 'Conversando',
  DONE: 'Avaliado',
  FAILED: 'Falhou',
}

export const SIMULATION_VERDICT_LABEL: Record<
  SteelAgentSimulationVerdictDTO,
  string
> = {
  PASS: 'Passou',
  FAIL: 'Reprovado',
}

export const SIMULATION_VERDICT_VARIANT: Record<
  SteelAgentSimulationVerdictDTO,
  'secondary' | 'destructive'
> = {
  PASS: 'secondary',
  FAIL: 'destructive',
}

export const TOOL_EVENT_STATUS_LABEL = {
  OK: 'Consulta',
  SIMULATED: 'Alteração simulada',
  FAILED: 'Falhou',
} as const

/** "3 de 5 passaram" / "Sem avaliação ainda". */
export function describeScoreboard(input: {
  passedCases: number
  totalCases: number
  status: SteelAgentSimulationStatusDTO
}): string {
  if (input.status === 'QUEUED') return 'Aguardando a fila'
  if (input.status === 'SKIPPED') return 'Não executada'
  const judged = input.passedCases
  if (input.status === 'RUNNING') {
    return `${judged} de ${input.totalCases} passaram até agora`
  }
  return `${judged} de ${input.totalCases} passaram`
}

export function formatSimulationCost(costUsd: number): string {
  return `US$ ${costUsd.toFixed(4)}`
}

/** Splits the "one criterion per line" textarea. */
export function parseCriteriaLines(value: string): string[] {
  return value
    .split('\n')
    .map((line) => line.replace(/^[-•*\s]+/, '').trim())
    .filter(Boolean)
}
