import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { WhatsAppConversationEventDTO } from '@/types/whatsapp-conversation'
import { WhatsappConversationEventChip } from '../whatsapp-conversation-event-chip'

function summaryEvent(
  overrides: Partial<WhatsAppConversationEventDTO> = {},
): WhatsAppConversationEventDTO {
  return {
    id: 'ev_1',
    conversationId: 'cv_1',
    kind: 'TRANSFER_SUMMARY',
    source: 'COPILOT',
    actorUserId: 'u1',
    actorName: 'Ana',
    reason: 'Cliente quer reagendar.\n\nPendente:\n- Confirmar horário',
    closeOutcome: null,
    closeStatusLabels: [],
    createdAt: '2026-01-01T15:00:00.000Z',
    ...overrides,
  }
}

describe('<WhatsappConversationEventChip /> transfer summary', () => {
  it('shows the headline and the summary text for the team', () => {
    render(<WhatsappConversationEventChip event={summaryEvent()} />)
    expect(screen.getByText(/Resumo da conversa para quem assume/)).toBeTruthy()
    const detail = screen.getByText(/Cliente quer reagendar/)
    expect(detail.textContent).toContain('- Confirmar horário')
    expect(detail.className).toContain('whitespace-pre-line')
  })

  it('keeps the headline when there is no text', () => {
    render(
      <WhatsappConversationEventChip event={summaryEvent({ reason: null })} />,
    )
    expect(screen.getByText(/Resumo da conversa para quem assume/)).toBeTruthy()
  })
})
