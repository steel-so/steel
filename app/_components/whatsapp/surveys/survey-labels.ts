import type {
  SurveyChannelDTO,
  SurveyKindDTO,
  SurveyReportDTO,
  SurveyStatusDTO,
  SurveyTriggerDTO,
} from '@/types/satisfaction-survey'

export const KIND_LABEL: Record<SurveyKindDTO, string> = {
  CSAT: 'CSAT · satisfação',
  NPS: 'NPS · recomendação',
  CES: 'CES · esforço',
}

export const KIND_HINT: Record<SurveyKindDTO, string> = {
  CSAT: 'Nota de 1 a 5. O resultado é a % de notas 4 e 5.',
  NPS: 'Nota de 0 a 10, respondida digitando o número. Promotores (9–10) menos detratores (0–6).',
  CES: 'Nota de 1 a 7 (quanto maior, mais fácil). O resultado é a média.',
}

export const GROUP_LABEL: Record<SurveyReportDTO['groupBy'], string> = {
  agent: 'Atendente',
  team: 'Equipe',
  technician: 'Técnico',
  customer: 'Cliente',
}

export const TRIGGER_LABEL: Record<SurveyTriggerDTO, string> = {
  CONVERSATION_CLOSED: 'Conversa encerrada',
  TICKET_RESOLVED: 'Chamado resolvido',
  MANUAL: 'Envio manual',
}

export const CHANNEL_LABEL: Record<SurveyChannelDTO, string> = {
  WHATSAPP: 'WhatsApp',
  EMAIL: 'E-mail',
}

export const STATUS_LABEL: Record<SurveyStatusDTO, string> = {
  SCHEDULED: 'Agendada',
  SENT: 'Enviada',
  ANSWERED: 'Respondida',
  SKIPPED: 'Ignorada',
  FAILED: 'Falhou',
}

const SAO_PAULO = 'America/Sao_Paulo'

/** dd/mm/aaaa hh:mm in the platform timezone (never the browser's). */
export function formatSurveyDate(iso: string | null): string {
  if (!iso) return '—'
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: SAO_PAULO,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso))
}

export function formatNumber(value: number | null, digits = 1): string {
  if (value === null) return '—'
  return value.toLocaleString('pt-BR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  })
}

export function formatPercent(value: number | null): string {
  return value === null ? '—' : `${formatNumber(value)}%`
}
