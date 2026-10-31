import type { NotificationKind, SdNotificationChannel } from '@prisma/client'

/**
 * Catálogo de notificações do ServiceDesk: o que o módulo avisa, para quem e
 * por quais canais por padrão. A preferência do usuário
 * (`SdNotificationPreference`) só liga/desliga um par evento × canal; sem
 * linha salva, vale o padrão daqui.
 *
 * Público (`audience`) é resolvido no envio: `assignee` (responsável),
 * `participants`, `followers` (quem segue), `requester` (solicitante),
 * `contact` (contato externo, via e-mail/WhatsApp), `departmentLeads`
 * (líderes do time) e `mentioned` (citados na mensagem).
 */

export const SD_NOTIFICATION_AUDIENCES = [
  'assignee',
  'participants',
  'followers',
  'requester',
  'contact',
  'departmentLeads',
  'mentioned',
] as const

export type SdNotificationAudience = (typeof SD_NOTIFICATION_AUDIENCES)[number]

export interface SdNotificationEventSpec {
  /** Chave estável usada na preferência e no log. */
  key: string
  /** Tipo da notificação in-app (`Notification.kind`). */
  kind: NotificationKind
  label: string
  description: string
  audience: SdNotificationAudience[]
  /** Canais oferecidos ao usuário para este evento. */
  channels: SdNotificationChannel[]
  /** Canais ligados quando o usuário não mexeu em nada. */
  defaultChannels: SdNotificationChannel[]
  /** Só faz sentido para agente (não aparece para solicitante/contato). */
  agentOnly?: boolean
}

const ALL: SdNotificationChannel[] = ['IN_APP', 'EMAIL', 'WHATSAPP']
const APP_MAIL: SdNotificationChannel[] = ['IN_APP', 'EMAIL']

/**
 * Resumo diário: preferência por usuário (desligada por padrão) lida pelo job
 * `servicedesk-digest`. Fica no catálogo para aparecer na mesma matriz da
 * tela de preferências, mas nunca passa pelo motor (`audience` vazio).
 */
export const SD_DIGEST_EVENT = 'digest.daily'

/** Hora local do workspace em que o resumo diário é enviado. */
export const SD_DIGEST_HOUR = 8

export const SD_NOTIFICATION_EVENTS: SdNotificationEventSpec[] = [
  {
    key: 'ticket.assigned',
    kind: 'SD_TICKET_ASSIGNED',
    label: 'Chamado atribuído a você',
    description: 'Quando um chamado passa a ser seu.',
    audience: ['assignee'],
    channels: ALL,
    defaultChannels: APP_MAIL,
    agentOnly: true,
  },
  {
    key: 'ticket.created_in_department',
    kind: 'SD_TICKET_CREATED',
    label: 'Chamado novo na sua fila',
    description: 'Abertura de chamado no departamento em que você atende.',
    audience: ['departmentLeads'],
    channels: APP_MAIL,
    defaultChannels: ['IN_APP'],
    agentOnly: true,
  },
  {
    key: 'ticket.message',
    kind: 'SD_TICKET_MESSAGE',
    label: 'Nova mensagem no chamado',
    description: 'Resposta pública no histórico de um chamado que você segue.',
    audience: ['assignee', 'participants', 'followers', 'requester', 'contact'],
    channels: ALL,
    defaultChannels: APP_MAIL,
  },
  {
    key: 'ticket.internal_note',
    kind: 'SD_TICKET_MESSAGE',
    label: 'Nota interna',
    description: 'Nota interna registrada no chamado (nunca vai ao cliente).',
    audience: ['assignee', 'participants', 'followers'],
    channels: ['IN_APP'],
    defaultChannels: ['IN_APP'],
    agentOnly: true,
  },
  {
    key: 'ticket.mentioned',
    kind: 'SD_TICKET_MENTIONED',
    label: 'Você foi citado',
    description: 'Alguém citou você numa mensagem do chamado.',
    audience: ['mentioned'],
    channels: ALL,
    defaultChannels: APP_MAIL,
    agentOnly: true,
  },
  {
    key: 'ticket.phase_changed',
    kind: 'SD_TICKET_PHASE_CHANGED',
    label: 'Mudança de fase',
    description: 'O chamado avançou (ou voltou) de fase.',
    audience: ['assignee', 'participants', 'followers', 'requester', 'contact'],
    channels: APP_MAIL,
    defaultChannels: ['IN_APP'],
  },
  {
    key: 'ticket.resolved',
    kind: 'SD_TICKET_RESOLVED',
    label: 'Chamado resolvido',
    description: 'A solução foi registrada e o chamado foi resolvido.',
    audience: ['requester', 'contact', 'participants', 'followers'],
    channels: ALL,
    defaultChannels: APP_MAIL,
  },
  {
    key: 'ticket.reopened',
    kind: 'SD_TICKET_REOPENED',
    label: 'Chamado reaberto',
    description: 'O solicitante respondeu e o chamado voltou para a fila.',
    audience: ['assignee', 'departmentLeads', 'followers'],
    channels: ALL,
    defaultChannels: APP_MAIL,
    agentOnly: true,
  },
  {
    key: 'sla.at_risk',
    kind: 'SD_SLA_AT_RISK',
    label: 'SLA em risco',
    description: 'O prazo está perto do limite configurado.',
    audience: ['assignee', 'departmentLeads'],
    channels: ALL,
    defaultChannels: APP_MAIL,
    agentOnly: true,
  },
  {
    key: 'sla.breached',
    kind: 'SD_SLA_BREACHED',
    label: 'SLA violado',
    description: 'O prazo de resposta ou de resolução estourou.',
    audience: ['assignee', 'departmentLeads'],
    channels: ALL,
    defaultChannels: ALL,
    agentOnly: true,
  },
  {
    key: 'ticket.escalated',
    kind: 'SD_TICKET_ESCALATED',
    label: 'Chamado escalonado',
    description: 'Escalonamento funcional ou hierárquico registrado.',
    audience: ['assignee', 'departmentLeads', 'followers'],
    channels: ALL,
    defaultChannels: APP_MAIL,
    agentOnly: true,
  },
  {
    key: 'approval.requested',
    kind: 'SD_APPROVAL_REQUESTED',
    label: 'Aprovação solicitada',
    description: 'Pedido de aprovação enviado a você.',
    // Só in-app: o e-mail do pedido sai pelo fluxo de aprovação, com o link
    // público do token — avisar de novo por e-mail seria duplicar.
    audience: [],
    channels: ['IN_APP'],
    defaultChannels: ['IN_APP'],
  },
  {
    key: 'ticket.participant_added',
    kind: 'SD_TICKET_CREATED',
    label: 'Você entrou num chamado',
    description: 'Alguém te adicionou como participante de um chamado.',
    audience: [],
    channels: APP_MAIL,
    defaultChannels: APP_MAIL,
  },
  {
    key: 'swarm.invited',
    kind: 'SD_TICKET_CREATED',
    label: 'Chamado para swarming',
    description: 'Você foi chamado como especialista para resolver um chamado.',
    audience: [],
    channels: APP_MAIL,
    defaultChannels: APP_MAIL,
  },
  {
    key: 'swarm.responded',
    kind: 'SD_TICKET_CREATED',
    label: 'Resposta de swarming',
    description: 'Um especialista aceitou ou recusou o seu convite.',
    audience: [],
    channels: ['IN_APP'],
    defaultChannels: ['IN_APP'],
    agentOnly: true,
  },
  {
    key: 'major_incident.declared',
    kind: 'SD_TICKET_CREATED',
    label: 'Incidente maior declarado',
    description:
      'Um incidente maior foi declarado e você é o comandante, o responsável ou líder do departamento do chamado.',
    audience: ['assignee', 'departmentLeads'],
    channels: APP_MAIL,
    defaultChannels: APP_MAIL,
    agentOnly: true,
  },
  {
    key: 'major_incident.resolved',
    kind: 'SD_TICKET_CREATED',
    label: 'Incidente maior resolvido',
    description: 'Um incidente maior foi resolvido.',
    audience: ['assignee', 'departmentLeads'],
    channels: ['IN_APP'],
    defaultChannels: ['IN_APP'],
    agentOnly: true,
  },
  {
    key: 'approval.responded',
    kind: 'SD_APPROVAL_RESPONDED',
    label: 'Aprovação respondida',
    description: 'Um aprovador aprovou ou reprovou.',
    audience: ['assignee', 'participants', 'followers'],
    channels: APP_MAIL,
    defaultChannels: APP_MAIL,
    agentOnly: true,
  },
  {
    key: 'task.assigned',
    kind: 'SD_TASK_ASSIGNED',
    label: 'Tarefa atribuída',
    description: 'Uma tarefa do chamado ficou com você.',
    audience: ['assignee'],
    channels: APP_MAIL,
    defaultChannels: ['IN_APP'],
    agentOnly: true,
  },
  {
    key: 'ticket.csat',
    kind: 'SD_TICKET_CSAT',
    label: 'Avaliação recebida',
    description: 'O solicitante avaliou o atendimento.',
    audience: ['assignee', 'departmentLeads'],
    channels: APP_MAIL,
    defaultChannels: ['IN_APP'],
    agentOnly: true,
  },
  {
    key: 'sla.breach_predicted',
    kind: 'SD_SLA_BREACH_PREDICTED',
    label: 'Risco de violar o SLA',
    description:
      'A análise preditiva calculou risco alto de o prazo estourar se nada mudar.',
    audience: ['assignee', 'departmentLeads'],
    channels: ALL,
    defaultChannels: ['IN_APP'],
    agentOnly: true,
  },
  {
    key: 'problem.cluster_detected',
    kind: 'SD_PROBLEM_SUGGESTED',
    label: 'Incidentes repetidos',
    description:
      'Vários incidentes parecidos foram agrupados — talvez caiba abrir um problema.',
    audience: ['departmentLeads'],
    channels: APP_MAIL,
    defaultChannels: ['IN_APP'],
    agentOnly: true,
  },
  {
    key: 'kb.review_requested',
    kind: 'SD_KB_REVIEW',
    label: 'Revisão de artigo pedida',
    description: 'Alguém pediu sua revisão num artigo da base de conhecimento.',
    // Sem público: o artigo não é um chamado, então quem notifica é o próprio
    // serviço de KCS, com o revisor escolhido (igual ao resumo diário).
    audience: [],
    channels: APP_MAIL,
    defaultChannels: APP_MAIL,
    agentOnly: true,
  },
  {
    key: 'kb.review_decided',
    kind: 'SD_KB_REVIEW',
    label: 'Revisão de artigo decidida',
    description:
      'O revisor aprovou (e publicou) ou pediu mudanças num artigo seu.',
    // Sem público: quem avisa é o serviço de KCS, com o autor do artigo.
    audience: [],
    channels: APP_MAIL,
    defaultChannels: APP_MAIL,
    agentOnly: true,
  },
  {
    key: 'kb.review_due',
    kind: 'SD_KB_REVIEW',
    label: 'Artigo com revisão vencida',
    description:
      'A validade de um artigo que você mantém venceu e ele precisa ser revisto.',
    audience: [],
    channels: APP_MAIL,
    defaultChannels: ['IN_APP'],
    agentOnly: true,
  },
  {
    key: 'report.ready',
    kind: 'SD_REPORT_READY',
    label: 'Relatório pronto',
    description:
      'Um relatório que você pediu terminou de ser gerado e está disponível.',
    audience: [],
    channels: APP_MAIL,
    defaultChannels: APP_MAIL,
    agentOnly: true,
  },
  {
    key: SD_DIGEST_EVENT,
    kind: 'SD_DIGEST',
    label: 'Resumo diário',
    description:
      'Uma vez por dia, no horário do workspace: o que ficou pendente com você (fila, SLA em risco, aguardando resposta).',
    // Sem público: não é disparado por um chamado, e sim pelo job
    // `servicedesk-digest`, que lê a preferência de cada agente.
    audience: [],
    channels: APP_MAIL,
    defaultChannels: [],
    agentOnly: true,
  },
  {
    key: 'approval.canceled',
    kind: 'SD_APPROVAL_CANCELED',
    label: 'Aprovação cancelada',
    description:
      'Um pedido de aprovação enviado a você foi cancelado antes da resposta.',
    // Sem público: quem dispara passa o aprovador em `payload.userIds`.
    audience: [],
    channels: APP_MAIL,
    defaultChannels: ['IN_APP'],
  },
  {
    key: 'approval.expired',
    kind: 'SD_APPROVAL_EXPIRED',
    label: 'Aprovação expirada',
    description:
      'Um pedido (ou rodada do comitê) venceu sem resposta — o chamado segue esperando.',
    // Responsável do chamado + quem pediu (vem em `payload.userIds`).
    audience: ['assignee'],
    channels: APP_MAIL,
    defaultChannels: APP_MAIL,
    agentOnly: true,
  },
  {
    key: 'task.due',
    kind: 'SD_TASK_DUE',
    label: 'Prazo de tarefa',
    description: 'Uma tarefa sua vence na próxima hora ou já venceu.',
    audience: [],
    channels: APP_MAIL,
    defaultChannels: ['IN_APP'],
    agentOnly: true,
  },
  {
    key: 'kb.comment',
    kind: 'SD_KB_COMMENT',
    label: 'Comentário no seu artigo',
    description: 'Alguém comentou num artigo da base que você escreveu.',
    // Sem público: não é chamado — o serviço de comentários avisa o autor.
    audience: [],
    channels: ['IN_APP'],
    defaultChannels: ['IN_APP'],
    agentOnly: true,
  },
  {
    key: 'oncall.shift',
    kind: 'SD_ONCALL_SHIFT',
    label: 'Plantão',
    description:
      'Você entrou no rodízio de uma escala ou foi escalado numa troca pontual.',
    audience: [],
    channels: ['IN_APP'],
    defaultChannels: ['IN_APP'],
    agentOnly: true,
  },
  {
    key: 'license.expiring',
    kind: 'SD_LICENSE_EXPIRING',
    label: 'Licença de software perto de vencer',
    description:
      'Uma licença de software vence em breve ou venceu. Avisa os administradores.',
    audience: [],
    channels: ['IN_APP'],
    defaultChannels: ['IN_APP'],
    // Sem `agentOnly`: donos e administradores recebem mesmo sem departamento.
  },
  {
    key: 'monitor.alert',
    kind: 'SD_MONITOR_ALERT',
    label: 'Alerta no seu plantão',
    description:
      'O monitoramento abriu (ou reabriu) um chamado no time em que você está de plantão.',
    // O plantonista vem em `payload.userIds` (resolvido pela escala).
    audience: [],
    channels: ALL,
    defaultChannels: APP_MAIL,
    agentOnly: true,
  },
  {
    key: 'contract.franchise',
    kind: 'SD_CONTRACT_FRANCHISE',
    label: 'Franquia de contrato',
    description:
      'O período de um contrato consumiu 80% da franquia ou entrou em excedente.',
    // Quem criou o contrato + admins do workspace (uma vez por período).
    audience: [],
    channels: ['IN_APP'],
    defaultChannels: ['IN_APP'],
    agentOnly: true,
  },
]

/**
 * Agrupamento por tema da matriz de preferências (a ordem é a da tela).
 * Toda chave de `SD_NOTIFICATION_EVENTS` precisa estar em exatamente um
 * grupo — o teste do catálogo garante isso.
 */
export interface SdNotificationGroup {
  label: string
  events: string[]
}

export const SD_NOTIFICATION_GROUPS: SdNotificationGroup[] = [
  {
    label: 'Chamados',
    events: [
      'ticket.assigned',
      'ticket.created_in_department',
      'ticket.participant_added',
      'swarm.invited',
      'swarm.responded',
      'major_incident.declared',
      'major_incident.resolved',
      'ticket.phase_changed',
      'ticket.resolved',
      'ticket.reopened',
      'ticket.csat',
    ],
  },
  {
    label: 'Conversas',
    events: ['ticket.message', 'ticket.internal_note', 'ticket.mentioned'],
  },
  {
    label: 'SLA e escalonamento',
    events: [
      'sla.at_risk',
      'sla.breached',
      'sla.breach_predicted',
      'ticket.escalated',
    ],
  },
  {
    label: 'Base de conhecimento',
    events: [
      'kb.review_requested',
      'kb.review_decided',
      'kb.review_due',
      'kb.comment',
    ],
  },
  {
    label: 'Aprovações e tarefas',
    events: [
      'approval.requested',
      'approval.responded',
      'approval.canceled',
      'approval.expired',
      'task.assigned',
      'task.due',
    ],
  },
  {
    label: 'Problemas e relatórios',
    events: ['problem.cluster_detected', 'report.ready'],
  },
  { label: 'Resumos', events: [SD_DIGEST_EVENT] },
  {
    label: 'Plantão, monitoramento e contratos',
    events: [
      'oncall.shift',
      'monitor.alert',
      'contract.franchise',
      'license.expiring',
    ],
  },
]

const BY_KEY = new Map(SD_NOTIFICATION_EVENTS.map((e) => [e.key, e]))

export function sdNotificationEvent(
  key: string,
): SdNotificationEventSpec | undefined {
  return BY_KEY.get(key)
}

/** O canal está ligado para este evento quando o usuário não escolheu nada? */
export function sdNotificationDefault(
  key: string,
  channel: SdNotificationChannel,
): boolean {
  return BY_KEY.get(key)?.defaultChannels.includes(channel) ?? false
}
