'use client'

import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import type { WhatsAppConversationEventDTO } from '@/types/whatsapp-conversation'
import { CLOSE_OUTCOME_LABEL } from './whatsapp-close-outcome-badge'

const BY_BUTTON = 'pela ação de um botão'

function byActor(event: WhatsAppConversationEventDTO): string {
  if (event.source === 'BUTTON_ACTION') return ` ${BY_BUTTON}`
  if (event.source === 'DISTRIBUTION') return ' pela distribuição automática'
  return event.actorName ? ` por ${event.actorName}` : ''
}

/** " — deu certo: Venda realizada" for a classified close. */
function closeClassification(event: WhatsAppConversationEventDTO): string {
  if (!event.closeOutcome) return ''
  const labels = event.closeStatusLabels.length
    ? `: ${event.closeStatusLabels.join(', ')}`
    : ''
  return ` — ${CLOSE_OUTCOME_LABEL[event.closeOutcome].toLowerCase()}${labels}`
}

function describeEvent(event: WhatsAppConversationEventDTO): string {
  switch (event.kind) {
    case 'SENTIMENT_ALERT':
      return 'Sentimento negativo: supervisores avisados'
    case 'AI_GUARDRAIL_HANDOFF':
      return 'A IA parou de responder e transferiu para um atendente'
    // `reason` = "action label: why the AI ran it".
    case 'AI_ACTION':
      return 'A IA da campanha executou uma ação'
    // `reason` says which target: "Primeira resposta" or "Resolução".
    case 'SLA_BREACHED':
      return 'SLA estourado: responsáveis avisados'
    case 'BUTTON_CLICKED':
      return event.reason
        ? `O contato clicou em “${event.reason}”`
        : 'O contato clicou em um botão'
    // `reason` carries the assignee / team name (null = removed).
    case 'ASSIGNED':
      return event.reason
        ? `Conversa atribuída a ${event.reason}${byActor(event)}`
        : `Conversa devolvida para a fila${byActor(event)}`
    case 'TEAM_CHANGED':
      return event.reason
        ? `Conversa movida para a equipe ${event.reason}${byActor(event)}`
        : `Conversa tirada da equipe${byActor(event)}`
    case 'CLOSED':
      if (event.source === 'INACTIVITY') {
        return 'Conversa fechada automaticamente por inatividade'
      }
      return `Conversa fechada${byActor(event)}${closeClassification(event)}`
    case 'REOPENED':
      if (event.source === 'CONTACT') {
        return 'Conversa reaberta: o contato enviou uma nova mensagem'
      }
      if (event.source === 'AUTO_OUTREACH' || event.source === 'AI_CAMPAIGN') {
        return 'Conversa reaberta por uma campanha de IA'
      }
      return `Conversa reaberta${byActor(event)}`
  }
}

/** The reason line under the event, when it adds something. */
function detailOf(event: WhatsAppConversationEventDTO): string | null {
  if (!event.reason) return null
  // The click's label is already in the headline.
  if (event.kind === 'BUTTON_CLICKED') return null
  if (event.kind === 'SENTIMENT_ALERT') return event.reason
  // The guardrail note says why the AI stopped.
  if (event.kind === 'AI_GUARDRAIL_HANDOFF') return event.reason
  if (event.kind === 'AI_ACTION') return event.reason
  if (event.kind === 'SLA_BREACHED') return event.reason
  // The assignee / team name is already in the headline.
  if (event.kind === 'ASSIGNED' || event.kind === 'TEAM_CHANGED') return null
  return `Motivo: ${event.reason}`
}

/** Timeline item between the messages (closed/reopened, button clicks,
 * assignment and team changes). */
export function WhatsappConversationEventChip({
  event,
}: {
  event: WhatsAppConversationEventDTO
}) {
  const detail = detailOf(event)
  return (
    <div className='my-2 flex justify-center'>
      <div className='max-w-[80%] rounded-md bg-muted px-3 py-1.5 text-center text-muted-foreground text-xs'>
        <p>
          {describeEvent(event)} ·{' '}
          {format(new Date(event.createdAt), "dd/MM 'às' HH:mm", {
            locale: ptBR,
          })}
        </p>
        {detail ? <p className='mt-0.5 italic'>{detail}</p> : null}
      </div>
    </div>
  )
}
