import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeWhatsAppPhoneCall } from '@/src/__tests__/factories/whatsapp-phone-call.factory'
import { databaseError } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

const env = vi.hoisted(() => ({
  key: 'sk-test' as string | undefined,
  model: undefined as string | undefined,
}))

const mocks = vi.hoisted(() => ({
  claim: vi.fn(),
  complete: vi.fn(),
  fail: vi.fn(),
  createTools: vi.fn(),
  run: vi.fn(),
  bridgeOptions: [] as unknown[],
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('@/lib/env/server', () => ({
  get OPENAI_API_KEY() {
    return env.key
  },
  get VOICE_AGENT_REALTIME_MODEL() {
    return env.model
  },
}))
vi.mock('@/lib/axiom/logger', () => ({ logger: mocks.logger }))
vi.mock('../voice-agent.service', () => ({
  VoiceAgentService: {
    claim: mocks.claim,
    complete: mocks.complete,
    fail: mocks.fail,
  },
}))
vi.mock('@/src/lib/voice-agent/tools', () => ({
  createVoiceTools: mocks.createTools,
}))
vi.mock('@/src/lib/voice-agent/bridge', () => ({
  VoiceCallBridge: class {
    constructor(options: unknown) {
      mocks.bridgeOptions.push(options)
    }
    run() {
      return mocks.run()
    }
  },
}))

import type { RealtimeVoiceProvider } from '@/src/lib/voice-agent/provider'
import { VoiceAgentSessionService } from '../voice-agent-session.service'

const SESSION = '0b6f6f4e-7a1d-4a58-9a3e-6b5b2f7a9c11'

function channel() {
  return {
    onAudio: vi.fn(),
    onClosed: vi.fn(),
    sendAudio: vi.fn(),
    hangup: vi.fn(),
  }
}

const provider: RealtimeVoiceProvider = {
  name: 'fake',
  model: 'fake-realtime',
  connect: vi.fn(),
}

function context(overrides: Record<string, unknown> = {}) {
  return {
    call: createFakeWhatsAppPhoneCall({
      id: 'call1',
      workspaceId: 'ws1',
      destination: '5511999998888',
    }),
    settings: {
      runAsUserId: 'user1',
      canOpenTickets: true,
      canLookupTickets: true,
      instructions: 'Seja breve',
      voice: 'ash',
      silenceTimeoutSeconds: 15,
    },
    workspaceName: 'Stratus',
    notice: 'Aviso',
    transferTarget: '200',
    maxCallSeconds: 120,
    ...overrides,
  }
}

const result = {
  endReason: 'caller_hangup',
  transfer: null,
  transcript: '',
  durationMs: 1000,
  usage: {},
  noticeDelivered: true,
  latenciesMs: [800, 1200, 600, 1000],
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.bridgeOptions.length = 0
  env.key = 'sk-test'
  env.model = undefined
  mocks.claim.mockResolvedValue(ok(context()))
  mocks.complete.mockResolvedValue(ok({}))
  mocks.createTools.mockResolvedValue({
    definitions: [{ name: 'open_ticket' }, { name: 'ticket_status' }],
    executor: { execute: vi.fn() },
    state: { ticket: null },
  })
  mocks.run.mockResolvedValue(result)
})

describe('VoiceAgentSessionService.handle()', () => {
  it('runs the bridge, stores the outcome and only then hangs up', async () => {
    const phone = channel()
    const order: string[] = []
    mocks.complete.mockImplementation(async () => {
      order.push('complete')
      return ok({})
    })
    phone.hangup.mockImplementation(() => order.push('hangup'))

    await VoiceAgentSessionService.handle(SESSION, phone, {
      createProvider: () => provider,
    })

    expect(order).toEqual(['complete', 'hangup'])
    expect(mocks.claim).toHaveBeenCalledWith(SESSION)
    expect(mocks.createTools).toHaveBeenCalledWith({
      workspaceId: 'ws1',
      runAsUserId: 'user1',
      callId: 'call1',
      callerNumber: '5511999998888',
      canOpenTickets: true,
      canLookupTickets: true,
      transferTarget: '200',
    })
    const options = mocks.bridgeOptions[0] as Record<string, any>
    expect(options).toMatchObject({
      channel: phone,
      provider,
      notice: 'Aviso',
      maxCallMs: 120_000,
      silenceMs: 15_000,
      fallbackTarget: '200',
    })
    expect(options.config.voice).toBe('ash')
    expect(options.config.language).toBe('pt')
    expect(options.config.instructions).toContain('Stratus')
    expect(options.config.instructions).toContain('Seja breve')
    expect(mocks.complete).toHaveBeenCalledWith(
      expect.objectContaining({ call: expect.anything() }),
      result,
      { ticket: null },
      'fake-realtime',
    )
  })

  it('logs the latency of the call for the acceptance step', async () => {
    await VoiceAgentSessionService.handle(SESSION, channel(), {
      createProvider: () => provider,
    })
    expect(mocks.logger.info).toHaveBeenCalledWith(
      'voice_agent.session_ended',
      expect.objectContaining({
        latencyTurns: 4,
        latencyP50Ms: 800,
        latencyP95Ms: 1200,
        latencyMaxMs: 1200,
      }),
    )
  })

  it('tells the prompt which tools the identity may really use', async () => {
    mocks.createTools.mockResolvedValue({
      definitions: [],
      executor: { execute: vi.fn() },
      state: {},
    })
    mocks.claim.mockResolvedValue(ok(context({ transferTarget: null })))
    await VoiceAgentSessionService.handle(SESSION, channel(), {
      createProvider: () => provider,
    })
    const text = (mocks.bridgeOptions[0] as any).config.instructions as string
    expect(text).not.toContain('open_ticket')
    expect(text).not.toContain('ticket_status com')
    expect(text).toContain('não há atendente disponível')
  })

  it.each([
    ['an unknown or used session', ok(null)],
    ['a database failure', err(databaseError('down'))],
  ])('hangs up on %s without running anything', async (_name, claimed) => {
    mocks.claim.mockResolvedValue(claimed)
    const phone = channel()
    await VoiceAgentSessionService.handle(SESSION, phone)
    expect(phone.hangup).toHaveBeenCalledTimes(1)
    expect(mocks.run).not.toHaveBeenCalled()
    expect(mocks.logger.warn).toHaveBeenCalledWith(
      'voice_agent.session_rejected',
      expect.any(Object),
    )
  })

  it('closes the call as failed when there is no provider key', async () => {
    env.key = undefined
    const phone = channel()
    await VoiceAgentSessionService.handle(SESSION, phone)
    expect(mocks.fail).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'call1' }),
      'provider_unavailable',
    )
    expect(phone.hangup).toHaveBeenCalledTimes(1)
    expect(mocks.run).not.toHaveBeenCalled()
  })

  it('builds the default provider from the environment', async () => {
    env.model = 'gpt-realtime-mini'
    await VoiceAgentSessionService.handle(SESSION, channel())
    expect((mocks.bridgeOptions[0] as any).provider.model).toBe(
      'gpt-realtime-mini',
    )
    env.model = undefined
    await VoiceAgentSessionService.handle(SESSION, channel())
    expect((mocks.bridgeOptions[1] as any).provider.model).toBe('gpt-realtime')
  })

  it('closes the call and hangs up when the session crashes', async () => {
    mocks.run.mockRejectedValue(new Error('boom'))
    const phone = channel()
    await VoiceAgentSessionService.handle(SESSION, phone, {
      createProvider: () => provider,
    })
    expect(mocks.fail).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'call1' }),
      'session_crashed',
    )
    expect(phone.hangup).toHaveBeenCalledTimes(1)
    expect(mocks.logger.error).toHaveBeenCalledWith(
      'voice_agent.session_crashed',
      expect.objectContaining({ message: 'boom' }),
    )
  })

  it('survives a crash that is not an Error and one before the claim', async () => {
    mocks.run.mockRejectedValue('plain')
    await VoiceAgentSessionService.handle(SESSION, channel(), {
      createProvider: () => provider,
    })
    expect(mocks.logger.error).toHaveBeenCalledWith(
      'voice_agent.session_crashed',
      expect.objectContaining({ message: 'plain' }),
    )

    mocks.claim.mockRejectedValue(new Error('claim blew up'))
    const phone = channel()
    await VoiceAgentSessionService.handle(SESSION, phone)
    expect(phone.hangup).toHaveBeenCalledTimes(1)
  })

  it('still hangs up when the outcome could not be stored', async () => {
    mocks.complete.mockResolvedValue(err(databaseError('down')))
    const phone = channel()
    await VoiceAgentSessionService.handle(SESSION, phone, {
      createProvider: () => provider,
    })
    expect(phone.hangup).toHaveBeenCalledTimes(1)
    expect(mocks.logger.info).toHaveBeenCalledWith(
      'voice_agent.session_ended',
      expect.objectContaining({ stored: false }),
    )
  })
})
