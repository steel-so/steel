'use client'

import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import type { WhatsAppConversationEventDTO } from '@/types/whatsapp-conversation'

const BY_BUTTON = 'pela ação de um botão'

function byActor(event: WhatsAppConversationEventDTO): string {
  if (event.source === 'BUTTON_ACTION') return ` ${BY_BUTTON}`
  return event.actorName ? ` por ${event.actorName}` : ''
}

function describeEvent(event: WhatsAppConversationEventDTO): string {
  switch (event.kind) {
    case 'SENTIMENT_ALERT':
      return 'Sentimento negativo: supervisores avisados'
    case 'BUTTON_CLICKED':
      return event.reason
        ? `O contato clicou em “${event.reason}”`
        : 'O contato clicou em um botão'
    case 'ASSIGNED':
      return `Conversa atribuída${byActor(event)}`
    case 'TEAM_CHANGED':
      return `Conversa movida de equipe${byActor(event)}`
    case 'CLOSED':
      if (event.source === 'INACTIVITY') {
        return 'Conversa fechada automaticamente por inatividade'
      }
      return `Conversa fechada${byActor(event)}`
    case 'REOPENED':
      if (event.source === 'CONTACT') {
        return 'Conversa reaberta: o contato enviou uma nova mensagem'
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
  if (event.kind === 'ASSIGNED' || event.kind === 'TEAM_CHANGED') {
    return event.reason
  }
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
