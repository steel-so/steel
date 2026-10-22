import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from 'vitest'
import { mulawToPcm16, pcm16ToMulaw } from '../voice-agent/codec'
import {
  DEFAULT_REALTIME_MODEL,
  defaultSocketFactory,
  OpenAiRealtimeProvider,
  type RealtimeSocket,
  toVoiceUsage,
} from '../voice-agent/openai-realtime'
import type {
  VoiceProviderEvents,
  VoiceSessionConfig,
} from '../voice-agent/provider'

class FakeSocket implements RealtimeSocket {
  readyState = 0
  sent: Record<string, unknown>[] = []
  closed: { code?: number; reason?: string } | null = null
  onopen: ((event: unknown) => void) | null = null
  onmessage: ((event: { data: unknown }) => void) | null = null
  onerror: ((event: unknown) => void) | null = null
  onclose: ((event: unknown) => void) | null = null

  send(data: string) {
    this.sent.push(JSON.parse(data))
  }
  close(code?: number, reason?: string) {
    this.closed = { code, reason }
    this.readyState = 3
  }
  open() {
    this.readyState = 1
    this.onopen?.({})
  }
  receive(event: unknown) {
    this.onmessage?.({
      data: typeof event === 'string' ? event : JSON.stringify(event),
    })
  }
}

const CONFIG: VoiceSessionConfig = {
  instructions: 'Seja breve',
  voice: 'alloy',
  language: 'pt',
  tools: [
    {
      name: 'ping',
      description: 'Pinga',
      parameters: { type: 'object', properties: {} },
    },
  ],
}

type MockEvents = {
  [K in keyof VoiceProviderEvents]: Mock<VoiceProviderEvents[K]>
}

function events(): MockEvents {
  return {
    onAudio: vi.fn<VoiceProviderEvents['onAudio']>(),
    onSpeechStarted: vi.fn<VoiceProviderEvents['onSpeechStarted']>(),
    onSpeechStopped: vi.fn<VoiceProviderEvents['onSpeechStopped']>(),
    onCallerTranscript: vi.fn<VoiceProviderEvents['onCallerTranscript']>(),
    onAssistantTranscript:
      vi.fn<VoiceProviderEvents['onAssistantTranscript']>(),
    onToolCall: vi.fn<VoiceProviderEvents['onToolCall']>(),
    onResponseDone: vi.fn<VoiceProviderEvents['onResponseDone']>(),
    onUsage: vi.fn<VoiceProviderEvents['onUsage']>(),
    onError: vi.fn<VoiceProviderEvents['onError']>(),
    onClose: vi.fn<VoiceProviderEvents['onClose']>(),
  }
}

let socket: FakeSocket
let factoryArgs: { url: string; headers: Record<string, string> } | null

function provider(extra: { readyTimeoutMs?: number } = {}) {
  return new OpenAiRealtimeProvider({
    apiKey: 'sk-test',
    socketFactory: (url, headers) => {
      factoryArgs = { url, headers }
      return socket
    },
    ...extra,
  })
}

async function ready(handlers: MockEvents = events(), p = provider()) {
  const pending = p.connect(CONFIG, handlers)
  socket.open()
  socket.receive({ type: 'session.updated' })
  const session = await pending
  return { session, handlers }
}

beforeEach(() => {
  socket = new FakeSocket()
  factoryArgs = null
})

afterEach(() => {
  vi.useRealTimers()
})

describe('OpenAiRealtimeProvider.connect()', () => {
  it('opens the socket with the key and configures the session', async () => {
    await ready()
    expect(factoryArgs).toEqual({
      url: `wss://api.openai.com/v1/realtime?model=${DEFAULT_REALTIME_MODEL}`,
      headers: { Authorization: 'Bearer sk-test' },
    })
    const update = socket.sent[0] as {
      type: string
      session: Record<string, any>
    }
    expect(update.type).toBe('session.update')
    expect(update.session.instructions).toBe('Seja breve')
    expect(update.session.audio.input.format).toEqual({ type: 'audio/pcmu' })
    expect(update.session.audio.output).toEqual({
      format: { type: 'audio/pcmu' },
      voice: 'alloy',
    })
    expect(update.session.audio.input.transcription.language).toBe('pt')
    expect(update.session.tools).toEqual([
      {
        type: 'function',
        name: 'ping',
        description: 'Pinga',
        parameters: { type: 'object', properties: {} },
      },
    ])
  })

  it('uses the configured model', () => {
    const custom = new OpenAiRealtimeProvider({
      apiKey: 'k',
      model: 'gpt-realtime-mini',
      socketFactory: (url) => {
        factoryArgs = { url, headers: {} }
        return socket
      },
    })
    void custom.connect(CONFIG, events())
    expect(custom.model).toBe('gpt-realtime-mini')
    expect(factoryArgs?.url).toContain('model=gpt-realtime-mini')
  })

  it('rejects when the socket errors before the session is ready', async () => {
    const pending = provider().connect(CONFIG, events())
    socket.onerror?.({})
    await expect(pending).rejects.toThrow('Realtime socket error')
  })

  it('rejects when the socket closes before the session is ready', async () => {
    const pending = provider().connect(CONFIG, events())
    socket.onclose?.({})
    await expect(pending).rejects.toThrow('closed before')
  })

  it('rejects on a provider error before the session is ready', async () => {
    const pending = provider().connect(CONFIG, events())
    socket.receive({ type: 'error', error: { message: 'invalid key' } })
    await expect(pending).rejects.toThrow('invalid key')
  })

  it('rejects and closes when the session never becomes ready', async () => {
    vi.useFakeTimers()
    const pending = provider({ readyTimeoutMs: 100 }).connect(CONFIG, events())
    const assertion = expect(pending).rejects.toThrow('did not become ready')
    await vi.advanceTimersByTimeAsync(150)
    await assertion
    expect(socket.closed?.reason).toBe('timeout')
  })

  it('does not close the socket twice when the timer fires after ready', async () => {
    vi.useFakeTimers()
    const p = provider({ readyTimeoutMs: 100 })
    const pending = p.connect(CONFIG, events())
    socket.open()
    socket.receive({ type: 'session.updated' })
    await pending
    await vi.advanceTimersByTimeAsync(500)
    expect(socket.closed).toBeNull()
  })

  it('ignores unparseable frames and a second session.updated', async () => {
    const { handlers } = await ready()
    socket.receive('not json')
    socket.receive({ type: 'session.updated' })
    socket.receive({ type: 'something.else' })
    expect(handlers.onError).not.toHaveBeenCalled()
  })
})

describe('OpenAiRealtimeProvider events', () => {
  it('turns model audio into 8 kHz PCM', async () => {
    const { handlers } = await ready()
    const pcm = Buffer.alloc(4)
    pcm.writeInt16LE(1000, 0)
    pcm.writeInt16LE(-1000, 2)
    socket.receive({
      type: 'response.output_audio.delta',
      delta: pcm16ToMulaw(pcm).toString('base64'),
    })
    socket.receive({
      type: 'response.audio.delta',
      delta: pcm16ToMulaw(pcm).toString('base64'),
    })
    socket.receive({ type: 'response.output_audio.delta' })
    expect(handlers.onAudio).toHaveBeenCalledTimes(2)
    expect(handlers.onAudio.mock.calls[0][0]).toEqual(
      mulawToPcm16(pcm16ToMulaw(pcm)),
    )
  })

  it('forwards speech, transcripts, tool calls and usage', async () => {
    const { handlers } = await ready()
    socket.receive({ type: 'input_audio_buffer.speech_started' })
    socket.receive({ type: 'input_audio_buffer.speech_stopped' })
    socket.receive({
      type: 'conversation.item.input_audio_transcription.completed',
      transcript: 'oi',
    })
    socket.receive({
      type: 'conversation.item.input_audio_transcription.completed',
      transcript: '   ',
    })
    socket.receive({
      type: 'response.output_audio_transcript.done',
      transcript: 'Olá!',
    })
    socket.receive({
      type: 'response.audio_transcript.done',
      transcript: 'Tudo bem?',
    })
    socket.receive({
      type: 'response.audio_transcript.done',
      transcript: '',
    })
    socket.receive({
      type: 'response.function_call_arguments.done',
      call_id: 'c1',
      name: 'ping',
      arguments: '{"a":1}',
    })
    socket.receive({
      type: 'response.function_call_arguments.done',
      call_id: 'c2',
      name: 'ping',
      arguments: '[1]',
    })
    socket.receive({
      type: 'response.function_call_arguments.done',
      call_id: 'c3',
      name: 'ping',
      arguments: 'oops',
    })
    socket.receive({ type: 'response.function_call_arguments.done' })
    socket.receive({
      type: 'response.done',
      response: {
        usage: {
          input_token_details: {
            text_tokens: 10,
            audio_tokens: 20,
            cached_tokens: 5,
          },
          output_token_details: { text_tokens: 3, audio_tokens: 7 },
        },
      },
    })

    expect(handlers.onSpeechStarted).toHaveBeenCalledTimes(1)
    expect(handlers.onSpeechStopped).toHaveBeenCalledTimes(1)
    expect(handlers.onCallerTranscript).toHaveBeenCalledTimes(1)
    expect(handlers.onCallerTranscript).toHaveBeenCalledWith('oi')
    expect(handlers.onAssistantTranscript.mock.calls).toEqual([
      ['Olá!'],
      ['Tudo bem?'],
    ])
    expect(handlers.onToolCall.mock.calls.map((c) => c[0])).toEqual([
      { id: 'c1', name: 'ping', args: { a: 1 } },
      { id: 'c2', name: 'ping', args: {} },
      { id: 'c3', name: 'ping', args: {} },
      { id: '', name: '', args: {} },
    ])
    expect(handlers.onUsage).toHaveBeenCalledWith({
      inputAudioTokens: 20,
      inputTextTokens: 10,
      cachedInputTokens: 5,
      outputAudioTokens: 7,
      outputTextTokens: 3,
    })
    expect(handlers.onResponseDone).toHaveBeenCalledTimes(1)
  })

  it('reports provider errors after ready, except a harmless cancel', async () => {
    const { handlers } = await ready()
    socket.receive({
      type: 'error',
      error: { code: 'response_cancel_not_active', message: 'none active' },
    })
    expect(handlers.onError).not.toHaveBeenCalled()
    socket.receive({ type: 'error', error: { code: 'server_error' } })
    socket.receive({ type: 'error' })
    expect(handlers.onError).toHaveBeenCalledTimes(2)
    expect(handlers.onError.mock.calls[0][0].message).toBe('server_error')
    expect(handlers.onError.mock.calls[1][0].message).toBe('Realtime error')
  })

  it('reports a socket error and a close after ready', async () => {
    const { handlers } = await ready()
    socket.onerror?.({})
    socket.onclose?.({})
    expect(handlers.onError).toHaveBeenCalledTimes(1)
    expect(handlers.onClose).toHaveBeenCalledTimes(1)
  })
})

describe('OpenAiRealtimeProvider session', () => {
  it('sends caller audio as mu-law base64', async () => {
    const { session } = await ready()
    const pcm = Buffer.alloc(320)
    session.sendAudio(pcm)
    const sent = socket.sent.at(-1) as { type: string; audio: string }
    expect(sent.type).toBe('input_audio_buffer.append')
    expect(Buffer.from(sent.audio, 'base64').length).toBe(160)
  })

  it('asks the model to speak the notice word for word', async () => {
    const { session } = await ready()
    session.speak('Atendimento automatizado')
    const sent = socket.sent.at(-1) as {
      type: string
      response: { instructions: string }
    }
    expect(sent.type).toBe('response.create')
    expect(sent.response.instructions).toContain('"Atendimento automatizado"')
  })

  it('answers a tool call and lets the model continue', async () => {
    const { session } = await ready()
    session.sendToolResult('c1', '{"ok":true}')
    expect(socket.sent.slice(-2)).toEqual([
      {
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: 'c1',
          output: '{"ok":true}',
        },
      },
      { type: 'response.create' },
    ])
  })

  it('cancels the current response before a closing instruction', async () => {
    const { session } = await ready()
    session.respond('Despeça-se')
    expect(socket.sent.slice(-2)).toEqual([
      { type: 'response.cancel' },
      { type: 'response.create', response: { instructions: 'Despeça-se' } },
    ])
  })

  it('closes the socket once and ignores sends after it closed', async () => {
    const { session } = await ready()
    session.close()
    expect(socket.closed).toEqual({ code: 1000, reason: 'done' })
    const before = socket.sent.length
    session.sendAudio(Buffer.alloc(2))
    session.close()
    expect(socket.sent.length).toBe(before)
  })
})

describe('toVoiceUsage()', () => {
  it('defaults every counter to zero', () => {
    expect(toVoiceUsage(undefined)).toEqual({
      inputAudioTokens: 0,
      inputTextTokens: 0,
      cachedInputTokens: 0,
      outputAudioTokens: 0,
      outputTextTokens: 0,
    })
  })
})

describe('defaultSocketFactory()', () => {
  it('builds a global WebSocket with the request headers', () => {
    const created: { url: string; options: unknown }[] = []
    class FakeWebSocket {
      constructor(url: string, options: unknown) {
        created.push({ url, options })
      }
    }
    vi.stubGlobal('WebSocket', FakeWebSocket)
    try {
      defaultSocketFactory('wss://example.test/x', { A: 'b' })
    } finally {
      vi.unstubAllGlobals()
    }
    expect(created).toEqual([
      { url: 'wss://example.test/x', options: { headers: { A: 'b' } } },
    ])
  })
})
