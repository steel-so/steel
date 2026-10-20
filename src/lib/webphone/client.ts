import {
  Invitation,
  Inviter,
  Registerer,
  RegistererState,
  type Session,
  SessionState,
  UserAgent,
  type Web,
} from 'sip.js'
import { toDialedNumber } from '@/src/lib/pabx/destination'
import type { WebphoneCredentialsDTO } from '@/types/pabx-webphone'

export type WebPhoneStatus = 'connecting' | 'online' | 'offline' | 'error'

export type WebPhoneCallState =
  | 'incoming'
  | 'calling'
  | 'ringing'
  | 'in-call'
  | 'ended'

export interface WebPhoneCall {
  direction: 'in' | 'out'
  /** Remote number as signalled by the PABX. */
  number: string
  /** Remote display name, when the PABX sends one. */
  name: string | null
  state: WebPhoneCallState
  /** Epoch ms of the answer; `null` until then. */
  answeredAt: number | null
  muted: boolean
  /** Why the call ended without being answered, in user-facing words. */
  endReason: string | null
}

export interface WebPhoneEvents {
  onStatus: (status: WebPhoneStatus, detail?: string) => void
  onCall: (call: WebPhoneCall | null) => void
}

/** How long an ended call stays visible before the dock clears it. */
export const ENDED_VISIBLE_MS = 4000

const MEDIA = { constraints: { audio: true, video: false } }

function describeMediaError(error: unknown): string {
  if (error instanceof DOMException && error.name === 'NotAllowedError')
    return 'Permita o microfone no navegador para ligar.'
  if (error instanceof DOMException && error.name === 'NotFoundError')
    return 'Nenhum microfone encontrado.'
  return 'Não foi possível iniciar a ligação.'
}

/**
 * Browser phone for one extension: registers on the PABX over WSS and places
 * or answers one call at a time. Framework-free; the React provider only
 * mirrors the events.
 */
export class WebPhoneClient {
  private ua: UserAgent | undefined
  private registerer: Registerer | undefined
  private session: Session | undefined
  private call: WebPhoneCall | null = null
  private clearTimer: ReturnType<typeof setTimeout> | undefined
  private stopped = false

  constructor(
    private readonly credentials: WebphoneCredentialsDTO,
    private readonly audio: HTMLAudioElement,
    private readonly events: WebPhoneEvents,
  ) {}

  /** Connects the transport and registers the extension. */
  async start(): Promise<void> {
    const { extension, password, domain, wssUrl, iceServers } = this.credentials
    const uri = UserAgent.makeURI(`sip:${extension}@${domain}`)
    if (!uri) throw new Error('Endereço SIP inválido')

    this.events.onStatus('connecting')
    this.ua = new UserAgent({
      uri,
      authorizationUsername: extension,
      authorizationPassword: password,
      displayName: extension,
      transportOptions: {
        server: wssUrl,
        keepAliveInterval: 20,
        connectionTimeout: 10,
      },
      reconnectionAttempts: 10,
      reconnectionDelay: 4,
      sessionDescriptionHandlerFactoryOptions: {
        peerConnectionConfiguration: { iceServers },
      },
      logLevel: 'error',
      delegate: {
        onInvite: (invitation) => this.handleInvite(invitation),
        // Also fires after an automatic reconnection: register again.
        onConnect: () => void this.register(),
        onDisconnect: (error) => {
          if (this.stopped) return
          this.events.onStatus(
            error ? 'error' : 'offline',
            error ? 'Conexão com o PABX perdida. Reconectando…' : undefined,
          )
        },
      },
    })

    this.registerer = new Registerer(this.ua, { expires: 300 })
    this.registerer.stateChange.addListener((state) => {
      if (this.stopped) return
      if (state === RegistererState.Registered) this.events.onStatus('online')
      else if (state === RegistererState.Unregistered)
        this.events.onStatus('offline')
    })

    await this.ua.start()
    await this.register()
  }

  private async register(): Promise<void> {
    if (this.stopped || !this.registerer) return
    try {
      await this.registerer.register({
        requestDelegate: {
          onReject: () =>
            this.events.onStatus(
              'error',
              'O PABX recusou o registro do ramal.',
            ),
        },
      })
    } catch {
      this.events.onStatus('error', 'Não foi possível registrar o ramal.')
    }
  }

  /** Ends any call, unregisters and closes the connection. */
  async stop(): Promise<void> {
    this.stopped = true
    clearTimeout(this.clearTimer)
    try {
      await this.hangup()
    } catch {
      // The call may already be gone.
    }
    try {
      await this.registerer?.unregister()
    } catch {
      // Not registered or transport down: nothing to undo.
    }
    try {
      await this.ua?.stop()
    } catch {
      // Already stopped.
    }
    this.session = undefined
    this.audio.srcObject = null
  }

  private handleInvite(invitation: Invitation): void {
    if (this.session) {
      void invitation.reject({ statusCode: 486 })
      return
    }
    this.session = invitation
    this.setCall({
      direction: 'in',
      number: invitation.remoteIdentity.uri.user ?? '',
      name: invitation.remoteIdentity.displayName || null,
      state: 'incoming',
      answeredAt: null,
      muted: false,
      endReason: null,
    })
    this.watch(invitation)
  }

  /** Places a call to a phone number (any format; a leading 55 is dropped). */
  async dial(phone: string, name: string | null = null): Promise<void> {
    if (!this.ua || this.session)
      throw new Error('Já existe uma ligação em andamento.')
    const dialed = toDialedNumber(phone)
    const target = UserAgent.makeURI(`sip:${dialed}@${this.credentials.domain}`)
    if (!target) throw new Error('Número inválido.')

    const inviter = new Inviter(this.ua, target, {
      earlyMedia: true,
      sessionDescriptionHandlerOptions: MEDIA,
    })
    this.session = inviter
    this.setCall({
      direction: 'out',
      number: dialed.replace(/^0/, ''),
      name,
      state: 'calling',
      answeredAt: null,
      muted: false,
      endReason: null,
    })
    this.watch(inviter)

    try {
      await inviter.invite({
        requestDelegate: {
          onProgress: () => {
            this.patchCall({ state: 'ringing' })
            this.attachMedia()
          },
          onReject: (response) =>
            this.finish(
              response.message.statusCode === 486 ||
                response.message.statusCode === 600
                ? 'O contato está ocupado.'
                : response.message.statusCode === 404 ||
                    response.message.statusCode === 484
                  ? 'Número não encontrado.'
                  : 'A ligação não completou.',
            ),
        },
      })
    } catch (error) {
      this.finish(describeMediaError(error))
      this.session = undefined
    }
  }

  async answer(): Promise<void> {
    const session = this.session
    if (!(session instanceof Invitation) || this.call?.state !== 'incoming')
      return
    try {
      await session.accept({ sessionDescriptionHandlerOptions: MEDIA })
    } catch (error) {
      this.finish(describeMediaError(error))
    }
  }

  /** Declines an incoming call, cancels a ringing one or hangs up. */
  async hangup(): Promise<void> {
    const session = this.session
    if (!session) return
    if (session.state === SessionState.Established) {
      await session.bye()
    } else if (session instanceof Inviter) {
      await session.cancel()
    } else if (session instanceof Invitation) {
      await session.reject({ statusCode: 603 })
    }
  }

  setMuted(muted: boolean): void {
    const handler = this.session?.sessionDescriptionHandler as
      | Web.SessionDescriptionHandler
      | undefined
    handler?.peerConnection?.getSenders().forEach((sender) => {
      if (sender.track) sender.track.enabled = !muted
    })
    this.patchCall({ muted })
  }

  sendDtmf(tone: string): void {
    const handler = this.session?.sessionDescriptionHandler as
      | Web.SessionDescriptionHandler
      | undefined
    handler?.sendDtmf(tone)
  }

  private watch(session: Session): void {
    session.stateChange.addListener((state) => {
      if (session !== this.session) return
      if (state === SessionState.Established) {
        this.attachMedia()
        this.patchCall({ state: 'in-call', answeredAt: Date.now() })
      } else if (state === SessionState.Terminated) {
        this.finish(null)
      }
    })
  }

  private attachMedia(): void {
    const handler = this.session?.sessionDescriptionHandler as
      | Web.SessionDescriptionHandler
      | undefined
    const connection = handler?.peerConnection
    if (!connection) return
    const stream = new MediaStream()
    for (const receiver of connection.getReceivers()) {
      if (receiver.track) stream.addTrack(receiver.track)
    }
    this.audio.srcObject = stream
    void this.audio.play().catch(() => undefined)
  }

  /** Closes the current call, keeping it visible for a moment. */
  private finish(reason: string | null): void {
    if (!this.call) return
    const wasAnswered = this.call.answeredAt !== null
    this.session = undefined
    this.audio.srcObject = null
    this.setCall({
      ...this.call,
      state: 'ended',
      endReason: wasAnswered ? null : reason,
    })
    clearTimeout(this.clearTimer)
    this.clearTimer = setTimeout(() => this.setCall(null), ENDED_VISIBLE_MS)
  }

  private setCall(call: WebPhoneCall | null): void {
    this.call = call
    this.events.onCall(call)
  }

  private patchCall(patch: Partial<WebPhoneCall>): void {
    if (this.call) this.setCall({ ...this.call, ...patch })
  }
}
