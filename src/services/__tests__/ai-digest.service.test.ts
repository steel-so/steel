import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeAiDigestSetting } from '@/src/__tests__/factories/ai-insight.factory'
import { aiQuotaExceeded } from '@/src/errors'
import type { AiModelDefinition, AiProvider } from '@/src/lib/ai'
import { err, ok } from '@/src/lib/result'
import type { AiInsightDTO } from '@/types/ai-insight'

vi.mock('@/src/repositories/ai-proactive-signal.repository')
vi.mock('@/src/repositories/ai-digest-setting.repository')
vi.mock('@/src/lib/mail/steel-ai/send-ai-daily-digest', () => ({
  sendAiDailyDigestEmail: vi.fn(),
}))
vi.mock('../ai-insight.service', () => ({
  AiInsightService: { list: vi.fn() },
}))
vi.mock('../ai-usage.service', () => ({
  AiUsageService: { prepare: vi.fn(), record: vi.fn() },
}))
vi.mock('../notification.service', () => ({
  NotificationService: { notifyUsers: vi.fn() },
}))

import { sendAiDailyDigestEmail } from '@/src/lib/mail/steel-ai/send-ai-daily-digest'
import { AiDigestSettingRepository } from '@/src/repositories/ai-digest-setting.repository'
import { AiProactiveSignalRepository } from '@/src/repositories/ai-proactive-signal.repository'
import {
  AiDigestService,
  isDigestHour,
  phraseDigestIntro,
} from '../ai-digest.service'
import { AiInsightService } from '../ai-insight.service'
import { AiUsageService } from '../ai-usage.service'
import { NotificationService } from '../notification.service'

const signals = vi.mocked(AiProactiveSignalRepository)
const digestRepo = vi.mocked(AiDigestSettingRepository)
const list = vi.mocked(AiInsightService.list)
const prepare = vi.mocked(AiUsageService.prepare)
const record = vi.mocked(AiUsageService.record)
const notify = vi.mocked(NotificationService.notifyUsers)
const sendEmail = vi.mocked(sendAiDailyDigestEmail)

const DB_ERROR = { code: 'DATABASE_ERROR' as const, message: 'down' }
// 08:10 in São Paulo; 11:10 in UTC.
const NOW = new Date('2026-10-18T11:10:00.000Z')

const chat = vi.fn()
const provider = { id: 'openai', chat, chatStream: vi.fn() } as AiProvider
const model = {
  key: 'openai:gpt-4o-mini',
  provider: 'openai',
  model: 'gpt-4o-mini',
} as AiModelDefinition
const CALL = { feature: 'PROACTIVE_DIGEST' as const, provider, model }

function insight(overrides: Partial<AiInsightDTO> = {}): AiInsightDTO {
  return {
    id: 'i1',
    kind: 'SD_SLA_BREACH_FORECAST',
    module: 'SERVICE_DESK',
    severity: 'CRITICAL',
    title: 'A fila de N1 deve estourar o SLA às 10:00',
    body: '3 chamados com previsão de estouro até 11:30.',
    facts: [{ label: 'Chamados', value: '3' }],
    href: '/acme/servicedesk/risk',
    prompt: 'Quais chamados?',
    state: 'active',
    snoozedUntil: null,
    firstSeenAt: NOW.toISOString(),
    lastSeenAt: NOW.toISOString(),
    ...overrides,
  }
}

const CRM_INSIGHT = insight({
  id: 'i2',
  kind: 'CRM_STALE_OPPORTUNITIES',
  module: 'CRM',
  severity: 'INFO',
  title: '4 oportunidades suas sem contato há 10 dias ou mais',
  body: 'Somam R$ 1.000,00.',
  facts: [{ label: 'Oportunidades', value: '4' }],
  href: null,
})

function feed(items: AiInsightDTO[], enabled = true) {
  return ok({
    enabled,
    items,
    counts: { active: items.length, snoozed: 0, dismissed: 0 },
  })
}

function reply(text: string) {
  return {
    text,
    toolCalls: [],
    message: { role: 'assistant' as const, content: text },
    usage: { inputTokens: 100, outputTokens: 20 },
    stopReason: 'end' as const,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  signals.listWorkspaces.mockResolvedValue(
    ok([
      {
        id: 'ws1',
        slug: 'acme',
        name: 'Acme',
        aiEnabled: true,
        proactiveEnabled: true,
        modules: ['SERVICE_DESK', 'CRM'],
      },
    ]),
  )
  signals.listMembers.mockResolvedValue(
    ok([
      {
        userId: 'u1',
        name: 'Ana Souza',
        email: 'ana@x.com',
        timeZone: 'America/Sao_Paulo',
      },
    ]),
  )
  digestRepo.listByWorkspace.mockResolvedValue(ok([]))
  digestRepo.markSent.mockResolvedValue(ok(createFakeAiDigestSetting()))
  list.mockResolvedValue(feed([CRM_INSIGHT, insight()]))
  prepare.mockResolvedValue(ok(CALL))
  record.mockResolvedValue(undefined)
  chat.mockResolvedValue(
    reply('Comece pela fila de N1: 3 chamados devem estourar o SLA às 10:00.'),
  )
  notify.mockResolvedValue(ok(1))
  sendEmail.mockResolvedValue({ id: 'e1' } as never)
})

describe('isDigestHour', () => {
  it('opens at 08:00 and closes after a short window', () => {
    expect(isDigestHour(7)).toBe(false)
    expect(isDigestHour(8)).toBe(true)
    expect(isDigestHour(10)).toBe(true)
    expect(isDigestHour(11)).toBe(false)
  })
})

describe('phraseDigestIntro', () => {
  const items = [
    {
      module: 'SERVICE_DESK' as const,
      severity: 'CRITICAL' as const,
      title: 'A fila de N1 deve estourar o SLA às 10:00',
      body: '3 chamados.',
      facts: [{ label: 'Chamados', value: '3' }],
      href: null,
    },
  ]

  it('keeps a grounded LLM sentence and records the usage', async () => {
    const phrased = await phraseDigestIntro('ws1', 'u1', items)
    expect(phrased).toEqual({
      intro:
        'Comece pela fila de N1: 3 chamados devem estourar o SLA às 10:00.',
      source: 'llm',
    })
    expect(prepare).toHaveBeenCalledWith('ws1', 'PROACTIVE_DIGEST', 'u1')
    expect(chat).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gpt-4o-mini', maxTokens: 200 }),
    )
    expect(record).toHaveBeenCalledWith(CALL, {
      workspaceId: 'ws1',
      userId: 'u1',
      usage: { inputTokens: 100, outputTokens: 20 },
    })
  })

  it('throws away an intro with a number the data did not produce', async () => {
    chat.mockResolvedValue(reply('São 5 chamados estourando às 10:00.'))
    expect(await phraseDigestIntro('ws1', 'u1', items)).toEqual({
      intro:
        'Você tem 1 alerta hoje: 1 no ServiceDesk. O mais urgente: A fila de N1 deve estourar o SLA às 10:00.',
      source: 'rejected',
    })
  })

  it('falls back without provider or quota, on errors and on empty text', async () => {
    prepare.mockResolvedValue(err(aiQuotaExceeded(10, 10)))
    expect((await phraseDigestIntro('ws1', 'u1', items)).source).toBe(
      'fallback',
    )
    expect(chat).not.toHaveBeenCalled()

    prepare.mockResolvedValue(ok(CALL))
    chat.mockRejectedValue(new Error('timeout'))
    expect((await phraseDigestIntro('ws1', 'u1', items)).source).toBe(
      'fallback',
    )
    chat.mockRejectedValue('weird')
    expect((await phraseDigestIntro('ws1', 'u1', items)).source).toBe(
      'fallback',
    )

    chat.mockResolvedValue(reply('   '))
    expect((await phraseDigestIntro('ws1', 'u1', items)).source).toBe(
      'fallback',
    )
  })
})

describe('AiDigestService.runTick', () => {
  it('sends the in-app and e-mail digest once, most severe first', async () => {
    const result = await AiDigestService.runTick(NOW)

    expect(result).toMatchObject({
      workspaces: 1,
      due: 1,
      sent: 1,
      inApp: 1,
      email: 1,
      phrased: 1,
      errors: 0,
    })
    expect(list).toHaveBeenCalledWith(
      'u1',
      'ws1',
      { state: 'active', limit: 8 },
      NOW,
    )
    expect(notify).toHaveBeenCalledWith({
      workspaceId: 'ws1',
      userIds: ['u1'],
      kind: 'AI_DAILY_DIGEST',
      title: 'Resumo diário da IA',
      body: 'Comece pela fila de N1: 3 chamados devem estourar o SLA às 10:00.',
      href: '/acme/inbox?view=insights',
      dedupeKey: 'ai-digest:2026-10-18',
    })
    const email = sendEmail.mock.calls[0][0]
    expect(email).toMatchObject({
      email: 'ana@x.com',
      username: 'Ana',
      workspaceName: 'Acme',
    })
    expect(email.items.map((item) => item.severityLabel)).toEqual([
      'Urgente',
      'Informativo',
    ])
    expect(email.items[0].url).toMatch(/\/acme\/servicedesk\/risk$/)
    expect(email.items[1].url).toBeNull()
    expect(email.settingsUrl).toMatch(/\/acme\/settings\/notifications$/)
    expect(digestRepo.markSent).toHaveBeenCalledWith('ws1', 'u1', '2026-10-18')
  })

  it('skips empty days without marking them, and a disabled feed', async () => {
    list.mockResolvedValue(feed([]))
    expect(await AiDigestService.runTick(NOW)).toMatchObject({
      due: 1,
      empty: 1,
      sent: 0,
    })
    list.mockResolvedValue(feed([insight()], false))
    expect((await AiDigestService.runTick(NOW)).empty).toBe(1)
    expect(notify).not.toHaveBeenCalled()
    expect(sendEmail).not.toHaveBeenCalled()
    expect(digestRepo.markSent).not.toHaveBeenCalled()
  })

  it('respects the hour in the user zone, the day already sent and the opt-outs', async () => {
    signals.listMembers.mockResolvedValue(
      ok([
        // 11:10 UTC = 20:10 in Tokyo: not the digest hour.
        {
          userId: 'tokyo',
          name: 'T',
          email: 't@x.com',
          timeZone: 'Asia/Tokyo',
        },
        { userId: 'sent', name: 'S', email: 's@x.com', timeZone: null },
        { userId: 'off', name: 'O', email: 'o@x.com', timeZone: null },
        { userId: 'mail', name: '', email: 'm@x.com', timeZone: 'Bad/Zone' },
      ]),
    )
    digestRepo.listByWorkspace.mockResolvedValue(
      ok([
        createFakeAiDigestSetting({ userId: 'sent', lastSentOn: '2026-10-18' }),
        createFakeAiDigestSetting({
          userId: 'off',
          inApp: false,
          email: false,
        }),
        createFakeAiDigestSetting({ userId: 'mail', inApp: false }),
      ]),
    )

    const result = await AiDigestService.runTick(NOW)

    // `Bad/Zone` falls back to São Paulo (08:10): only "mail" is due.
    expect(result).toMatchObject({ due: 1, sent: 1, inApp: 0, email: 1 })
    expect(notify).not.toHaveBeenCalled()
    expect(sendEmail.mock.calls[0][0]).toMatchObject({
      email: 'm@x.com',
      username: undefined,
    })
  })

  it('skips workspaces with the proactive AI or Steel AI off', async () => {
    signals.listWorkspaces.mockResolvedValue(
      ok([
        {
          id: 'ws1',
          slug: 'acme',
          name: 'Acme',
          aiEnabled: true,
          proactiveEnabled: false,
          modules: [],
        },
        {
          id: 'ws2',
          slug: 'beta',
          name: 'Beta',
          aiEnabled: false,
          proactiveEnabled: true,
          modules: [],
        },
      ]),
    )
    expect((await AiDigestService.runTick(NOW)).workspaces).toBe(0)
    expect(signals.listMembers).not.toHaveBeenCalled()
  })

  it('counts delivery failures and still marks a partial delivery', async () => {
    notify.mockResolvedValue(err(DB_ERROR))
    expect(await AiDigestService.runTick(NOW)).toMatchObject({
      sent: 1,
      email: 1,
      errors: 1,
    })
    expect(digestRepo.markSent).toHaveBeenCalledTimes(1)

    sendEmail.mockRejectedValue(new Error('resend down'))
    expect(await AiDigestService.runTick(NOW)).toMatchObject({
      sent: 0,
      errors: 2,
    })
    sendEmail.mockRejectedValue('weird')
    expect((await AiDigestService.runTick(NOW)).errors).toBe(2)
    expect(digestRepo.markSent).toHaveBeenCalledTimes(1)

    notify.mockResolvedValue(ok(1))
    sendEmail.mockResolvedValue({ id: 'e1' } as never)
    digestRepo.markSent.mockResolvedValue(err(DB_ERROR))
    expect(await AiDigestService.runTick(NOW)).toMatchObject({
      sent: 1,
      errors: 1,
    })
  })

  it('counts rejected intros and read failures', async () => {
    chat.mockResolvedValue(reply('São 99 alertas.'))
    expect((await AiDigestService.runTick(NOW)).rejected).toBe(1)

    list.mockResolvedValue(err(DB_ERROR))
    expect((await AiDigestService.runTick(NOW)).errors).toBe(1)

    digestRepo.listByWorkspace.mockResolvedValue(err(DB_ERROR))
    expect((await AiDigestService.runTick(NOW)).errors).toBe(1)

    signals.listMembers.mockRejectedValue(new Error('boom'))
    expect((await AiDigestService.runTick(NOW)).errors).toBe(1)
    signals.listMembers.mockRejectedValue('boom')
    expect((await AiDigestService.runTick(NOW)).errors).toBe(1)

    signals.listWorkspaces.mockResolvedValue(err(DB_ERROR))
    expect((await AiDigestService.runTick(NOW)).errors).toBe(1)
  })
})
