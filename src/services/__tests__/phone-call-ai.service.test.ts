import type { WhatsAppPhoneCall } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeWorkspaceAiSettings } from '@/src/__tests__/factories/ai-settings.factory'
import { createFakeWhatsAppPhoneCall } from '@/src/__tests__/factories/whatsapp-phone-call.factory'
import { createFakeWhatsAppSettings } from '@/src/__tests__/factories/whatsapp-settings.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import {
  aiProviderUnavailable,
  aiQuotaExceeded,
  databaseError,
} from '@/src/errors'
import type { AiChatResponse, AiProvider } from '@/src/lib/ai'
import { err, ok } from '@/src/lib/result'
import type { PreparedAiCall } from '../ai-usage.service'

const mocks = vi.hoisted(() => ({
  getOpenAiClient: vi.fn(),
  transcribe: vi.fn(),
  getObject: vi.fn(),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('@/lib/axiom/logger', () => ({ logger: mocks.logger }))
vi.mock('@/src/lib/ai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/src/lib/ai')>()),
  getOpenAiClient: mocks.getOpenAiClient,
}))
vi.mock('@/src/lib/ai/transcription', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/src/lib/ai/transcription')>()),
  transcribeAudio: mocks.transcribe,
}))
vi.mock('@/src/lib/storage/s3', () => ({ getObject: mocks.getObject }))
vi.mock('@/src/lib/whatsapp/realtime', () => ({
  publishWhatsAppEvent: vi.fn(async () => undefined),
}))
vi.mock('@/src/repositories/ai-settings.repository')
vi.mock('@/src/repositories/phone-call-link.repository')
vi.mock('@/src/repositories/whatsapp-phone-call.repository')
vi.mock('@/src/repositories/whatsapp-settings.repository')
vi.mock('@/src/services/ai-usage.service')

import { publishWhatsAppEvent } from '@/src/lib/whatsapp/realtime'
import {
  AiUsageRepository,
  WorkspaceAiSettingsRepository,
} from '@/src/repositories/ai-settings.repository'
import { PhoneCallLinkRepository } from '@/src/repositories/phone-call-link.repository'
import { WhatsAppPhoneCallRepository } from '@/src/repositories/whatsapp-phone-call.repository'
import { WhatsAppSettingsRepository } from '@/src/repositories/whatsapp-settings.repository'
import { AiUsageService } from '../ai-usage.service'
import {
  MAX_NEXT_STEPS,
  PhoneCallAiService,
  parseCallSummary,
  SUMMARY_TRANSCRIPT_CHAR_BUDGET,
} from '../phone-call-ai.service'

const callRepo = vi.mocked(WhatsAppPhoneCallRepository)
const zapSettingsRepo = vi.mocked(WhatsAppSettingsRepository)
const aiSettingsRepo = vi.mocked(WorkspaceAiSettingsRepository)
const usageRepo = vi.mocked(AiUsageRepository)
const linkRepo = vi.mocked(PhoneCallLinkRepository)
const aiUsage = vi.mocked(AiUsageService)
const DB = databaseError('db down')

const SUMMARY = JSON.stringify({
  summary: 'Cliente pediu a segunda via do boleto.',
  sentiment: 'NEUTRAL',
  score: 0.1,
  nextSteps: ['Enviar a segunda via do boleto'],
})

function response(text: string): AiChatResponse {
  return {
    text,
    toolCalls: [],
    message: { role: 'assistant', content: text },
    usage: { inputTokens: 100, outputTokens: 20 },
    stopReason: 'end',
  }
}

function prepared(chat: AiProvider['chat']): PreparedAiCall {
  return {
    feature: 'PHONE_CALL_AI',
    provider: { id: 'openai', chat, chatStream: vi.fn() },
    model: {
      key: 'openai:gpt-4o-mini',
      provider: 'openai',
      model: 'gpt-4o-mini',
      label: 'GPT-4o mini',
    },
    costMargin: 2,
  }
}

function pendingCall(overrides: Partial<WhatsAppPhoneCall> = {}) {
  return createFakeWhatsAppPhoneCall({
    id: 'call1',
    workspaceId: 'ws1',
    conversationId: 'conv1',
    userId: 'u1',
    status: 'COMPLETED',
    destination: '11999998888',
    durationSeconds: 90,
    recordingKey: 'ws1/call1.mp3',
    recordingMimeType: 'audio/mpeg',
    aiStatus: 'PENDING',
    ...overrides,
  })
}

let chat: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
  const call = pendingCall()
  callRepo.findById.mockResolvedValue(ok(call))
  callRepo.update.mockImplementation(async (_id, data) =>
    ok({ ...call, ...(data as Partial<WhatsAppPhoneCall>) }),
  )
  zapSettingsRepo.findByWorkspace.mockResolvedValue(ok(null))
  aiSettingsRepo.findByWorkspace.mockResolvedValue(
    ok(createFakeWorkspaceAiSettings({ workspaceId: 'ws1' })),
  )
  mocks.getOpenAiClient.mockReturnValue({ audio: {} })
  chat = vi.fn(async () => response(SUMMARY))
  aiUsage.prepare.mockResolvedValue(ok(prepared(chat as never)))
  aiUsage.record.mockResolvedValue(undefined)
  usageRepo.record.mockResolvedValue(ok({} as never))
  mocks.getObject.mockResolvedValue(Buffer.from('audio'))
  mocks.transcribe.mockResolvedValue({
    text: 'Bom dia, preciso da segunda via do boleto.',
    durationSeconds: 120,
  })
  linkRepo.findTicketForConversation.mockResolvedValue(ok('t1'))
  linkRepo.findPersonByPhoneKey.mockResolvedValue(ok('p1'))
  linkRepo.findOpenOpportunityForPerson.mockResolvedValue(ok('o1'))
})

describe('PhoneCallAiService.process()', () => {
  it('transcribes, summarizes, links the records and publishes the call', async () => {
    const outcome = expectOk(await PhoneCallAiService.process('call1'))

    expect(outcome).toEqual({
      status: 'done',
      callId: 'call1',
      workspaceId: 'ws1',
      summarized: true,
      links: { sdTicketId: 't1', crmPersonId: 'p1', crmOpportunityId: 'o1' },
    })
    expect(callRepo.update).toHaveBeenNthCalledWith(1, 'call1', {
      aiStatus: 'PROCESSING',
    })
    expect(mocks.getObject).toHaveBeenCalledWith({
      bucket: 'phone-call-recordings',
      key: 'ws1/call1.mp3',
    })
    expect(mocks.transcribe).toHaveBeenCalledWith(
      { audio: {} },
      Buffer.from('audio'),
      'call.mp3',
      { language: 'pt', withDuration: true },
    )
    // Whisper is priced per minute: 2 min × US$ 0.006 × margin 2.
    expect(usageRepo.record).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'ws1',
        userId: 'u1',
        feature: 'PHONE_CALL_AI',
        provider: 'openai',
        model: 'whisper-1',
        costUsd: 0.024,
        module: 'COMMUNICATION',
      }),
    )
    expect(aiUsage.prepare).toHaveBeenCalledWith('ws1', 'PHONE_CALL_AI')
    expect(aiUsage.record).toHaveBeenCalledWith(
      expect.objectContaining({ feature: 'PHONE_CALL_AI' }),
      expect.objectContaining({
        workspaceId: 'ws1',
        userId: 'u1',
        scope: { module: 'COMMUNICATION' },
      }),
    )
    // The person is looked up by DDD + last 8 digits of the dialed number.
    expect(linkRepo.findPersonByPhoneKey).toHaveBeenCalledWith(
      'ws1',
      '1199998888',
    )
    expect(callRepo.update).toHaveBeenLastCalledWith(
      'call1',
      expect.objectContaining({
        aiStatus: 'DONE',
        aiSkipReason: null,
        transcript: 'Bom dia, preciso da segunda via do boleto.',
        summary: 'Cliente pediu a segunda via do boleto.',
        sentiment: 'NEUTRAL',
        sentimentScore: 0.1,
        nextSteps: ['Enviar a segunda via do boleto'],
        aiModel: 'openai:gpt-4o-mini',
        sdTicketId: 't1',
        crmPersonId: 'p1',
        crmOpportunityId: 'o1',
      }),
    )
    expect(publishWhatsAppEvent).toHaveBeenCalledWith('ws1', {
      type: 'phone-call.updated',
      call: expect.objectContaining({ id: 'call1', aiStatus: 'DONE' }),
    })
  })

  it('caps the transcript sent to the summary model', async () => {
    mocks.transcribe.mockResolvedValue({
      text: 'a'.repeat(SUMMARY_TRANSCRIPT_CHAR_BUDGET + 10),
      durationSeconds: null,
    })

    expectOk(await PhoneCallAiService.process('call1'))

    const request = chat.mock.calls[0][0]
    expect(request.messages[0].content).toHaveLength(
      SUMMARY_TRANSCRIPT_CHAR_BUDGET,
    )
    expect(request.jsonSchema.name).toBe('call_summary')
    // No duration from Whisper: the PABX talk time prices the minute.
    expect(usageRepo.record).toHaveBeenCalledWith(
      expect.objectContaining({ costUsd: 0.018 }),
    )
  })

  it('prices at cost without a margin and with no known duration', async () => {
    const plain = prepared(chat as never)
    delete plain.costMargin
    aiUsage.prepare.mockResolvedValue(ok(plain))
    callRepo.findById.mockResolvedValue(
      ok(pendingCall({ durationSeconds: null })),
    )
    mocks.transcribe.mockResolvedValue({ text: 'oi', durationSeconds: null })

    expectOk(await PhoneCallAiService.process('call1'))
    expect(usageRepo.record).toHaveBeenCalledWith(
      expect.objectContaining({ costUsd: 0 }),
    )

    usageRepo.record.mockClear()
    mocks.transcribe.mockResolvedValue({ text: 'oi', durationSeconds: 60 })
    expectOk(await PhoneCallAiService.process('call1'))
    expect(usageRepo.record).toHaveBeenCalledWith(
      expect.objectContaining({ costUsd: 0.006 }),
    )
  })

  it('keeps the transcript when the summary fails or is unparseable', async () => {
    chat.mockRejectedValueOnce(new Error('provider down'))
    const first = expectOk(await PhoneCallAiService.process('call1'))
    expect(first).toMatchObject({ status: 'done', summarized: false })
    expect(callRepo.update).toHaveBeenLastCalledWith(
      'call1',
      expect.objectContaining({
        aiStatus: 'DONE',
        aiSkipReason: 'summary_failed',
        summary: null,
        nextSteps: [],
        aiModel: null,
      }),
    )

    chat.mockResolvedValueOnce(response('não é json'))
    expect(expectOk(await PhoneCallAiService.process('call1'))).toMatchObject({
      summarized: false,
    })
    expect(mocks.logger.warn).toHaveBeenCalledWith(
      'phone_call.summary_unparseable',
      expect.anything(),
    )
  })

  it('loses only the link whose lookup failed', async () => {
    linkRepo.findTicketForConversation.mockResolvedValue(err(DB))
    linkRepo.findPersonByPhoneKey.mockResolvedValue(err(DB))

    const outcome = expectOk(await PhoneCallAiService.process('call1'))

    expect(outcome).toMatchObject({
      status: 'done',
      links: { sdTicketId: null, crmPersonId: null, crmOpportunityId: null },
    })
    expect(linkRepo.findOpenOpportunityForPerson).not.toHaveBeenCalled()
    expect(mocks.logger.warn).toHaveBeenCalledWith(
      'phone_call.link_lookup_failed',
      expect.objectContaining({ link: 'sd_ticket' }),
    )
  })

  it('does not look for a person when the number is not Brazilian', async () => {
    const call = pendingCall({ destination: '12025550123' + '99' })
    callRepo.findById.mockResolvedValue(ok(call))

    expectOk(await PhoneCallAiService.process('call1'))
    expect(linkRepo.findPersonByPhoneKey).not.toHaveBeenCalled()
  })

  it('logs and continues when the transcription usage cannot be recorded', async () => {
    usageRepo.record.mockResolvedValue(err(DB))

    expectOk(await PhoneCallAiService.process('call1'))
    expect(mocks.logger.error).toHaveBeenCalledWith(
      'phone_call.transcription_usage_failed',
      expect.anything(),
    )
  })

  it('marks the call FAILED when the transcription throws', async () => {
    mocks.transcribe.mockRejectedValue('whisper down')

    const outcome = expectOk(await PhoneCallAiService.process('call1'))

    expect(outcome).toEqual({
      status: 'failed',
      reason: 'transcription_failed',
      detail: 'whisper down',
    })
    expect(callRepo.update).toHaveBeenLastCalledWith('call1', {
      aiStatus: 'FAILED',
      aiSkipReason: 'transcription_failed',
    })
    expect(chat).not.toHaveBeenCalled()
  })

  it('skips an empty transcription after recording its cost', async () => {
    mocks.transcribe.mockResolvedValue(null)

    expect(expectOk(await PhoneCallAiService.process('call1'))).toEqual({
      status: 'skipped',
      reason: 'empty_transcript',
    })
    expect(usageRepo.record).toHaveBeenCalled()
    expect(chat).not.toHaveBeenCalled()
  })

  it.each([
    [
      'transcription_disabled',
      () =>
        zapSettingsRepo.findByWorkspace.mockResolvedValue(
          ok(createFakeWhatsAppSettings({ callTranscriptionEnabled: false })),
        ),
    ],
    [
      'ai_disabled',
      () =>
        aiSettingsRepo.findByWorkspace.mockResolvedValue(
          ok(createFakeWorkspaceAiSettings({ aiEnabled: false })),
        ),
    ],
    [
      'no_transcription_provider',
      () => mocks.getOpenAiClient.mockReturnValue(null),
    ],
    [
      'ai_quota_exceeded',
      () => aiUsage.prepare.mockResolvedValue(err(aiQuotaExceeded(10, 10))),
    ],
    [
      'ai_provider_unavailable',
      () => aiUsage.prepare.mockResolvedValue(err(aiProviderUnavailable())),
    ],
  ])('skips with %s', async (reason, arrange) => {
    arrange()

    expect(expectOk(await PhoneCallAiService.process('call1'))).toEqual({
      status: 'skipped',
      reason,
    })
    expect(callRepo.update).toHaveBeenCalledWith('call1', {
      aiStatus: 'SKIPPED',
      aiSkipReason: reason,
    })
    expect(mocks.transcribe).not.toHaveBeenCalled()
  })

  it('ignores a missing call and a call that is not pending', async () => {
    callRepo.findById.mockResolvedValueOnce(ok(null))
    expect(expectOk(await PhoneCallAiService.process('nope'))).toEqual({
      status: 'ignored',
      reason: 'call_not_found',
    })

    callRepo.findById.mockResolvedValueOnce(
      ok(pendingCall({ aiStatus: 'DONE' })),
    )
    expect(expectOk(await PhoneCallAiService.process('call1'))).toEqual({
      status: 'ignored',
      reason: 'not_pending',
    })
    expect(callRepo.update).not.toHaveBeenCalled()
  })

  it('retries a call left PROCESSING by a crash', async () => {
    callRepo.findById.mockResolvedValue(
      ok(pendingCall({ aiStatus: 'PROCESSING' })),
    )
    expect(expectOk(await PhoneCallAiService.process('call1')).status).toBe(
      'done',
    )
  })

  it('skips a pending call whose recording is gone', async () => {
    callRepo.findById.mockResolvedValue(ok(pendingCall({ recordingKey: null })))

    expect(expectOk(await PhoneCallAiService.process('call1'))).toEqual({
      status: 'skipped',
      reason: 'no_recording',
    })
  })

  it('lets a storage failure throw so the job retries', async () => {
    mocks.getObject.mockRejectedValue(new Error('s3 down'))
    await expect(PhoneCallAiService.process('call1')).rejects.toThrow('s3 down')
  })

  it('propagates database failures', async () => {
    callRepo.findById.mockResolvedValueOnce(err(DB))
    expectErr(await PhoneCallAiService.process('call1'), 'DATABASE_ERROR')

    zapSettingsRepo.findByWorkspace.mockResolvedValueOnce(err(DB))
    expectErr(await PhoneCallAiService.process('call1'), 'DATABASE_ERROR')

    aiSettingsRepo.findByWorkspace.mockResolvedValueOnce(err(DB))
    expectErr(await PhoneCallAiService.process('call1'), 'DATABASE_ERROR')

    // PROCESSING write fails.
    callRepo.update.mockResolvedValueOnce(err(DB))
    expectErr(await PhoneCallAiService.process('call1'), 'DATABASE_ERROR')
  })

  it('propagates a failure writing the final state', async () => {
    const call = pendingCall()
    callRepo.update
      .mockResolvedValueOnce(ok({ ...call, aiStatus: 'PROCESSING' }))
      .mockResolvedValueOnce(err(DB))
    expectErr(await PhoneCallAiService.process('call1'), 'DATABASE_ERROR')
  })

  it.each([
    ['skip', () => mocks.getOpenAiClient.mockReturnValue(null)],
    [
      'no recording',
      () =>
        callRepo.findById.mockResolvedValue(
          ok(pendingCall({ recordingKey: null })),
        ),
    ],
  ])('propagates a failure writing the %s state', async (_label, arrange) => {
    arrange()
    callRepo.update.mockResolvedValue(err(DB))
    expectErr(await PhoneCallAiService.process('call1'), 'DATABASE_ERROR')
  })

  it.each([
    ['FAILED', () => mocks.transcribe.mockRejectedValue(new Error('down'))],
    ['empty', () => mocks.transcribe.mockResolvedValue(null)],
  ])(
    'propagates a failure writing the %s state after processing',
    async (_label, arrange) => {
      arrange()
      const call = pendingCall()
      callRepo.update
        .mockResolvedValueOnce(ok({ ...call, aiStatus: 'PROCESSING' }))
        .mockResolvedValueOnce(err(DB))
      expectErr(await PhoneCallAiService.process('call1'), 'DATABASE_ERROR')
    },
  )
})

describe('parseCallSummary()', () => {
  it('clamps the score and cleans the next steps', () => {
    expect(
      parseCallSummary(
        JSON.stringify({
          summary: '  Resumo ',
          sentiment: 'NEGATIVE',
          score: -3,
          nextSteps: [
            ' Ligar de volta ',
            '',
            7,
            'x'.repeat(300),
            'a',
            'b',
            'c',
            'd',
          ],
        }),
      ),
    ).toEqual({
      summary: 'Resumo',
      sentiment: 'NEGATIVE',
      score: -1,
      nextSteps: ['Ligar de volta', 'x'.repeat(200), 'a', 'b', 'c'].slice(
        0,
        MAX_NEXT_STEPS,
      ),
    })
  })

  it.each([
    ['not json', 'oi'],
    [
      'no summary',
      JSON.stringify({
        summary: ' ',
        sentiment: 'NEUTRAL',
        score: 0,
        nextSteps: [],
      }),
    ],
    [
      'bad sentiment',
      JSON.stringify({
        summary: 's',
        sentiment: 'HAPPY',
        score: 0,
        nextSteps: [],
      }),
    ],
    [
      'bad score',
      JSON.stringify({
        summary: 's',
        sentiment: 'NEUTRAL',
        score: '1',
        nextSteps: [],
      }),
    ],
    [
      'bad steps',
      JSON.stringify({
        summary: 's',
        sentiment: 'NEUTRAL',
        score: 0,
        nextSteps: 'x',
      }),
    ],
    ['null', 'null'],
  ])('returns null for %s', (_label, content) => {
    expect(parseCallSummary(content)).toBeNull()
  })
})
