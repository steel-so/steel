import type { ModuleKind } from '@prisma/client'

/**
 * Domain events a Steel Agent can be triggered by (`triggerType = EVENT`).
 * Pure catalog shared by the schema, the dispatcher and the editor UI. A new
 * event needs an entry here plus a `dispatchSteelAgentEvent` call at the
 * point where it happens.
 */
export const STEEL_AGENT_EVENTS = [
  {
    key: 'sd.ticket.created',
    module: 'SERVICE_DESK',
    label: 'Chamado aberto',
    description: 'Quando um chamado é aberto no ServiceDesk.',
  },
  {
    key: 'crm.lead.created',
    module: 'CRM',
    label: 'Lead criado',
    description: 'Quando um lead entra no CRM (manual, formulário ou API).',
  },
  {
    key: 'zap.conversation.assigned',
    module: 'COMMUNICATION',
    label: 'Conversa atribuída',
    description: 'Quando uma conversa do WhatsApp é atribuída a um atendente.',
  },
  {
    key: 'zap.ai.handoff',
    module: 'COMMUNICATION',
    label: 'IA transferiu a conversa',
    description:
      'Quando a IA do WhatsApp transfere a conversa para um atendente.',
  },
  {
    key: 'sd.insight.detected',
    module: 'SERVICE_DESK',
    label: 'Alerta da IA no ServiceDesk',
    description:
      'Quando a IA proativa detecta que a fila de um departamento deve estourar o SLA.',
  },
  {
    key: 'crm.insight.detected',
    module: 'CRM',
    label: 'Alerta da IA no CRM',
    description:
      'Quando a IA proativa detecta oportunidades paradas, uma etapa travada ou a previsão abaixo da meta.',
  },
  {
    key: 'zap.insight.detected',
    module: 'COMMUNICATION',
    label: 'Alerta da IA na Comunicação',
    description:
      'Quando a IA proativa detecta que o sentimento de uma conversa caiu.',
  },
  {
    key: 'crm.opportunity.stage_changed',
    module: 'CRM',
    label: 'Oportunidade mudou de etapa',
    description: 'Quando uma oportunidade do CRM avança ou volta de etapa.',
  },
  {
    key: 'crm.proposal.viewed',
    module: 'CRM',
    label: 'Proposta visualizada',
    description: 'Quando o cliente abre uma proposta pela primeira vez.',
  },
  {
    key: 'sd.sla.at_risk',
    module: 'SERVICE_DESK',
    label: 'SLA perto de estourar',
    description:
      'Quando o prazo de 1ª resposta ou de resolução de um chamado entra na faixa de risco.',
  },
  {
    key: 'sd.ticket.reopened',
    module: 'SERVICE_DESK',
    label: 'Chamado reaberto',
    description: 'Quando um chamado resolvido ou fechado volta a ser atendido.',
  },
  {
    key: 'zap.message.received',
    module: 'COMMUNICATION',
    label: 'Mensagem recebida',
    description: 'Quando um contato envia uma mensagem no WhatsApp.',
  },
] as const satisfies readonly {
  key: string
  module: ModuleKind
  label: string
  description: string
}[]

export type SteelAgentEventKey = (typeof STEEL_AGENT_EVENTS)[number]['key']

export const STEEL_AGENT_EVENT_KEYS = STEEL_AGENT_EVENTS.map(
  (event) => event.key,
) as [SteelAgentEventKey, ...SteelAgentEventKey[]]

export function steelAgentEvent(key: string) {
  return STEEL_AGENT_EVENTS.find((event) => event.key === key)
}
