import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  type Events = {
    onStatus: (status: string, detail?: string) => void
    onCall: (call: unknown) => void
    onCallEvent?: (event: unknown) => void
  }
  const instances: FakeClient[] = []
  class FakeClient {
    start = vi.fn(async () => this.events.onStatus('online'))
    stop = vi.fn(async () => undefined)
    dial = vi.fn(async (_phone: string, _name: string | null) => undefined)
    answer = vi.fn(async () => undefined)
    hangup = vi.fn(async () => undefined)
    setMuted = vi.fn()
    sendDtmf = vi.fn()
    constructor(
      readonly credentials: unknown,
      readonly audio: unknown,
      readonly events: Events,
    ) {
      instances.push(this)
    }
  }
  const tracker = {
    ctor: vi.fn(),
    prepareOutbound: vi.fn(async (_input: unknown) => ['X-Steel: 1']),
    abandonPrepared: vi.fn(),
    handle: vi.fn(),
    onNotice: undefined as ((notice: string | null) => void) | undefined,
  }
  class FakeTracker {
    constructor(workspaceId: string, onNotice: (n: string | null) => void) {
      tracker.ctor(workspaceId)
      tracker.onNotice = onNotice
    }
    prepareOutbound = tracker.prepareOutbound
    abandonPrepared = tracker.abandonPrepared
    handle = tracker.handle
  }
  return {
    instances,
    FakeClient,
    FakeTracker,
    tracker,
    apiFetch: vi.fn(),
    user: undefined as Record<string, unknown> | undefined,
  }
})

vi.mock('@/src/lib/webphone/client', () => ({ WebPhoneClient: h.FakeClient }))
vi.mock('@/src/lib/webphone/call-tracker', () => ({
  WebPhoneCallTracker: h.FakeTracker,
}))
vi.mock('@/src/hooks/_fetch', () => ({ apiFetch: h.apiFetch }))
vi.mock('@/src/hooks/use-user', () => ({
  useUser: () => ({ data: h.user }),
}))

import { useWebPhone } from '../webphone-context'
import { WebPhoneProvider } from '../webphone-provider'

const credentials = {
  extension: '1122S',
  password: 'sip-secret',
  domain: '177.136.201.206',
  wssUrl: 'wss://sbc.stratustelecom.com.br:8089/ws',
  iceServers: [],
}

function approvedUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 'u1',
    pabxExtension: '1122S',
    pabxDeviceId: '0',
    pabxWebphoneEnabled: true,
    ...overrides,
  }
}

function Probe() {
  const phone = useWebPhone()
  return (
    <div>
      <p data-testid='state'>
        {phone.enabled ? 'enabled' : 'disabled'}|{phone.status}|
        {phone.error ?? '-'}|{phone.call?.state ?? '-'}
      </p>
      <p data-testid='notice'>{phone.recordingNotice ?? '-'}</p>
      <button
        type='button'
        onClick={() => void phone.dial('5513996374317', 'Gusttavo')}
      >
        dial
      </button>
      <button type='button' onClick={() => void phone.answer()}>
        answer
      </button>
      <button type='button' onClick={() => void phone.hangup()}>
        hangup
      </button>
      <button type='button' onClick={phone.toggleMute}>
        mute
      </button>
      <button type='button' onClick={() => phone.sendDtmf('7')}>
        dtmf
      </button>
      <button type='button' onClick={phone.reconnect}>
        reconnect
      </button>
    </div>
  )
}

function mountProvider() {
  return render(
    <WebPhoneProvider workspaceId='ws1'>
      <Probe />
    </WebPhoneProvider>,
  )
}

const state = () => screen.getByTestId('state').textContent

function stubLocks(
  request: (name: string, cb: () => Promise<void>) => unknown,
) {
  Object.defineProperty(navigator, 'locks', {
    value: { request },
    configurable: true,
  })
}

describe('<WebPhoneProvider />', () => {
  beforeEach(() => {
    h.instances.length = 0
    h.apiFetch.mockReset()
    h.apiFetch.mockResolvedValue(credentials)
    h.user = approvedUser()
  })

  afterEach(() => {
    Reflect.deleteProperty(navigator, 'locks')
  })

  it('stays inert for a user without an approved extension', () => {
    h.user = approvedUser({ pabxWebphoneEnabled: false })
    mountProvider()

    expect(state()).toBe('disabled|offline|-|-')
    expect(h.apiFetch).not.toHaveBeenCalled()
    expect(screen.queryByText('Telefone web')).toBeNull()
  })

  it.each([
    ['extension', { pabxExtension: null }],
    ['device', { pabxDeviceId: null }],
  ])('stays inert without the %s', (_label, patch) => {
    h.user = approvedUser(patch)
    mountProvider()

    expect(state()).toBe('disabled|offline|-|-')
    expect(h.apiFetch).not.toHaveBeenCalled()
  })

  it('stays inert while the user is still loading', () => {
    h.user = undefined
    mountProvider()

    expect(state()).toBe('disabled|offline|-|-')
  })

  it('fetches the credentials, connects and shows the phone online', async () => {
    mountProvider()

    await waitFor(() => expect(state()).toBe('enabled|online|-|-'))
    expect(h.apiFetch).toHaveBeenCalledWith(
      '/api/users/me/webphone',
      { cache: 'no-store' },
      expect.any(String),
    )
    expect(h.instances).toHaveLength(1)
    expect(h.instances[0].credentials).toEqual(credentials)
    expect(h.instances[0].start).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Telefone web')).toBeTruthy()
  })

  it('mirrors the calls of the client and forwards the actions', async () => {
    mountProvider()
    await waitFor(() => expect(h.instances).toHaveLength(1))
    const client = h.instances[0]

    act(() =>
      client.events.onCall({
        direction: 'in',
        number: '11987654321',
        name: null,
        state: 'incoming',
        answeredAt: null,
        muted: false,
        endReason: null,
      }),
    )
    expect(state()).toContain('|incoming')
    expect(screen.getByText('Chamada recebida')).toBeTruthy()

    fireEvent.click(screen.getByText('answer'))
    fireEvent.click(screen.getByText('hangup'))
    fireEvent.click(screen.getByText('mute'))
    fireEvent.click(screen.getByText('dtmf'))
    fireEvent.click(screen.getByText('dial'))

    expect(client.answer).toHaveBeenCalled()
    expect(client.hangup).toHaveBeenCalled()
    expect(client.setMuted).toHaveBeenCalledWith(true)
    expect(client.sendDtmf).toHaveBeenCalledWith('7')
    await waitFor(() =>
      expect(client.dial).toHaveBeenCalledWith('5513996374317', 'Gusttavo', {
        extraHeaders: ['X-Steel: 1'],
      }),
    )
    expect(h.tracker.prepareOutbound).toHaveBeenCalledWith({
      number: '5513996374317',
      name: 'Gusttavo',
      conversationId: undefined,
    })
  })

  it('reports the call events to the tracker of the workspace', async () => {
    mountProvider()
    await waitFor(() => expect(h.instances).toHaveLength(1))
    expect(h.tracker.ctor).toHaveBeenCalledWith('ws1')

    const event = { type: 'answered' }
    act(() => h.instances[0].events.onCallEvent?.(event))
    expect(h.tracker.handle).toHaveBeenCalledWith(event)

    act(() => h.tracker.onNotice?.('Esta ligação será gravada.'))
    expect(screen.getByTestId('notice').textContent).toBe(
      'Esta ligação será gravada.',
    )
  })

  it('closes the registered call when the phone refuses to dial', async () => {
    const failed = vi.fn()
    function DialProbe() {
      const phone = useWebPhone()
      return (
        <button
          type='button'
          onClick={() => phone.dial('13996374317').catch(failed)}
        >
          try
        </button>
      )
    }
    render(
      <WebPhoneProvider workspaceId='ws1'>
        <DialProbe />
      </WebPhoneProvider>,
    )
    await waitFor(() => expect(h.instances).toHaveLength(1))
    h.instances[0].dial.mockRejectedValueOnce(new Error('ocupado'))

    fireEvent.click(screen.getByText('try'))

    await waitFor(() =>
      expect(failed).toHaveBeenCalledWith(new Error('ocupado')),
    )
    expect(h.tracker.abandonPrepared).toHaveBeenCalled()
  })

  it('shows the connection error and boots again on reconnect', async () => {
    h.apiFetch.mockRejectedValueOnce(new Error('PABX fora do ar'))
    mountProvider()

    await waitFor(() => expect(state()).toBe('enabled|error|PABX fora do ar|-'))
    expect(h.instances).toHaveLength(0)

    fireEvent.click(screen.getByText('reconnect'))

    await waitFor(() => expect(state()).toBe('enabled|online|-|-'))
    expect(h.instances).toHaveLength(1)
  })

  it('falls back to a generic message for a non-Error failure', async () => {
    h.apiFetch.mockRejectedValueOnce('boom')
    mountProvider()

    await waitFor(() =>
      expect(state()).toBe(
        'enabled|error|Não foi possível conectar o telefone web|-',
      ),
    )
  })

  it('relays status updates from the client', async () => {
    mountProvider()
    await waitFor(() => expect(h.instances).toHaveLength(1))

    act(() =>
      h.instances[0].events.onStatus('error', 'Conexão com o PABX perdida.'),
    )

    expect(state()).toBe('enabled|error|Conexão com o PABX perdida.|-')
  })

  it('refuses to dial when the phone is not connected', async () => {
    h.apiFetch.mockRejectedValueOnce(new Error('falhou'))
    const dialed = vi.fn()
    function DialProbe() {
      const phone = useWebPhone()
      return (
        <button
          type='button'
          onClick={() => phone.dial('13996374317').catch(dialed)}
        >
          try
        </button>
      )
    }
    render(
      <WebPhoneProvider workspaceId='ws1'>
        <DialProbe />
      </WebPhoneProvider>,
    )
    await waitFor(() => expect(h.apiFetch).toHaveBeenCalled())

    fireEvent.click(screen.getByText('try'))

    await waitFor(() =>
      expect(dialed).toHaveBeenCalledWith(
        new Error('O telefone web não está conectado.'),
      ),
    )
  })

  it('stops the client when the provider unmounts', async () => {
    const { unmount } = mountProvider()
    await waitFor(() => expect(h.instances).toHaveLength(1))

    unmount()

    await waitFor(() => expect(h.instances[0].stop).toHaveBeenCalled())
  })

  describe('with Web Locks (one tab at a time)', () => {
    it('boots inside the lock and releases it on unmount', async () => {
      let lockName = ''
      let finished: Promise<void> | undefined
      stubLocks((name, callback) => {
        lockName = name
        finished = callback()
        return finished
      })

      const { unmount } = mountProvider()

      await waitFor(() => expect(state()).toBe('enabled|online|-|-'))
      expect(lockName).toBe('steel-webphone:u1')

      unmount()
      await finished
      expect(h.instances[0].stop).toHaveBeenCalled()
    })

    it('says the phone is in another tab while the lock is taken', async () => {
      stubLocks(() => new Promise(() => undefined))

      mountProvider()

      expect(state()).toBe('enabled|other-tab|-|-')
      expect(screen.getByText('Aberto em outra aba')).toBeTruthy()
      expect(h.apiFetch).not.toHaveBeenCalled()
    })

    it('does not connect if it unmounts while waiting for the lock', async () => {
      let acquire: (() => Promise<void>) | undefined
      stubLocks((_name, callback) => {
        acquire = callback
        return new Promise(() => undefined)
      })

      const { unmount } = mountProvider()
      unmount()
      await acquire?.()

      expect(h.apiFetch).not.toHaveBeenCalled()
      expect(h.instances).toHaveLength(0)
    })

    it('closes the client when unmounted while it was still booting', async () => {
      let finished: Promise<void> | undefined
      stubLocks((_name, callback) => {
        finished = callback()
        return finished
      })
      let resolveCredentials: ((value: unknown) => void) | undefined
      h.apiFetch.mockReturnValue(
        new Promise((resolve) => {
          resolveCredentials = resolve
        }),
      )

      const { unmount } = mountProvider()
      unmount()
      resolveCredentials?.(credentials)
      await finished

      expect(h.instances).toHaveLength(0)
    })
  })
})
