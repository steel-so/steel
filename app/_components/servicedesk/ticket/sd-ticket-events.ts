import type { SdTicketEventDTO } from '@/types/sd-ticket'
import { sdFieldLabel, sdFormatDateTime } from './sd-ticket-meta'

/**
 * Leitura humana dos eventos de rastreabilidade (`SdTicketEvent`): tipo
 * (para filtro e ícone), frase, "de → para" e detalhe. Funções puras.
 */

export type SdEventKind =
  | 'ticket'
  | 'field'
  | 'phase'
  | 'assignment'
  | 'escalation'
  | 'sla'
  | 'people'
  | 'activity'
  | 'system'

export const SD_EVENT_KIND_LABEL: Record<SdEventKind, string> = {
  ticket: 'Abertura',
  field: 'Campos',
  phase: 'Fase',
  assignment: 'Atribuição',
  escalation: 'Escalonamento',
  sla: 'SLA',
  people: 'Participantes',
  activity: 'Atividades',
  system: 'Automação',
}

export interface SdEventDescription {
  kind: SdEventKind
  title: string
  from: string | null
  to: string | null
  detail: string | null
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/

/** Valor de evento → texto (`{id,label}`, listas, datas, booleanos). */
export function sdEventValue(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value === 'boolean') return value ? 'Sim' : 'Não'
  if (typeof value === 'number') return String(value)
  if (typeof value === 'string') {
    return ISO_DATE.test(value) ? sdFormatDateTime(value) : value
  }
  if (Array.isArray(value)) {
    const items = value.map(sdEventValue).filter(Boolean)
    return items.length ? items.join(', ') : null
  }
  if (typeof value === 'object') {
    const ref = value as { label?: unknown; name?: unknown; id?: unknown }
    if (typeof ref.label === 'string') return ref.label
    if (typeof ref.name === 'string') return ref.name
    if (typeof ref.id === 'string') return ref.id
    return JSON.stringify(value)
  }
  return String(value)
}

function meta(event: SdTicketEventDTO, key: string): unknown {
  return event.meta ? event.meta[key] : undefined
}

const SLA_TITLES: Record<string, string> = {
  'sla.at_risk': 'SLA em risco',
  'sla.first_response_breached': 'SLA de 1ª resposta violado',
  'sla.resolution_breached': 'SLA de resolução violado',
}

const SWARM_TITLES: Record<string, string> = {
  'swarm.started': 'chamou especialistas (swarming)',
  'swarm.invited': 'convidou mais especialistas',
  'swarm.joined': 'entrou no swarming',
  'swarm.declined': 'recusou o swarming',
  'swarm.closed': 'encerrou o swarming',
}

const ACTIVITY_TITLES: Record<string, string> = {
  'remote.session_started': 'iniciou um acesso remoto',
  'message.posted': 'publicou uma mensagem',
  'message.created': 'publicou uma mensagem',
  'note.created': 'adicionou uma nota interna',
  'task.created': 'criou uma tarefa',
  'task.completed': 'concluiu uma tarefa',
  'task.updated': 'atualizou uma tarefa',
  'task.deleted': 'excluiu uma tarefa',
  'cost.created': 'lançou um custo',
  'cost.deleted': 'removeu um custo',
  'part.created': 'adicionou uma peça',
  'part.deleted': 'removeu uma peça',
  'attachment.created': 'anexou um arquivo',
  'attachment.deleted': 'removeu um anexo',
  'approval.requested': 'pediu aprovação',
  'approval.approved': 'aprovou',
  'approval.rejected': 'reprovou',
  'approval.responded': 'respondeu a aprovação',
  'signature.created': 'coletou a assinatura',
  'kb.linked': 'vinculou um artigo',
  'kb.unlinked': 'desvinculou um artigo',
  'time.started': 'iniciou o cronômetro',
  'time.logged': 'apontou horas',
  'time.updated': 'ajustou um apontamento',
  'time.removed': 'removeu um apontamento',
}

export function sdDescribeEvent(event: SdTicketEventDTO): SdEventDescription {
  const from = sdEventValue(event.fromValue)
  const to = sdEventValue(event.toValue)
  const base = { from: null, to: null, detail: null }
  const action = event.action

  if (action === 'ticket.created') {
    return { ...base, kind: 'ticket', title: 'abriu o chamado' }
  }
  if (action === 'ticket.reopened') {
    return { ...base, kind: 'phase', title: 'reabriu o chamado' }
  }
  if (action === 'phase.changed') {
    const comment = meta(event, 'comment')
    return {
      kind: 'phase',
      title: 'mudou a fase',
      from,
      to,
      detail: typeof comment === 'string' ? comment : null,
    }
  }
  if (action === 'field.changed') {
    const label =
      (typeof meta(event, 'label') === 'string'
        ? (meta(event, 'label') as string)
        : null) ?? sdFieldLabel(event.field ?? '')
    const assignment =
      event.field === 'assigneeId' || event.field === 'departmentId'
    return {
      kind: assignment ? 'assignment' : 'field',
      title: `alterou ${label.toLowerCase()}`,
      from,
      to,
      detail: null,
    }
  }
  if (action === 'escalated') {
    const kind = meta(event, 'kind')
    const reason = meta(event, 'reason')
    const automatic = meta(event, 'automatic') === true
    return {
      kind: 'escalation',
      title: `${automatic ? 'escalonou automaticamente' : 'escalonou'} (${kind === 'HIERARCHICAL' ? 'hierárquico' : 'funcional'})`,
      from: from ? `N${from}` : null,
      to: to ? `N${to}` : null,
      detail: typeof reason === 'string' ? reason : null,
    }
  }
  if (action.startsWith('sla.')) {
    return {
      ...base,
      kind: 'sla',
      title: SLA_TITLES[action] ?? 'evento de SLA',
      detail: to ? `Prazo: ${to}` : null,
    }
  }
  if (action === 'participant.added' || action === 'participant.removed') {
    return {
      ...base,
      kind: 'people',
      title:
        action === 'participant.added'
          ? 'adicionou participante'
          : 'removeu participante',
      to: to ?? from,
    }
  }
  if (action.startsWith('swarm.')) {
    return {
      ...base,
      kind: 'people',
      title: SWARM_TITLES[action] ?? 'atualizou o swarming',
      detail: to,
    }
  }
  if (action.startsWith('automation.')) {
    const rule = meta(event, 'ruleName') ?? meta(event, 'rule')
    return {
      ...base,
      kind: 'system',
      title:
        action === 'automation.failed'
          ? 'automação falhou'
          : 'automação aplicada',
      detail: typeof rule === 'string' ? rule : null,
    }
  }
  const activity = ACTIVITY_TITLES[action]
  if (
    activity ||
    /^(message|note|task|cost|part|attachment|approval|signature|kb|whatsapp)\./.test(
      action,
    )
  ) {
    return {
      ...base,
      kind: 'activity',
      title: activity ?? action,
      to,
    }
  }
  return { ...base, kind: 'system', title: action, from, to }
}

/** Nome de quem fez (agente, solicitante, IA, sistema). */
export function sdEventActorName(event: SdTicketEventDTO): string {
  if (event.actor) return event.actor.name
  switch (event.actorKind) {
    case 'AI':
      return 'IA'
    case 'SYSTEM':
      return 'Sistema'
    case 'CONTACT':
      return 'Contato'
    case 'REQUESTER':
      return 'Solicitante'
    default:
      return 'Alguém'
  }
}

/** Rótulo do dia ("Hoje", "Ontem", "segunda-feira, 21 de setembro"). */
export function sdDayLabel(iso: string, now: Date = new Date()): string {
  const date = new Date(iso)
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const diff = Math.round((today.getTime() - day.getTime()) / 86_400_000)
  if (diff === 0) return 'Hoje'
  if (diff === 1) return 'Ontem'
  return date.toLocaleDateString('pt-BR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    ...(date.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
  })
}

/** Eventos agrupados por dia (mantém a ordem recebida). */
export function sdGroupEventsByDay(
  events: SdTicketEventDTO[],
  now: Date = new Date(),
): { day: string; events: SdTicketEventDTO[] }[] {
  const groups: { day: string; events: SdTicketEventDTO[] }[] = []
  for (const event of events) {
    const day = sdDayLabel(event.createdAt, now)
    const last = groups[groups.length - 1]
    if (last && last.day === day) last.events.push(event)
    else groups.push({ day, events: [event] })
  }
  return groups
}
