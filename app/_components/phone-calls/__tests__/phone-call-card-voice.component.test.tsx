import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { mockFetch, renderWithQuery } from '@/src/__tests__/component-utils'
import type { PhoneCallRecordDTO } from '@/types/whatsapp-phone-call'
import { PhoneCallCard } from '../phone-call-card'

function voiceCall(
  overrides: Partial<PhoneCallRecordDTO> = {},
): PhoneCallRecordDTO {
  return {
    id: 'call_1',
    conversationId: 'cv_1',
    userId: null,
    extension: 'suporte',
    destination: '5511999998888',
    status: 'COMPLETED',
    answeredAt: '2026-10-22T12:00:00.000Z',
    endedAt: '2026-10-22T12:02:05.000Z',
    durationSeconds: 125,
    createdAt: '2026-10-22T12:00:00.000Z',
    recordingNotice: null,
    hasRecording: false,
    aiStatus: 'DONE',
    voiceAgent: true,
    userName: null,
    contactName: 'Maria',
    recording: null,
    transcript: 'Cliente: oi\nAtendente: olá',
    summary: 'Cliente sem internet.',
    sentiment: 'NEUTRAL',
    sentimentScore: 0,
    nextSteps: [],
    aiModel: 'openai:gpt-4o-mini',
    aiSkipReason: null,
    aiProcessedAt: null,
    sdTicketId: 'tk_1',
    crmPersonId: null,
    crmOpportunityId: null,
    voiceEndReason: 'transferred',
    voiceTransferTarget: '200',
    voiceHandoff: 'Transferida: pediu uma pessoa. Chamado: INC-1.',
    ...overrides,
  }
}

function render(call: PhoneCallRecordDTO) {
  mockFetch([])
  return renderWithQuery(
    <PhoneCallCard workspaceId='ws_1' call={call} taskTarget={null} />,
  )
}

describe('<PhoneCallCard /> — voice attendant calls', () => {
  it('labels the call and shows the hand-off with its context', () => {
    render(voiceCall())
    expect(screen.getByText('Atendente de voz · Maria')).toBeTruthy()
    expect(screen.getByText('IA')).toBeTruthy()
    expect(screen.getByText('Passada para uma pessoa.')).toBeTruthy()
    expect(screen.getByText('Passada para “200”')).toBeTruthy()
    expect(
      screen.getByText('Transferida: pediu uma pessoa. Chamado: INC-1.'),
    ).toBeTruthy()
    expect(screen.getByText('Cliente sem internet.')).toBeTruthy()
  })

  it('explains the other ways the attendant ends', () => {
    const { rerender } = render(
      voiceCall({
        voiceEndReason: 'caller_hangup',
        voiceTransferTarget: null,
        voiceHandoff: null,
      }),
    )
    expect(screen.getByText('O cliente desligou.')).toBeTruthy()
    expect(screen.queryByText(/Passada para/)).toBeNull()

    rerender(
      <PhoneCallCard
        workspaceId='ws_1'
        taskTarget={null}
        call={voiceCall({ voiceEndReason: 'something_new' })}
      />,
    )
    expect(screen.getByText('Atendimento encerrado.')).toBeTruthy()
  })

  it('names the hand-off even when the destination is unknown', () => {
    render(voiceCall({ voiceTransferTarget: null }))
    expect(screen.getByText('Passada para uma pessoa')).toBeTruthy()
  })

  it('hides the hand-off block when the attendant stored nothing', () => {
    render(
      voiceCall({
        voiceEndReason: null,
        voiceTransferTarget: null,
        voiceHandoff: null,
      }),
    )
    expect(screen.queryByText(/Passada para/)).toBeNull()
  })

  it('keeps the plain wording for ordinary calls', () => {
    render(voiceCall({ voiceAgent: false, userName: 'Ana' }))
    expect(screen.getByText('Ligação · Ana → Maria')).toBeTruthy()
    expect(screen.queryByText('IA')).toBeNull()
  })
})
