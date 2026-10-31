import type {
  QaHandlerKindDTO,
  QaReviewStatusDTO,
  QaSubjectTypeDTO,
} from '@/types/qa-review'

const dateTime = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'UTC',
})

const day = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  timeZone: 'UTC',
})

/** Dates are shown in UTC, like the rest of the Steel AI analytics. */
export function formatQaDate(iso: string | null): string {
  return iso ? `${dateTime.format(new Date(iso))} UTC` : '—'
}

export function formatQaDay(iso: string): string {
  return day.format(new Date(iso))
}

export const QA_SUBJECT_LABEL: Record<QaSubjectTypeDTO, string> = {
  CONVERSATION: 'Conversa do zap',
  TICKET: 'Chamado',
}

export const QA_STATUS_LABEL: Record<QaReviewStatusDTO, string> = {
  PENDING: 'Na fila',
  COMPLETED: 'Avaliado',
  SKIPPED: 'Não avaliado',
  FAILED: 'Falhou',
}

export const QA_HANDLER_LABEL: Record<QaHandlerKindDTO, string> = {
  HUMAN: 'Humano',
  BOT: 'Bot / IA',
  MIXED: 'Bot e humano',
}

const SKIP_REASON_LABEL: Record<string, string> = {
  disabled: 'O QA estava desligado',
  subject_not_found: 'O atendimento não existe mais',
  no_attendant_reply: 'Ninguém respondeu o cliente',
  too_short: 'Atendimento curto demais',
  bots_excluded: 'Atendimentos só do bot estão fora da avaliação',
  no_criteria: 'Nenhum critério ativo para este tipo',
  ai_quota_exceeded: 'A cota mensal de IA acabou',
  ai_provider_unavailable: 'Nenhum modelo de IA disponível',
  ai_prepare_failed: 'A IA não pôde ser preparada',
  provider_failed: 'O provedor de IA falhou',
  unparseable_response: 'A IA devolveu uma resposta inválida',
  not_pending: 'Já avaliado',
}

export function qaSkipReasonLabel(reason: string | null): string {
  if (!reason) return '—'
  return SKIP_REASON_LABEL[reason] ?? reason
}

export type QaScoreTone = 'good' | 'ok' | 'low'

/** Cuts follow the judge prompt: 90+ excellent, 70-89 good, below has a problem. */
export function qaScoreTone(score: number, threshold = 60): QaScoreTone {
  if (score < threshold) return 'low'
  if (score >= 80) return 'good'
  return 'ok'
}
