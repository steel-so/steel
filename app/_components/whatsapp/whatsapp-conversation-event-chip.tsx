'use client'

import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import type { WhatsAppConversationEventDTO } from '@/types/whatsapp-conversation'

function describeEvent(event: WhatsAppConversationEventDTO): string {
  const by = event.actorName ? ` por ${event.actorName}` : ''
  // Equipes: `reason` carries the assignee / team name (null = removed).
  if (event.kind === 'ASSIGNED') {
    return event.reason
      ? `Conversa atribuída a ${event.reason}${by}`
      : `Conversa devolvida para a fila${by}`
  }
  if (event.kind === 'TEAM_CHANGED') {
    return event.reason
      ? `Conversa movida para a equipe ${event.reason}${by}`
      : `Conversa tirada da equipe${by}`
  }
  if (event.kind === 'SENTIMENT_ALERT') {
    return 'Sentimento negativo: supervisores avisados'
  }
  if (event.kind === 'CLOSED') {
    if (event.source === 'INACTIVITY') {
      return 'Conversa fechada automaticamente por inatividade'
    }
    return `Conversa fechada${event.actorName ? ` por ${event.actorName}` : ''}`
  }
  if (event.source === 'CONTACT') {
    return 'Conversa reaberta: o contato enviou uma nova mensagem'
  }
  return `Conversa reaberta${event.actorName ? ` por ${event.actorName}` : ''}`
}

/** Item da linha do tempo (fechada/reaberta) entre as mensagens. */
export function WhatsappConversationEventChip({
  event,
}: {
  event: WhatsAppConversationEventDTO
}) {
  return (
    <div className='my-2 flex justify-center'>
      <div className='max-w-[80%] rounded-md bg-muted px-3 py-1.5 text-center text-muted-foreground text-xs'>
        <p>
          {describeEvent(event)} ·{' '}
          {format(new Date(event.createdAt), "dd/MM 'às' HH:mm", {
            locale: ptBR,
          })}
        </p>
        {event.reason &&
        event.kind !== 'ASSIGNED' &&
        event.kind !== 'TEAM_CHANGED' ? (
          <p className='mt-0.5 italic'>
            {event.kind === 'SENTIMENT_ALERT'
              ? event.reason
              : `Motivo: ${event.reason}`}
          </p>
        ) : null}
      </div>
    </div>
  )
}
