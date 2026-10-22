import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WebPhoneCall } from '@/src/lib/webphone/client'
import { type WebPhoneApi, WebPhoneContext } from '../webphone-context'
import { WebPhoneDock } from '../webphone-dock'

function api(overrides: Partial<WebPhoneApi> = {}): WebPhoneApi {
  return {
    enabled: true,
    status: 'online',
    error: null,
    call: null,
    recordingNotice: null,
    dial: vi.fn(async () => undefined),
    answer: vi.fn(async () => undefined),
    hangup: vi.fn(async () => undefined),
    toggleMute: vi.fn(),
    sendDtmf: vi.fn(),
    reconnect: vi.fn(),
    ...overrides,
  }
}

function call(overrides: Partial<WebPhoneCall> = {}): WebPhoneCall {
  return {
    direction: 'in',
    number: '11987654321',
    name: null,
    state: 'incoming',
    answeredAt: null,
    muted: false,
    endReason: null,
    ...overrides,
  }
}

function renderDock(value: WebPhoneApi) {
  return render(
    <WebPhoneContext.Provider value={value}>
      <WebPhoneDock />
    </WebPhoneContext.Provider>,
  )
}

class FakeAudioContext {
  static instances: FakeAudioContext[] = []
  currentTime = 0
  destination = {}
  resume = vi.fn(async () => undefined)
  close = vi.fn(async () => undefined)
  createOscillator = vi.fn(() => ({
    frequency: { value: 0 },
    connect: vi.fn(() => ({ connect: vi.fn() })),
    start: vi.fn(),
    stop: vi.fn(),
  }))
  createGain = vi.fn(() => ({
    gain: { value: 0 },
    connect: vi.fn(() => ({ connect: vi.fn() })),
  }))
  constructor() {
    FakeAudioContext.instances.push(this)
  }
}

describe('<WebPhoneDock />', () => {
  beforeEach(() => {
    FakeAudioContext.instances = []
    vi.stubGlobal('AudioContext', FakeAudioContext)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  describe('connection pill', () => {
    it.each([
      ['online', 'Telefone web'],
      ['connecting', 'Conectando…'],
      ['offline', 'Telefone web desligado'],
      ['other-tab', 'Aberto em outra aba'],
    ] as const)('shows %s', (status, label) => {
      renderDock(api({ status }))
      expect(screen.getByText(label)).toBeTruthy()
    })

    it('offers to reconnect after a failure', () => {
      const phone = api({ status: 'error', error: 'Conexão perdida' })
      renderDock(phone)

      const pill = screen.getByRole('button', {
        name: /Telefone web sem conexão · Reconectar/,
      })
      fireEvent.click(pill)

      expect(phone.reconnect).toHaveBeenCalledTimes(1)
      expect(pill.getAttribute('title')).toBe('Conexão perdida')
    })

    it('is not clickable while healthy', () => {
      renderDock(api())
      const pill = screen.getByRole('button') as HTMLButtonElement
      expect(pill.disabled).toBe(true)
    })
  })

  describe('incoming call', () => {
    it('lets the user answer or decline, and rings meanwhile', () => {
      const phone = api({ call: call({ name: 'Maria' }) })
      renderDock(phone)

      expect(screen.getByText('Maria')).toBeTruthy()
      expect(screen.getByText('11987654321')).toBeTruthy()
      expect(screen.getByText('Chamada recebida')).toBeTruthy()
      expect(FakeAudioContext.instances).toHaveLength(1)

      fireEvent.click(screen.getByRole('button', { name: /Atender/ }))
      expect(phone.answer).toHaveBeenCalledTimes(1)

      fireEvent.click(screen.getByRole('button', { name: /Recusar/ }))
      expect(phone.hangup).toHaveBeenCalledTimes(1)
    })

    it('flags the tab title while ringing and restores it afterwards', () => {
      document.title = 'Steel'
      const { rerender } = renderDock(api({ call: call({ name: 'Maria' }) }))
      expect(document.title).toBe('📞 Maria está ligando')

      rerender(
        <WebPhoneContext.Provider value={api({ call: null })}>
          <WebPhoneDock />
        </WebPhoneContext.Provider>,
      )
      expect(document.title).toBe('Steel')
    })

    it('shows an anonymous caller', () => {
      renderDock(api({ call: call({ number: '' }) }))
      expect(screen.getByText('Número oculto')).toBeTruthy()
    })

    it('stops the ringtone when the call is answered', () => {
      const { rerender } = renderDock(api({ call: call() }))
      const context = FakeAudioContext.instances[0]

      rerender(
        <WebPhoneContext.Provider
          value={api({
            call: call({ state: 'in-call', answeredAt: Date.now() }),
          })}
        >
          <WebPhoneDock />
        </WebPhoneContext.Provider>,
      )

      expect(context.close).toHaveBeenCalled()
    })

    it('rings silently when the browser has no Web Audio', () => {
      vi.stubGlobal('AudioContext', undefined)
      renderDock(api({ call: call() }))
      expect(screen.getByText('Chamada recebida')).toBeTruthy()
    })
  })

  describe('outgoing call', () => {
    it('shows the progress and lets the user hang up', () => {
      const phone = api({
        call: call({ direction: 'out', state: 'calling', name: 'Gusttavo' }),
      })
      const { rerender } = renderDock(phone)
      expect(screen.getByText('Chamando…')).toBeTruthy()
      expect(screen.queryByRole('button', { name: 'Silenciar' })).toBeNull()

      rerender(
        <WebPhoneContext.Provider
          value={{
            ...phone,
            call: call({ direction: 'out', state: 'ringing' }),
          }}
        >
          <WebPhoneDock />
        </WebPhoneContext.Provider>,
      )
      expect(screen.getByText('Tocando…')).toBeTruthy()

      fireEvent.click(screen.getByRole('button', { name: /Desligar/ }))
      expect(phone.hangup).toHaveBeenCalledTimes(1)
    })
  })

  describe('call in progress', () => {
    beforeEach(() => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-10-20T12:00:00.000Z'))
    })

    const answered = (overrides: Partial<WebPhoneCall> = {}) =>
      call({
        state: 'in-call',
        answeredAt: Date.now() - 65_000,
        ...overrides,
      })

    it('shows the recording notice the agent reads to the contact', () => {
      renderDock(
        api({
          call: answered({ direction: 'out' }),
          recordingNotice: 'Esta ligação pode ser gravada.',
        }),
      )
      expect(screen.getByText('Esta ligação pode ser gravada.')).toBeTruthy()
      expect(screen.getByText(/Ligação gravada\./)).toBeTruthy()
    })

    it('shows no notice on a call that is not recorded', () => {
      renderDock(api({ call: answered() }))
      expect(screen.queryByText(/Ligação gravada\./)).toBeNull()
    })

    it('ticks the talk time', () => {
      renderDock(api({ call: answered() }))
      expect(screen.getByText('Em ligação · 01:05')).toBeTruthy()

      act(() => {
        vi.advanceTimersByTime(2000)
      })
      expect(screen.getByText('Em ligação · 01:07')).toBeTruthy()
    })

    it('mutes, unmutes and hangs up', () => {
      const phone = api({ call: answered() })
      const { rerender } = renderDock(phone)

      fireEvent.click(screen.getByRole('button', { name: 'Silenciar' }))
      expect(phone.toggleMute).toHaveBeenCalledTimes(1)

      rerender(
        <WebPhoneContext.Provider
          value={{ ...phone, call: answered({ muted: true }) }}
        >
          <WebPhoneDock />
        </WebPhoneContext.Provider>,
      )
      expect(
        screen.getByRole('button', { name: 'Ativar microfone' }),
      ).toBeTruthy()

      fireEvent.click(screen.getByRole('button', { name: /Desligar/ }))
      expect(phone.hangup).toHaveBeenCalledTimes(1)
    })

    it('opens the keypad and sends DTMF tones', () => {
      const phone = api({ call: answered() })
      renderDock(phone)
      expect(screen.queryByRole('button', { name: '5' })).toBeNull()

      fireEvent.click(screen.getByRole('button', { name: 'Teclado' }))
      fireEvent.click(screen.getByRole('button', { name: '5' }))
      fireEvent.click(screen.getByRole('button', { name: '#' }))

      expect(phone.sendDtmf).toHaveBeenNthCalledWith(1, '5')
      expect(phone.sendDtmf).toHaveBeenNthCalledWith(2, '#')

      fireEvent.click(screen.getByRole('button', { name: 'Teclado' }))
      expect(screen.queryByRole('button', { name: '5' })).toBeNull()
    })
  })

  describe('ended call', () => {
    it('explains why it did not complete', () => {
      renderDock(
        api({
          call: call({
            direction: 'out',
            state: 'ended',
            endReason: 'O contato está ocupado.',
          }),
        }),
      )
      expect(screen.getByText('O contato está ocupado.')).toBeTruthy()
      expect(screen.queryByRole('button', { name: /Desligar/ })).toBeNull()
    })

    it('says the call ended when there is no failure reason', () => {
      renderDock(api({ call: call({ state: 'ended' }) }))
      expect(screen.getByText('Ligação encerrada')).toBeTruthy()
    })
  })
})
