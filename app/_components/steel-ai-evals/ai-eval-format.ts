import type { AiEvalRunDTO } from '@/types/ai-quality'

/** pt-BR helpers of the eval screens (UTC like the rest of Steel AI). */

const dateTime = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'UTC',
})

export function formatEvalDate(iso: string | null): string {
  return iso ? `${dateTime.format(new Date(iso))} UTC` : '—'
}

export function formatPercent(value: number | null): string {
  if (value === null) return '—'
  return `${(value * 100).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}%`
}

export function formatScore(value: number | null): string {
  if (value === null) return '—'
  return value.toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

export const RUN_STATUS_LABEL: Record<AiEvalRunDTO['status'], string> = {
  QUEUED: 'Na fila',
  RUNNING: 'Rodando',
  DONE: 'Concluída',
  FAILED: 'Falhou',
}

/** "8 de 10 passaram (80%)" or the status while it runs. */
export function runSummary(run: AiEvalRunDTO): string {
  if (run.status === 'QUEUED' || run.status === 'RUNNING') {
    return `${RUN_STATUS_LABEL[run.status]}…`
  }
  if (run.status === 'FAILED' && run.passedCount + run.failedCount === 0) {
    return run.error ?? 'Falhou'
  }
  return `${run.passedCount} de ${run.caseCount} passaram (${formatPercent(run.passRate)})`
}
