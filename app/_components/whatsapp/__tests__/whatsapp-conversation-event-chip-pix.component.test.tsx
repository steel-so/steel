import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { WhatsAppConversationEventDTO } from '@/types/whatsapp-conversation'
import { WhatsappConversationEventChip } from '../whatsapp-conversation-event-chip'

function pixEvent(
  overrides: Partial<WhatsAppConversationEventDTO> = {},
): WhatsAppConversationEventDTO {
  return {
    id: 'ev_1',
    conversationId: 'cv_1',
    kind: 'PIX_PAID',
    source: 'PIX',
    actorUserId: null,
    actorName: null,
    reason: 'R$ 150,00 · Mensalidade',
    closeOutcome: null,
    closeStatusLabels: [],
    createdAt: '2026-01-01T15:00:00.000Z',
    ...overrides,
  }
}

describe('<WhatsappConversationEventChip /> Pix', () => {
  it('announces the received payment in the thread, once', () => {
    render(<WhatsappConversationEventChip event={pixEvent()} />)
    expect(
      screen.getByText(/Pix recebido: R\$ 150,00 · Mensalidade/),
    ).toBeTruthy()
    // The charge is in the headline: no second "Motivo" line.
    expect(screen.queryByText(/Motivo/)).toBeNull()
  })

  it('still reads without a reason', () => {
    render(<WhatsappConversationEventChip event={pixEvent({ reason: null })} />)
    expect(screen.getByText(/^Pix recebido:/)).toBeTruthy()
  })
})
