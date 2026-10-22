import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WhatsAppPhoneCallDTO } from '@/types/whatsapp-phone-call'
import { WhatsappPhoneCallBanner } from '../whatsapp-phone-call-banner'

const NOW = new Date('2026-10-13T12:00:00.000Z')

function call(overrides: Partial<WhatsAppPhoneCallDTO>): WhatsAppPhoneCallDTO {
  return {
    id: 'call_1',
    conversationId: 'cv_1',
    direction: 'OUTBOUND',
    source: 'CLICK_TO_CALL',
    userId: 'u_1',
    extension: '200',
    destination: '11999999999',
    status: 'QUEUED',
    answeredAt: null,
    endedAt: null,
    durationSeconds: null,
    createdAt: NOW.toISOString(),
    recordingNotice: null,
    hasRecording: false,
    aiStatus: 'NONE',
    ...overrides,
  }
}

const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString()

describe('<WhatsappPhoneCallBanner />', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders nothing without a call', () => {
    const { container } = render(<WhatsappPhoneCallBanner call={null} />)
    expect(container.innerHTML).toBe('')
  })

  it('shows the extension ringing, then the contact being dialed', () => {
    const { rerender } = render(
      <WhatsappPhoneCallBanner call={call({ status: 'QUEUED' })} />,
    )
    expect(screen.getByText('Chamando seu ramal 200…')).toBeTruthy()

    rerender(<WhatsappPhoneCallBanner call={call({ status: 'DIALING' })} />)
    expect(screen.getByText('Chamando 11999999999…')).toBeTruthy()
  })

  it('ticks the talk time while the call is in progress', () => {
    render(
      <WhatsappPhoneCallBanner
        call={call({ status: 'IN_PROGRESS', answeredAt: ago(65_000) })}
      />,
    )
    expect(screen.getByText('Em ligação · 01:05')).toBeTruthy()

    act(() => {
      vi.advanceTimersByTime(2_000)
    })
    expect(screen.getByText('Em ligação · 01:07')).toBeTruthy()
  })

  it.each([
    ['BUSY', 'O contato está ocupado'],
    ['NO_ANSWER', 'O contato não atendeu'],
    ['CANCELED', 'Ligação cancelada antes do contato atender'],
    ['EXTENSION_NO_ANSWER', 'Seu ramal não atendeu'],
    ['FAILED', 'A ligação falhou'],
  ] as const)('explains a %s ending', (status, label) => {
    render(
      <WhatsappPhoneCallBanner call={call({ status, endedAt: ago(1_000) })} />,
    )
    expect(screen.getByText(label)).toBeTruthy()
  })

  it('shows the talk time of a completed call for a minute', () => {
    const { container } = render(
      <WhatsappPhoneCallBanner
        call={call({
          status: 'COMPLETED',
          durationSeconds: 42,
          endedAt: ago(1_000),
        })}
      />,
    )
    expect(screen.getByText('Ligação encerrada · 00:42')).toBeTruthy()

    act(() => {
      vi.advanceTimersByTime(60_000)
    })
    expect(container.innerHTML).toBe('')
  })

  it('hides a ringing call the PABX never reported back', () => {
    const { container } = render(
      <WhatsappPhoneCallBanner
        call={call({ status: 'DIALING', createdAt: ago(4 * 60_000) })}
      />,
    )
    expect(container.innerHTML).toBe('')
  })

  it('shows the recording notice to read while a recorded call is live', () => {
    const { rerender } = render(
      <WhatsappPhoneCallBanner
        call={call({
          status: 'IN_PROGRESS',
          answeredAt: ago(1000),
          recordingNotice: 'Avise o contato que a ligação é gravada.',
        })}
      />,
    )
    expect(screen.getByText('Ligação gravada.')).toBeTruthy()
    expect(
      screen.getByText(/Avise o contato que a ligação é gravada\./),
    ).toBeTruthy()

    rerender(
      <WhatsappPhoneCallBanner
        call={call({
          status: 'COMPLETED',
          endedAt: ago(1000),
          durationSeconds: 30,
          recordingNotice: 'Avise o contato que a ligação é gravada.',
        })}
      />,
    )
    expect(screen.queryByText('Ligação gravada.')).toBeNull()
  })
})
