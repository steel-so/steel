import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MessageBubble } from '@/components/ui/chat/message-bubble'
import type { WhatsAppConversationEventDTO } from '@/types/whatsapp-conversation'
import type { WhatsAppMessageDTO } from '@/types/whatsapp-message'
import { WhatsappConversationEventChip } from '../whatsapp-conversation-event-chip'

function message(overrides: Partial<WhatsAppMessageDTO>): WhatsAppMessageDTO {
  return {
    id: 'm1',
    workspaceId: 'ws_1',
    conversationId: 'cv_1',
    direction: 'OUT',
    type: 'TEXT',
    text: 'Podemos confirmar?',
    mediaUrl: null,
    status: 'READ',
    senderUserId: 'u_1',
    sentByAi: false,
    replyToMessageId: null,
    reactionEmoji: null,
    reactedByContact: null,
    contactPayload: null,
    buttons: null,
    buttonPayload: null,
    createdAt: '2026-01-01T12:00:00.000Z',
    ...overrides,
  }
}

function event(
  overrides: Partial<WhatsAppConversationEventDTO>,
): WhatsAppConversationEventDTO {
  return {
    id: 'ev_1',
    conversationId: 'cv_1',
    kind: 'CLOSED',
    source: 'AGENT',
    actorUserId: null,
    actorName: null,
    reason: null,
    createdAt: '2026-01-01T12:00:00.000Z',
    ...overrides,
  }
}

describe('<MessageBubble /> buttons', () => {
  it('renders sent buttons under the bubble: reply inert, link opens', () => {
    render(
      <MessageBubble
        message={message({
          buttons: [
            { id: 'b1', type: 'REPLY', label: 'Confirmar' },
            { id: 'b2', type: 'URL', label: 'Remarcar', url: 'https://x.test' },
          ],
        })}
      />,
    )
    const group = screen.getByLabelText('Botões enviados')
    const reply = within(group).getByText('Confirmar').parentElement
    expect(reply?.getAttribute('aria-disabled')).toBe('true')
    expect(reply?.tagName).toBe('SPAN')
    const link = within(group).getByRole('link', { name: /Remarcar/ })
    expect(link.getAttribute('href')).toBe('https://x.test')
    expect(link.getAttribute('target')).toBe('_blank')
  })

  it('renders nothing extra for messages without buttons', () => {
    render(<MessageBubble message={message({})} />)
    expect(screen.queryByLabelText('Botões enviados')).toBeNull()
  })

  it('shows an inbound click as "Clicou em"', () => {
    render(
      <MessageBubble
        message={message({
          direction: 'IN',
          type: 'BUTTON',
          text: 'Confirmar',
          buttonPayload: 'stl:t:tpl_1:b1',
        })}
      />,
    )
    expect(screen.getByText('Clicou em:')).toBeTruthy()
    expect(screen.getByText('Confirmar')).toBeTruthy()
  })

  it('falls back to a generic label for a click without text', () => {
    render(
      <MessageBubble
        message={message({ direction: 'IN', type: 'BUTTON', text: null })}
      />,
    )
    expect(screen.getByText('botão')).toBeTruthy()
  })
})

describe('<WhatsappConversationEventChip />', () => {
  it.each([
    [
      event({ kind: 'BUTTON_CLICKED', source: 'CONTACT', reason: 'Sim' }),
      'O contato clicou em “Sim”',
    ],
    [
      event({ kind: 'BUTTON_CLICKED', source: 'CONTACT' }),
      'O contato clicou em um botão',
    ],
    [
      event({ kind: 'ASSIGNED', source: 'BUTTON_ACTION' }),
      'Conversa atribuída pela ação de um botão',
    ],
    [
      event({ kind: 'ASSIGNED', source: 'AGENT', actorName: 'Ana' }),
      'Conversa atribuída por Ana',
    ],
    [
      event({ kind: 'TEAM_CHANGED', source: 'BUTTON_ACTION' }),
      'Conversa movida de equipe pela ação de um botão',
    ],
    [
      event({ kind: 'CLOSED', source: 'BUTTON_ACTION' }),
      'Conversa fechada pela ação de um botão',
    ],
    [
      event({ kind: 'CLOSED', source: 'INACTIVITY' }),
      'Conversa fechada automaticamente por inatividade',
    ],
    [event({ kind: 'CLOSED', source: 'AGENT' }), 'Conversa fechada'],
    [
      event({ kind: 'REOPENED', source: 'CONTACT' }),
      'Conversa reaberta: o contato enviou uma nova mensagem',
    ],
    [
      event({ kind: 'REOPENED', source: 'AGENT', actorName: 'Bia' }),
      'Conversa reaberta por Bia',
    ],
    [
      event({ kind: 'SENTIMENT_ALERT', source: 'SENTIMENT' }),
      'Sentimento negativo: supervisores avisados',
    ],
  ])('describes %#', (item, text) => {
    render(<WhatsappConversationEventChip event={item} />)
    expect(screen.getByText(new RegExp(`^${text} ·`))).toBeTruthy()
  })

  it('shows the reason under the event, but not twice for a click', () => {
    const { rerender } = render(
      <WhatsappConversationEventChip
        event={event({ kind: 'CLOSED', reason: 'Resolvido' })}
      />,
    )
    expect(screen.getByText('Motivo: Resolvido')).toBeTruthy()

    rerender(
      <WhatsappConversationEventChip
        event={event({ kind: 'TEAM_CHANGED', reason: 'Para: Suporte N1' })}
      />,
    )
    expect(screen.getByText('Para: Suporte N1')).toBeTruthy()

    rerender(
      <WhatsappConversationEventChip
        event={event({ kind: 'SENTIMENT_ALERT', reason: 'Cliente irritado' })}
      />,
    )
    expect(screen.getByText('Cliente irritado')).toBeTruthy()

    rerender(
      <WhatsappConversationEventChip
        event={event({ kind: 'BUTTON_CLICKED', reason: 'Sim' })}
      />,
    )
    expect(screen.queryByText('Sim')).toBeNull()
  })
})
