const TIME_ZONE = 'America/Sao_Paulo'

/**
 * Day and month of a ticket. The public API does not tell the workspace time
 * zone, so the panel uses the product's home zone instead of the browser's.
 */
export function formatDate(iso: string | null): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: TIME_ZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date)
}

export const TICKET_TYPE_LABEL: Record<string, string> = {
  INCIDENT: 'Incidente',
  SERVICE_REQUEST: 'Requisição',
  CHANGE: 'Mudança',
  PROBLEM: 'Problema',
}

export const LEAD_STAGE_LABEL: Record<string, string> = {
  RECEIVED: 'Recebido',
  IN_CONTACT: 'Em contato',
  QUALIFIED: 'Qualificado',
  OPPORTUNITY: 'Oportunidade',
  PROPOSAL: 'Proposta',
  CLOSED: 'Encerrado',
}

export function labelOf(map: Record<string, string>, key: string): string {
  return map[key] ?? key
}
