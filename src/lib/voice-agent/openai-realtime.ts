import { mulawToPcm16, pcm16ToMulaw } from './codec'
import type {
  RealtimeVoiceProvider,
  VoiceProviderEvents,
  VoiceProviderSession,
  VoiceSessionConfig,
  VoiceUsage,
} from './provider'

export const DEFAULT_REALTIME_MODEL = 'gpt-realtime'
const REALTIME_URL = 'wss://api.openai.com/v1/realtime'
/** Model that transcribes the caller side (the Realtime model does not). */
const CALLER_TRANSCRIPTION_MODEL = 'gpt-4o-mini-transcribe'
const READY_TIMEOUT_MS = 8_000

/** The slice of the WebSocket API the provider uses (Node's global one fits). */
export interface RealtimeSocket {
  readonly readyState: number
  send(data: string): void
  close(code?: number, reason?: string): void
  onopen: ((event: unknown) => void) | null
  onmessage: ((event: { data: unknown }) => void) | null
  onerror: ((event: unknown) => void) | null
  onclose: ((event: unknown) => void) | null
}

export type RealtimeSocketFactory = (
  url: string,
  headers: Record<string, string>,
) => RealtimeSocket

const SOCKET_OPEN = 1

/** Node's global WebSocket (undici) accepts request headers as an option. */
export const defaultSocketFactory: RealtimeSocketFactory = (url, headers) =>
  new (
    WebSocket as unknown as new (
      url: string,
      options: { headers: Record<string, string> },
    ) => RealtimeSocket
  )(url, { headers })

interface RealtimeEvent {
  type?: string
  delta?: string
  transcript?: string
  call_id?: string
  name?: string
  arguments?: string
  error?: { message?: string; code?: string }
  response?: { usage?: RealtimeUsage }
}

interface RealtimeUsage {
  input_tokens?: number
  output_tokens?: number
  input_token_details?: {
    text_tokens?: number
    audio_tokens?: number
    cached_tokens?: number
  }
  output_token_details?: { text_tokens?: number; audio_tokens?: number }
}

export function toVoiceUsage(usage: RealtimeUsage | undefined): VoiceUsage {
  const input = usage?.input_token_details
  const output = usage?.output_token_details
  return {
    inputAudioTokens: input?.audio_tokens ?? 0,
    inputTextTokens: input?.text_tokens ?? 0,
    cachedInputTokens: input?.cached_tokens ?? 0,
    outputAudioTokens: output?.audio_tokens ?? 0,
    outputTextTokens: output?.text_tokens ?? 0,
  }
}

function parseArgs(raw: string | undefined): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw || '{}')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

function sessionUpdate(config: VoiceSessionConfig) {
  return {
    type: 'session.update',
    session: {
      type: 'realtime',
      instructions: config.instructions,
      output_modalities: ['audio'],
      audio: {
        input: {
          format: { type: 'audio/pcmu' },
          transcription: {
            model: CALLER_TRANSCRIPTION_MODEL,
            language: config.language,
          },
          turn_detection: {
            type: 'server_vad',
            threshold: 0.5,
            prefix_padding_ms: 300,
            silence_duration_ms: 500,
            create_response: true,
            interrupt_response: true,
          },
        },
        output: { format: { type: 'audio/pcmu' }, voice: config.voice },
      },
      tools: config.tools.map((tool) => ({
        type: 'function',
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      })),
      tool_choice: 'auto',
    },
  }
}

/** {@link RealtimeVoiceProvider} over the OpenAI Realtime API (WebSocket). */
export class OpenAiRealtimeProvider implements RealtimeVoiceProvider {
  readonly name = 'openai'

  constructor(
    private readonly options: {
      apiKey: string
      model?: string
      socketFactory?: RealtimeSocketFactory
      readyTimeoutMs?: number
    },
  ) {}

  get model(): string {
    return this.options.model ?? DEFAULT_REALTIME_MODEL
  }

  connect(
    config: VoiceSessionConfig,
    events: VoiceProviderEvents,
  ): Promise<VoiceProviderSession> {
    const factory = this.options.socketFactory ?? defaultSocketFactory
    const socket = factory(
      `${REALTIME_URL}?model=${encodeURIComponent(this.model)}`,
      { Authorization: `Bearer ${this.options.apiKey}` },
    )

    const send = (payload: unknown) => {
      if (socket.readyState === SOCKET_OPEN)
        socket.send(JSON.stringify(payload))
    }

    const session: VoiceProviderSession = {
      sendAudio: (pcm8k) =>
        send({
          type: 'input_audio_buffer.append',
          audio: pcm16ToMulaw(pcm8k).toString('base64'),
        }),
      speak: (text) =>
        send({
          type: 'response.create',
          response: {
            instructions: `Diga agora, em voz alta e exatamente com estas palavras, sem acrescentar nem omitir nada: "${text}"`,
          },
        }),
      sendToolResult: (callId, output) => {
        send({
          type: 'conversation.item.create',
          item: { type: 'function_call_output', call_id: callId, output },
        })
        send({ type: 'response.create' })
      },
      respond: (instruction) => {
        // Whatever the model was saying stops; an idle session answers the
        // cancel with `response_cancel_not_active`, which is ignored below.
        send({ type: 'response.cancel' })
        send({
          type: 'response.create',
          response: { instructions: instruction },
        })
      },
      close: () => {
        if (socket.readyState <= SOCKET_OPEN) socket.close(1000, 'done')
      },
    }

    return new Promise<VoiceProviderSession>((resolve, reject) => {
      let ready = false
      const timer = setTimeout(() => {
        if (ready) return
        socket.close(1000, 'timeout')
        reject(new Error('Realtime session did not become ready in time'))
      }, this.options.readyTimeoutMs ?? READY_TIMEOUT_MS)

      socket.onopen = () => send(sessionUpdate(config))
      socket.onerror = () => {
        const error = new Error('Realtime socket error')
        if (!ready) {
          clearTimeout(timer)
          reject(error)
          return
        }
        events.onError(error)
      }
      socket.onclose = () => {
        clearTimeout(timer)
        if (!ready) {
          reject(new Error('Realtime socket closed before it was ready'))
          return
        }
        events.onClose()
      }
      socket.onmessage = (message) => {
        let event: RealtimeEvent
        try {
          event = JSON.parse(String(message.data)) as RealtimeEvent
        } catch {
          return
        }
        switch (event.type) {
          case 'session.updated':
            if (!ready) {
              ready = true
              clearTimeout(timer)
              resolve(session)
            }
            return
          case 'response.output_audio.delta':
          case 'response.audio.delta':
            if (event.delta) {
              events.onAudio(mulawToPcm16(Buffer.from(event.delta, 'base64')))
            }
            return
          case 'input_audio_buffer.speech_started':
            events.onSpeechStarted()
            return
          case 'input_audio_buffer.speech_stopped':
            events.onSpeechStopped()
            return
          case 'conversation.item.input_audio_transcription.completed':
            if (event.transcript?.trim())
              events.onCallerTranscript(event.transcript)
            return
          case 'response.output_audio_transcript.done':
          case 'response.audio_transcript.done':
            if (event.transcript?.trim()) {
              events.onAssistantTranscript(event.transcript)
            }
            return
          case 'response.function_call_arguments.done':
            events.onToolCall({
              id: event.call_id ?? '',
              name: event.name ?? '',
              args: parseArgs(event.arguments),
            })
            return
          case 'response.done':
            events.onUsage(toVoiceUsage(event.response?.usage))
            events.onResponseDone()
            return
          case 'error': {
            if (event.error?.code === 'response_cancel_not_active') return
            const error = new Error(
              event.error?.message ?? event.error?.code ?? 'Realtime error',
            )
            if (!ready) {
              clearTimeout(timer)
              reject(error)
              return
            }
            events.onError(error)
          }
        }
      }
    })
  }
}
