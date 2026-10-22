import {
  injectionVerdict,
  scanPromptInjection,
} from '@/src/lib/ai/guardrails/injection'
import { AUDIO_FRAME_BYTES } from './audiosocket'
import { addVoiceUsage, EMPTY_VOICE_USAGE } from './pricing'
import type {
  RealtimeVoiceProvider,
  VoiceProviderEvents,
  VoiceProviderSession,
  VoiceSessionConfig,
  VoiceToolCall,
  VoiceUsage,
} from './provider'

/** The phone side of the bridge (an Asterisk `AudioSocket` connection). */
export interface AudioChannel {
  /** Caller audio, 8 kHz 16-bit mono PCM. */
  onAudio(listener: (pcm8k: Buffer) => void): void
  /** The caller hung up or the socket dropped. */
  onClosed(listener: () => void): void
  sendAudio(pcm8k: Buffer): void
  /**
   * Tells Asterisk the attendant is done (leaves `AudioSocket()`). The bridge
   * never calls it: the caller does, after storing the outcome, so the
   * dialplan's next question already finds it.
   */
  hangup(): void
}

export type VoiceEndReason =
  | 'caller_hangup'
  | 'transferred'
  | 'silence'
  | 'max_duration'
  | 'provider_error'

export interface VoiceTransfer {
  /** Why the call goes to a person. */
  reason: string
  /** Extension/queue the tools chose; the bridge falls back to the default. */
  target: string | null
}

export interface VoiceToolRun {
  /** JSON text handed back to the model. */
  output: string
  /** The tool decided the call must go to a person. */
  transfer?: VoiceTransfer
}

/** What the bridge needs from the tools (see `createVoiceTools`). */
export interface VoiceToolExecutor {
  execute(
    call: VoiceToolCall,
    context: { tainted: boolean },
  ): Promise<VoiceToolRun>
}

export interface VoiceCallResult {
  endReason: VoiceEndReason
  /** Present when the call must be handed to a person. */
  transfer: VoiceTransfer | null
  /** `Cliente: ...` / `Atendente: ...` lines in order. */
  transcript: string
  durationMs: number
  usage: VoiceUsage
  noticeDelivered: boolean
  /**
   * Per turn, milliseconds from the end of the caller's speech (as detected
   * by the provider) to the first audio of the answer reaching the bridge —
   * the acceptance number of the runbook.
   */
  latenciesMs: number[]
}

export interface VoiceBridgeOptions {
  channel: AudioChannel
  provider: RealtimeVoiceProvider
  config: VoiceSessionConfig
  /** Spoken word for word before anything else. */
  notice: string
  tools: VoiceToolExecutor
  /** Hard cap of the call. */
  maxCallMs: number
  /** Silence from the caller after which the call goes to a person. */
  silenceMs: number
  /** Extension/queue used when no tool picked one. `null` = nobody to hand to. */
  fallbackTarget: string | null
  /** Frame pacing; 20 ms of audio per tick. */
  frameMs?: number
  /** How long to wait for the model to finish a closing sentence. */
  closingGraceMs?: number
}

const DEFAULT_FRAME_MS = 20
const DEFAULT_CLOSING_GRACE_MS = 6_000

const MAX_DURATION_INSTRUCTION =
  'Diga em uma frase curta que o tempo do atendimento automático acabou e que vai transferir para uma pessoa agora. Não faça mais perguntas.'
const SILENCE_INSTRUCTION =
  'Diga em uma frase curta que não está conseguindo ouvir e que vai transferir para uma pessoa agora. Não faça mais perguntas.'
const NO_HUMAN_INSTRUCTION =
  'Diga em uma frase curta que não consegue continuar o atendimento agora e peça para a pessoa ligar de novo mais tarde; despeça-se.'

/**
 * One call of the voice attendant (ADR 0046): moves audio both ways between
 * the phone and the realtime model, plays the mandatory notice first, runs
 * the model's tool calls, enforces the duration and silence limits and
 * decides how the call ends. It never throws: every failure ends in a
 * {@link VoiceCallResult}, usually a hand-off to a person.
 */
export class VoiceCallBridge {
  private readonly frameMs: number
  private readonly closingGraceMs: number
  private readonly startedAt = Date.now()
  private readonly usage: VoiceUsage = { ...EMPTY_VOICE_USAGE }
  private readonly lines: string[] = []
  private readonly latencies: number[] = []
  /** When the caller's turn ended, until the answer's first audio arrives. */
  private turnEndedAt: number | null = null

  private session: VoiceProviderSession | null = null
  private playback: Buffer[] = []
  private playbackTimer: ReturnType<typeof setInterval> | null = null
  private pending: Buffer = Buffer.alloc(0)

  private maxTimer: ReturnType<typeof setTimeout> | null = null
  private silenceTimer: ReturnType<typeof setTimeout> | null = null
  private closingTimer: ReturnType<typeof setTimeout> | null = null

  private noticeRequested = false
  private noticeDelivered = false
  private tainted = false
  /** Set when the call ends after the model's next closing sentence. */
  private closing: {
    reason: VoiceEndReason
    transfer: VoiceTransfer | null
  } | null = null
  /** The closing sentence started to arrive (a cancelled response does not count). */
  private closingAudio = false
  private finished = false
  private resolveResult!: (result: VoiceCallResult) => void

  constructor(private readonly options: VoiceBridgeOptions) {
    this.frameMs = options.frameMs ?? DEFAULT_FRAME_MS
    this.closingGraceMs = options.closingGraceMs ?? DEFAULT_CLOSING_GRACE_MS
  }

  /** Runs the call to its end. */
  run(): Promise<VoiceCallResult> {
    const result = new Promise<VoiceCallResult>((resolve) => {
      this.resolveResult = resolve
    })
    const { channel } = this.options
    channel.onClosed(() => this.finish('caller_hangup', null))
    channel.onAudio((pcm) => this.session?.sendAudio(pcm))
    this.maxTimer = setTimeout(
      () => this.endWithSpeech('max_duration', MAX_DURATION_INSTRUCTION),
      this.options.maxCallMs,
    )
    void this.start()
    return result
  }

  private async start(): Promise<void> {
    try {
      this.session = await this.options.provider.connect(
        this.options.config,
        this.events(),
      )
    } catch {
      this.finish('provider_error', this.handOff('provider_error', null))
      return
    }
    if (this.finished) {
      this.session.close()
      return
    }
    this.noticeRequested = true
    this.session.speak(this.options.notice)
  }

  private events(): VoiceProviderEvents {
    return {
      onAudio: (pcm) => this.enqueuePlayback(pcm),
      onSpeechStarted: () => {
        this.turnEndedAt = null
        this.clearPlayback()
        this.clearSilence()
      },
      onSpeechStopped: () => {
        // Only a real conversation turn counts, not the speech detector
        // firing again during the closing sentence.
        if (this.noticeDelivered && !this.closing) this.turnEndedAt = Date.now()
      },
      onCallerTranscript: (text) => {
        this.lines.push(`Cliente: ${text.trim()}`)
        if (injectionVerdict(scanPromptInjection(text)) !== 'clean') {
          this.tainted = true
        }
      },
      onAssistantTranscript: (text) => {
        this.lines.push(`Atendente: ${text.trim()}`)
      },
      onToolCall: (call) => void this.handleToolCall(call),
      onResponseDone: () => this.handleResponseDone(),
      onUsage: (usage) => addVoiceUsage(this.usage, usage),
      onError: () =>
        this.finish('provider_error', this.handOff('provider_error', null)),
      onClose: () => {
        if (!this.finished) {
          this.finish('provider_error', this.handOff('provider_error', null))
        }
      },
    }
  }

  /* ------------------------------- playback ------------------------------ */

  private enqueuePlayback(pcm: Buffer): void {
    if (this.turnEndedAt !== null) {
      this.latencies.push(Date.now() - this.turnEndedAt)
      this.turnEndedAt = null
    }
    this.clearSilence()
    if (this.closing) this.closingAudio = true
    this.pending = Buffer.concat([this.pending, pcm])
    while (this.pending.length >= AUDIO_FRAME_BYTES) {
      this.playback.push(this.pending.subarray(0, AUDIO_FRAME_BYTES))
      this.pending = this.pending.subarray(AUDIO_FRAME_BYTES)
    }
    if (!this.playbackTimer && !this.finished) {
      this.playbackTimer = setInterval(() => this.tick(), this.frameMs)
    }
  }

  private tick(): void {
    const frame = this.playback.shift()
    if (frame) this.options.channel.sendAudio(frame)
    if (this.playback.length === 0 && this.playbackTimer) {
      clearInterval(this.playbackTimer)
      this.playbackTimer = null
    }
  }

  private clearPlayback(): void {
    this.playback = []
    this.pending = Buffer.alloc(0)
    if (this.playbackTimer) {
      clearInterval(this.playbackTimer)
      this.playbackTimer = null
    }
  }

  /** Milliseconds of audio still queued for the caller. */
  private playbackMs(): number {
    return this.playback.length * this.frameMs
  }

  /* -------------------------------- turns -------------------------------- */

  private handleResponseDone(): void {
    if (this.noticeRequested && !this.noticeDelivered) {
      this.noticeDelivered = true
    }
    if (this.closing) {
      if (!this.closingAudio) return
      // Let the closing sentence reach the caller before hanging up.
      this.clearCloseTimer()
      const { reason, transfer } = this.closing
      this.closingTimer = setTimeout(
        () => this.finish(reason, transfer),
        this.playbackMs() + this.frameMs,
      )
      return
    }
    this.armSilence()
  }

  private armSilence(): void {
    this.clearSilence()
    this.silenceTimer = setTimeout(
      () => this.endWithSpeech('silence', SILENCE_INSTRUCTION),
      this.options.silenceMs + this.playbackMs(),
    )
  }

  private async handleToolCall(call: VoiceToolCall): Promise<void> {
    if (this.finished || !this.session) return
    if (!this.noticeDelivered) {
      this.session.sendToolResult(
        call.id,
        JSON.stringify({
          status: 'error',
          message: 'Aguarde o aviso de atendimento automatizado terminar.',
        }),
      )
      return
    }
    this.clearSilence()
    let run: Awaited<ReturnType<VoiceToolExecutor['execute']>>
    try {
      run = await this.options.tools.execute(call, { tainted: this.tainted })
    } catch {
      run = {
        output: JSON.stringify({
          status: 'error',
          message: 'Não foi possível executar agora.',
        }),
      }
    }
    if (this.finished || !this.session) return
    let output = run.output
    if (run.transfer) {
      const transfer = this.handOff(run.transfer.reason, run.transfer.target)
      if (transfer) {
        this.closing = { reason: 'transferred', transfer }
        this.armClosingGuard()
      } else {
        output = JSON.stringify({
          status: 'error',
          message:
            'Não há ninguém disponível para atender agora. Peça desculpas e sugira ligar mais tarde.',
        })
      }
    }
    this.session.sendToolResult(call.id, output)
  }

  /* -------------------------------- endings ------------------------------- */

  /**
   * Ends the call after one last spoken sentence. Without a person to hand
   * the call to, the sentence is a goodbye instead.
   */
  private endWithSpeech(reason: VoiceEndReason, instruction: string): void {
    if (this.finished || this.closing) return
    this.clearSilence()
    const transfer = this.handOff(reason, null)
    this.closing = { reason, transfer }
    this.armClosingGuard()
    if (!this.session) {
      this.finish(reason, transfer)
      return
    }
    this.session.respond(transfer ? instruction : NO_HUMAN_INSTRUCTION)
  }

  /** If the model never finishes the closing sentence, end the call anyway. */
  private armClosingGuard(): void {
    this.clearCloseTimer()
    this.closingTimer = setTimeout(() => {
      if (this.closing) this.finish(this.closing.reason, this.closing.transfer)
    }, this.closingGraceMs)
  }

  /** The transfer for an ending, or `null` when there is nobody to take it. */
  private handOff(reason: string, target: string | null): VoiceTransfer | null {
    const destination = target ?? this.options.fallbackTarget
    return destination ? { reason, target: destination } : null
  }

  private finish(reason: VoiceEndReason, transfer: VoiceTransfer | null): void {
    if (this.finished) return
    this.finished = true
    for (const timer of [this.maxTimer, this.silenceTimer, this.closingTimer]) {
      if (timer) clearTimeout(timer)
    }
    this.clearPlayback()
    try {
      this.session?.close()
    } catch {
      // The provider is already gone.
    }
    this.resolveResult({
      endReason: reason,
      transfer,
      transcript: this.lines.join('\n'),
      durationMs: Date.now() - this.startedAt,
      usage: this.usage,
      noticeDelivered: this.noticeDelivered,
      latenciesMs: this.latencies,
    })
  }

  private clearSilence(): void {
    if (this.silenceTimer) clearTimeout(this.silenceTimer)
    this.silenceTimer = null
  }

  private clearCloseTimer(): void {
    if (this.closingTimer) clearTimeout(this.closingTimer)
    this.closingTimer = null
  }
}
