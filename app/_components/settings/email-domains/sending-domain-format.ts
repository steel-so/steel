import type {
  SendingDomainRecord,
  SendingDomainStatusValue,
} from '@/src/schemas/sending-domain.schema'

/**
 * Labels and formats of Ajustes › Domínios de e-mail (ADR 0054). Pure, so
 * the screen and its tests read the same table.
 */

export type StatusTone = 'ok' | 'waiting' | 'error'

export const DOMAIN_STATUS: Record<
  SendingDomainStatusValue,
  { label: string; tone: StatusTone; hint: string }
> = {
  NOT_STARTED: {
    label: 'Aguardando DNS',
    tone: 'waiting',
    hint: 'Publique os registros abaixo no painel de DNS do domínio e clique em "Verificar agora".',
  },
  PENDING: {
    label: 'Verificando',
    tone: 'waiting',
    hint: 'O Steel está conferindo os registros. A propagação do DNS pode levar de minutos a algumas horas; a tela se atualiza sozinha a cada verificação.',
  },
  VERIFIED: {
    label: 'Verificado',
    tone: 'ok',
    hint: 'Tudo certo: as newsletters podem sair de qualquer endereço deste domínio.',
  },
  FAILED: {
    label: 'Falhou',
    tone: 'error',
    hint: 'Os registros não foram encontrados. Confira cada linha abaixo, corrija no DNS e clique em "Verificar agora".',
  },
  TEMPORARY_FAILURE: {
    label: 'Falha temporária',
    tone: 'error',
    hint: 'O DNS do domínio não respondeu na última verificação. O Steel tenta de novo sozinho.',
  },
}

const RECORD_STATUS: Record<string, { label: string; tone: StatusTone }> = {
  verified: { label: 'Ok', tone: 'ok' },
  pending: { label: 'Pendente', tone: 'waiting' },
  not_started: { label: 'Não publicado', tone: 'waiting' },
  failed: { label: 'Não encontrado', tone: 'error' },
  temporary_failure: { label: 'Falha temporária', tone: 'error' },
}

export function recordStatus(status: string): {
  label: string
  tone: StatusTone
} {
  return RECORD_STATUS[status] ?? { label: status, tone: 'waiting' }
}

/** What each record is for, in plain words. */
export function recordPurpose(record: SendingDomainRecord): string {
  switch (record.record) {
    case 'SPF':
      return record.type === 'MX'
        ? 'Recebe os avisos de e-mails não entregues'
        : 'Autoriza o envio pelo Steel'
    case 'DKIM':
      return 'Assina os e-mails (prova que são seus)'
    case 'Tracking':
      return 'Rastreio de abertura e clique'
    case 'TrackingCAA':
      return 'Certificado do link de rastreio'
    case 'DMARC':
      return 'Política contra falsificação'
    default:
      return record.record
  }
}

export const REGION_OPTIONS = [
  { value: 'sa-east-1', label: 'São Paulo (recomendado)' },
  { value: 'us-east-1', label: 'Estados Unidos (Virgínia)' },
  { value: 'eu-west-1', label: 'Europa (Irlanda)' },
  { value: 'ap-northeast-1', label: 'Ásia (Tóquio)' },
] as const

/** Product time zone, never the browser's (CI runs in UTC). */
const DATE_TIME = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'America/Sao_Paulo',
})

export function formatDomainDate(iso: string | null): string | null {
  if (!iso) return null
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? null : DATE_TIME.format(date)
}
