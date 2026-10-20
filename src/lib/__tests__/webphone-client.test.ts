import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  class Emitter<T> {
    listeners: ((value: T) => void)[] = []
    addListener(listener: (value: T) => void) {
      this.listeners.push(listener)
    }
    emit(value: T) {
      for (const listener of this.listeners) listener(value)
    }
  }

  const SessionState = {
    Initial: 'Initial',
    Establishing: 'Establishing',
    Established: 'Established',
    Terminated: 'Terminated',
  }
  const RegistererState = {
    Initial: 'Initial',
    Registered: 'Registered',
    Unregistered: 'Unregistered',
    Terminated: 'Terminated',
  }

  const sender = { track: { enabled: true } }
  const created = {
    ua: undefined as FakeUserAgent | undefined,
    registerer: undefined as FakeRegisterer | undefined,
    inviter: undefined as FakeInviter | undefined,
    makeURI: vi.fn<(uri: string) => unknown>((uri: string) => ({ uri })),
    /** Makes the next Inviter.invite() reject (consumed by that call). */
    nextInviteError: undefined as unknown,
  }

  class FakeSession {
    state = SessionState.Initial
    stateChange = new Emitter<string>()
    sessionDescriptionHandler = {
      peerConnection: {
        getReceivers: () => [{ track: { id: 'remote' } }, { track: null }],
        getSenders: () => [sender, { track: null }],
      },
      sendDtmf: vi.fn(),
    }
    bye = vi.fn(async () => this.move(SessionState.Terminated))
    move(state: string) {
      this.state = state
      this.stateChange.emit(state)
    }
  }

  class Invitation extends FakeSession {
    remoteIdentity = {
      uri: { user: '11987654321' as string | undefined },
      displayName: 'Maria' as string | undefined,
    }
    accept = vi.fn(async (_options?: unknown) =>
      this.move(SessionState.Established),
    )
    reject = vi.fn(async (_options?: unknown) =>
      this.move(SessionState.Terminated),
    )
  }

  class Inviter extends FakeSession {
    options: unknown
    delegate:
      | {
          onProgress?: () => void
          onReject?: (response: { message: { statusCode: number } }) => void
        }
      | undefined
    constructor(
      readonly ua: unknown,
      readonly target: unknown,
      options: unknown,
    ) {
      super()
      this.options = options
      created.inviter = this as unknown as FakeInviter
    }
    invite = vi.fn(
      async (options: { requestDelegate?: Inviter['delegate'] }) => {
        this.delegate = options.requestDelegate
        const failure = created.nextInviteError
        created.nextInviteError = undefined
        if (failure) throw failure
      },
    )
    cancel = vi.fn(async () => this.move(SessionState.Terminated))
  }
  type FakeInviter = Inviter

  class UserAgent {
    static makeURI = created.makeURI
    options: Record<string, unknown>
    start = vi.fn(async () => undefined)
    stop = vi.fn(async () => undefined)
    constructor(options: Record<string, unknown>) {
      this.options = options
      created.ua = this
    }
  }
  type FakeUserAgent = UserAgent

  class Registerer {
    stateChange = new Emitter<string>()
    register = vi.fn(async (_options?: unknown) => undefined)
    unregister = vi.fn(async () => undefined)
    constructor(
      readonly ua: unknown,
      readonly options: unknown,
    ) {
      created.registerer = this
    }
  }
  type FakeRegisterer = Registerer

  return {
    Invitation,
    Inviter,
    UserAgent,
    Registerer,
    SessionState,
    RegistererState,
    sender,
    created,
  }
})

vi.mock('sip.js', () => ({
  Invitation: h.Invitation,
  Inviter: h.Inviter,
  UserAgent: h.UserAgent,
  Registerer: h.Registerer,
  SessionState: h.SessionState,
  RegistererState: h.RegistererState,
}))

import {
  ENDED_VISIBLE_MS,
  type WebPhoneCall,
  WebPhoneClient,
  type WebPhoneStatus,
} from '../webphone/client'

const credentials = {
  extension: '1122S',
  password: 'sip-secret',
  domain: '177.136.201.206',
  wssUrl: 'wss://sbc.stratustelecom.com.br:8089/ws',
  iceServers: [{ urls: ['stun:stun.l.google.com:19302'] }],
}

function setup() {
  const audio = {
    srcObject: null as unknown,
    play: vi.fn(async () => undefined),
  }
  const statuses: [WebPhoneStatus, string | undefined][] = []
  const calls: (WebPhoneCall | null)[] = []
  const client = new WebPhoneClient(
    credentials,
    audio as unknown as HTMLAudioElement,
    {
      onStatus: (status, detail) => statuses.push([status, detail]),
      onCall: (call) => calls.push(call),
    },
  )
  const last = () => calls[calls.length - 1]
  return { client, audio, statuses, calls, last }
}

type Delegate = {
  onInvite: (invitation: InstanceType<typeof h.Invitation>) => void
  onConnect: () => void
  onDisconnect: (error?: Error) => void
}
const delegate = () => {
  if (!h.created.ua) throw new Error('UserAgent was not created')
  return (h.created.ua.options as { delegate: Delegate }).delegate
}

function invite() {
  const invitation = new h.Invitation()
  delegate().onInvite(invitation)
  return invitation
}

describe('WebPhoneClient', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    h.created.makeURI.mockImplementation((uri: string) => ({ uri }))
    h.sender.track.enabled = true
    vi.stubGlobal(
      'MediaStream',
      class {
        tracks: unknown[] = []
        addTrack(track: unknown) {
          this.tracks.push(track)
        }
      },
    )
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  describe('start()', () => {
    it('connects with the extension credentials and registers', async () => {
      const { client, statuses } = setup()

      await client.start()

      const options = h.created.ua?.options
      expect(options).toMatchObject({
        authorizationUsername: '1122S',
        authorizationPassword: 'sip-secret',
        transportOptions: expect.objectContaining({
          server: 'wss://sbc.stratustelecom.com.br:8089/ws',
        }),
        sessionDescriptionHandlerFactoryOptions: {
          peerConnectionConfiguration: { iceServers: credentials.iceServers },
        },
      })
      expect(h.created.makeURI).toHaveBeenCalledWith(
        'sip:1122S@177.136.201.206',
      )
      expect(h.created.ua?.start).toHaveBeenCalled()
      expect(h.created.registerer?.register).toHaveBeenCalledTimes(1)
      expect(statuses[0]).toEqual(['connecting', undefined])
    })

    it('reports online once registered and offline when unregistered', async () => {
      const { client, statuses } = setup()
      await client.start()

      h.created.registerer?.stateChange.emit(h.RegistererState.Registered)
      h.created.registerer?.stateChange.emit(h.RegistererState.Unregistered)
      h.created.registerer?.stateChange.emit(h.RegistererState.Initial)

      expect(statuses.map(([status]) => status)).toEqual([
        'connecting',
        'online',
        'offline',
      ])
    })

    it('registers again after the transport reconnects', async () => {
      const { client } = setup()
      await client.start()

      delegate().onConnect()

      expect(h.created.registerer?.register).toHaveBeenCalledTimes(2)
    })

    it('reports a dropped connection and ignores it after stop()', async () => {
      const { client, statuses } = setup()
      await client.start()

      delegate().onDisconnect(new Error('socket closed'))
      delegate().onDisconnect()
      await client.stop()
      delegate().onDisconnect(new Error('late'))

      expect(statuses.slice(1)).toEqual([
        ['error', 'Conexão com o PABX perdida. Reconectando…'],
        ['offline', undefined],
      ])
    })

    it('reports a rejected or failed registration', async () => {
      const { client, statuses } = setup()
      await client.start()
      const register = h.created.registerer?.register
      const options = register?.mock.calls[0]?.[0] as {
        requestDelegate: { onReject: () => void }
      }

      options.requestDelegate.onReject()
      register?.mockRejectedValueOnce(new Error('transport'))
      delegate().onConnect()
      await vi.advanceTimersByTimeAsync(0)

      expect(statuses.slice(1)).toEqual([
        ['error', 'O PABX recusou o registro do ramal.'],
        ['error', 'Não foi possível registrar o ramal.'],
      ])
    })

    it('fails on an invalid SIP address', async () => {
      h.created.makeURI.mockReturnValueOnce(undefined)
      const { client } = setup()

      await expect(client.start()).rejects.toThrow('Endereço SIP inválido')
    })

    it('does not register once stopped', async () => {
      const { client } = setup()
      await client.start()
      await client.stop()
      h.created.registerer?.register.mockClear()

      delegate().onConnect()

      expect(h.created.registerer?.register).not.toHaveBeenCalled()
    })
  })

  describe('incoming call', () => {
    it('rings with the caller and connects on answer', async () => {
      const { client, audio, last } = setup()
      await client.start()

      const invitation = invite()
      expect(last()).toMatchObject({
        direction: 'in',
        number: '11987654321',
        name: 'Maria',
        state: 'incoming',
      })

      await client.answer()

      expect(invitation.accept).toHaveBeenCalledWith({
        sessionDescriptionHandlerOptions: {
          constraints: { audio: true, video: false },
        },
      })
      expect(last()).toMatchObject({ state: 'in-call' })
      expect(last()?.answeredAt).not.toBeNull()
      expect(audio.srcObject).toBeTruthy()
      expect(audio.play).toHaveBeenCalled()
    })

    it('shows an unknown caller without number or name', async () => {
      const { client, last } = setup()
      await client.start()
      const invitation = new h.Invitation()
      invitation.remoteIdentity = {
        uri: { user: undefined },
        displayName: undefined,
      }

      delegate().onInvite(invitation)

      expect(last()).toMatchObject({ number: '', name: null })
    })

    it('declines with 603 and clears the call after a moment', async () => {
      const { client, last, calls } = setup()
      await client.start()
      const invitation = invite()

      await client.hangup()

      expect(invitation.reject).toHaveBeenCalledWith({ statusCode: 603 })
      expect(last()).toMatchObject({ state: 'ended', endReason: null })
      vi.advanceTimersByTime(ENDED_VISIBLE_MS)
      expect(calls[calls.length - 1]).toBeNull()
    })

    it('answers busy to a second call while one is active', async () => {
      const { client, last } = setup()
      await client.start()
      invite()
      const second = new h.Invitation()

      delegate().onInvite(second)

      expect(second.reject).toHaveBeenCalledWith({ statusCode: 486 })
      expect(last()).toMatchObject({ state: 'incoming' })
    })

    it('ends the call when the caller gives up', async () => {
      const { client, last } = setup()
      await client.start()
      const invitation = invite()

      invitation.move(h.SessionState.Terminated)

      expect(last()).toMatchObject({ state: 'ended', endReason: null })
    })

    it('reports a denied microphone when answering', async () => {
      const { client, last } = setup()
      await client.start()
      const invitation = invite()
      invitation.accept.mockRejectedValueOnce(
        new DOMException('denied', 'NotAllowedError'),
      )

      await client.answer()

      expect(last()).toMatchObject({
        state: 'ended',
        endReason: 'Permita o microfone no navegador para ligar.',
      })
    })

    it('ignores answer() when nothing is ringing', async () => {
      const { client, last } = setup()
      await client.start()

      await client.answer()

      expect(last()).toBeUndefined()
    })
  })

  describe('dial()', () => {
    it('dials 0 + the national number and follows the call', async () => {
      const { client, audio, last } = setup()
      await client.start()

      await client.dial('5513996374317', 'Gusttavo')

      expect(h.created.makeURI).toHaveBeenLastCalledWith(
        'sip:013996374317@177.136.201.206',
      )
      expect(h.created.inviter?.options).toMatchObject({ earlyMedia: true })
      expect(last()).toMatchObject({
        direction: 'out',
        number: '13996374317',
        name: 'Gusttavo',
        state: 'calling',
      })

      h.created.inviter?.delegate?.onProgress?.()
      expect(last()).toMatchObject({ state: 'ringing' })
      expect(audio.play).toHaveBeenCalled()

      h.created.inviter?.move(h.SessionState.Established)
      expect(last()).toMatchObject({ state: 'in-call' })

      h.created.inviter?.move(h.SessionState.Terminated)
      expect(last()).toMatchObject({ state: 'ended', endReason: null })
    })

    it('refuses a second call while one is active', async () => {
      const { client } = setup()
      await client.start()
      await client.dial('13996374317')

      await expect(client.dial('13996374317')).rejects.toThrow(
        'Já existe uma ligação em andamento.',
      )
    })

    it('needs a started phone', async () => {
      const { client } = setup()

      await expect(client.dial('13996374317')).rejects.toThrow(
        'Já existe uma ligação em andamento.',
      )
    })

    it('rejects a number the SIP stack cannot address', async () => {
      const { client } = setup()
      await client.start()
      h.created.makeURI.mockReturnValueOnce(undefined)

      await expect(client.dial('13996374317')).rejects.toThrow(
        'Número inválido.',
      )
    })

    it.each([
      [486, 'O contato está ocupado.'],
      [600, 'O contato está ocupado.'],
      [404, 'Número não encontrado.'],
      [484, 'Número não encontrado.'],
      [503, 'A ligação não completou.'],
    ])('explains a %i answer', async (statusCode, reason) => {
      const { client, last } = setup()
      await client.start()
      await client.dial('13996374317')

      h.created.inviter?.delegate?.onReject?.({ message: { statusCode } })

      expect(last()).toMatchObject({ state: 'ended', endReason: reason })
    })

    it.each([
      [
        new DOMException('denied', 'NotAllowedError'),
        'Permita o microfone no navegador para ligar.',
      ],
      [
        new DOMException('none', 'NotFoundError'),
        'Nenhum microfone encontrado.',
      ],
      [new Error('boom'), 'Não foi possível iniciar a ligação.'],
    ])('explains an INVITE failure (%s)', async (failure, reason) => {
      const { client, last } = setup()
      await client.start()
      h.created.nextInviteError = failure

      await client.dial('13996374317')

      expect(last()).toMatchObject({ state: 'ended', endReason: reason })
    })

    it('lets the user dial again after an INVITE failure', async () => {
      const { client, last } = setup()
      await client.start()
      h.created.nextInviteError = new Error('boom')
      await client.dial('13996374317')
      expect(last()).toMatchObject({ state: 'ended' })

      await expect(client.dial('13996374317')).resolves.toBeUndefined()
      expect(last()).toMatchObject({ state: 'calling' })
    })
  })

  describe('hangup()', () => {
    it('cancels a call that is still ringing', async () => {
      const { client } = setup()
      await client.start()
      await client.dial('13996374317')

      await client.hangup()

      expect(h.created.inviter?.cancel).toHaveBeenCalled()
    })

    it('hangs up an established call with BYE', async () => {
      const { client, last } = setup()
      await client.start()
      await client.dial('13996374317')
      h.created.inviter?.move(h.SessionState.Established)

      await client.hangup()

      expect(h.created.inviter?.bye).toHaveBeenCalled()
      expect(last()).toMatchObject({ state: 'ended' })
    })

    it('does nothing without a call', async () => {
      const { client } = setup()
      await client.start()

      await expect(client.hangup()).resolves.toBeUndefined()
    })
  })

  describe('in-call controls', () => {
    it('mutes and unmutes the microphone track', async () => {
      const { client, last } = setup()
      await client.start()
      await client.dial('13996374317')

      client.setMuted(true)
      expect(h.sender.track.enabled).toBe(false)
      expect(last()).toMatchObject({ muted: true })

      client.setMuted(false)
      expect(h.sender.track.enabled).toBe(true)
      expect(last()).toMatchObject({ muted: false })
    })

    it('sends DTMF tones to the PABX', async () => {
      const { client } = setup()
      await client.start()
      await client.dial('13996374317')

      client.sendDtmf('5')

      expect(
        h.created.inviter?.sessionDescriptionHandler.sendDtmf,
      ).toHaveBeenCalledWith('5')
    })

    it('ignores controls without a call', async () => {
      const { client, calls } = setup()
      await client.start()

      client.setMuted(true)
      client.sendDtmf('1')

      expect(calls).toEqual([])
    })
  })

  describe('stop()', () => {
    it('hangs up, unregisters and closes the connection', async () => {
      const { client, audio } = setup()
      await client.start()
      await client.dial('13996374317')

      await client.stop()

      expect(h.created.inviter?.cancel).toHaveBeenCalled()
      expect(h.created.registerer?.unregister).toHaveBeenCalled()
      expect(h.created.ua?.stop).toHaveBeenCalled()
      expect(audio.srcObject).toBeNull()
    })

    it('swallows failures while shutting down', async () => {
      const { client } = setup()
      await client.start()
      await client.dial('13996374317')
      h.created.inviter?.cancel.mockRejectedValueOnce(new Error('gone'))
      h.created.registerer?.unregister.mockRejectedValueOnce(new Error('down'))
      h.created.ua?.stop.mockRejectedValueOnce(new Error('closed'))

      await expect(client.stop()).resolves.toBeUndefined()
    })
  })
})
