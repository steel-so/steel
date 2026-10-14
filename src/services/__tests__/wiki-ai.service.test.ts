import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import { createFakeWikiPage } from '@/src/__tests__/factories/wiki-page.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { aiQuotaExceeded, databaseError } from '@/src/errors'
import { aiDisabled } from '@/src/errors/app-error'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/wiki-page.repository')
vi.mock('@/src/repositories/wiki-settings.repository', () => ({
  WikiSettingsRepository: {
    isEnabled: vi.fn(async () => ({ ok: true, value: true })),
  },
}))
vi.mock('@/src/services/ai-usage.service')
vi.mock('@/src/services/ai-conversation.service', () => ({
  assertSteelAiEnabled: vi.fn(),
}))

import { logger } from '@/lib/axiom/logger'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { WikiPageRepository } from '@/src/repositories/wiki-page.repository'
import { assertSteelAiEnabled } from '@/src/services/ai-conversation.service'
import { AiUsageService } from '@/src/services/ai-usage.service'
import {
  buildWikiAiSystem,
  fitWikiAiText,
  WikiAiService,
} from '../wiki-ai.service'

const membership = vi.mocked(MembershipRepository)
const pages = vi.mocked(WikiPageRepository)
const ai = vi.mocked(AiUsageService)
const steelAi = vi.mocked(assertSteelAiEnabled)

const WS = 'ws1'

function chat(text: string) {
  return {
    text,
    toolCalls: [],
    message: { role: 'assistant' as const, content: text },
    usage: { inputTokens: 100, outputTokens: 40 },
    stopReason: 'end' as const,
  }
}

const provider = { id: 'openai' as const, chat: vi.fn() }

beforeEach(() => {
  vi.clearAllMocks()
  membership.findByUserAndWorkspace.mockResolvedValue(
    ok(createFakeMembership({ role: 'MEMBER' })),
  )
  pages.findById.mockResolvedValue(
    ok(createFakeWikiPage({ id: 'w1', workspaceId: WS })),
  )
  steelAi.mockResolvedValue(ok(null))
  ai.prepare.mockResolvedValue(
    ok({
      feature: 'WIKI_ASSISTANT',
      provider: provider as never,
      model: {
        key: 'openai:gpt',
        provider: 'openai',
        model: 'gpt-x',
        label: 'GPT',
      } as never,
    }),
  )
  ai.record.mockResolvedValue(undefined)
  provider.chat.mockResolvedValue(chat('Texto reescrito.'))
})

describe('buildWikiAiSystem()', () => {
  it('asks for the action, the input language and no invented facts', () => {
    const system = buildWikiAiSystem('paraphrase', 'oi')
    expect(system).toContain('Reescreva o texto com outras palavras')
    expect(system).toContain('mesmo idioma do texto')
    expect(system).toContain('Nunca invente fatos')
  })

  it('summarizes long inputs as bullets and short ones as a paragraph', () => {
    expect(buildWikiAiSystem('summarize', 'x'.repeat(5000))).toContain(
      'tópicos',
    )
    expect(buildWikiAiSystem('summarize', 'curto')).toContain('um parágrafo')
  })

  it('covers every action', () => {
    expect(buildWikiAiSystem('simplify', 'x')).toContain('Simplifique')
    expect(buildWikiAiSystem('elaborate', 'x')).toContain('Desenvolva')
    expect(buildWikiAiSystem('title', 'x')).toContain('UM título curto')
  })
})

describe('fitWikiAiText()', () => {
  it('strips wrapping quotes', () => {
    expect(fitWikiAiText('paraphrase', ' "Olá mundo" ')).toBe('Olá mundo')
  })

  it('keeps a title to one clean line', () => {
    expect(fitWikiAiText('title', '\n# “Guia de férias”.\nOutra linha')).toBe(
      'Guia de férias',
    )
    expect(fitWikiAiText('title', 'x'.repeat(300))).toHaveLength(120)
  })

  it('returns null for empty output', () => {
    expect(fitWikiAiText('summarize', '   ')).toBeNull()
    expect(fitWikiAiText('title', '\n\n')).toBeNull()
  })
})

describe('WikiAiService.rewrite()', () => {
  it('rewrites the text and records the usage as WIKI_ASSISTANT', async () => {
    const result = await WikiAiService.rewrite('u1', WS, 'w1', {
      action: 'simplify',
      text: 'Texto difícil.',
    })

    expect(expectOk(result)).toEqual({ text: 'Texto reescrito.' })
    expect(ai.prepare).toHaveBeenCalledWith(WS, 'WIKI_ASSISTANT', 'u1')
    expect(provider.chat).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gpt-x',
        messages: [{ role: 'user', content: 'Texto difícil.' }],
        maxTokens: 4000,
      }),
    )
    expect(ai.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ workspaceId: WS, userId: 'u1' }),
    )
  })

  it('rejects a non-member before anything else', async () => {
    membership.findByUserAndWorkspace.mockResolvedValue(ok(null))

    expectErr(
      await WikiAiService.rewrite('x', WS, 'w1', {
        action: 'title',
        text: 'a',
      }),
      'FORBIDDEN',
    )
    expect(ai.prepare).not.toHaveBeenCalled()
  })

  it('rejects a page of another workspace', async () => {
    pages.findById.mockResolvedValue(
      ok(createFakeWikiPage({ id: 'w1', workspaceId: 'other' })),
    )

    expectErr(
      await WikiAiService.rewrite('u1', WS, 'w1', {
        action: 'title',
        text: 'a',
      }),
      'WIKI_PAGE_FORBIDDEN',
    )
  })

  it('propagates the page lookup error', async () => {
    pages.findById.mockResolvedValue(err(databaseError()))

    expectErr(
      await WikiAiService.rewrite('u1', WS, 'w1', {
        action: 'title',
        text: 'a',
      }),
      'DATABASE_ERROR',
    )
  })

  it('honors the Steel AI master switch', async () => {
    steelAi.mockResolvedValue(err(aiDisabled()))

    expectErr(
      await WikiAiService.rewrite('u1', WS, 'w1', {
        action: 'title',
        text: 'a',
      }),
      'AI_DISABLED',
    )
    expect(ai.prepare).not.toHaveBeenCalled()
  })

  it('returns the quota error from prepare', async () => {
    ai.prepare.mockResolvedValue(err(aiQuotaExceeded(10, 10)))

    expectErr(
      await WikiAiService.rewrite('u1', WS, 'w1', {
        action: 'title',
        text: 'a',
      }),
      'AI_QUOTA_EXCEEDED',
    )
    expect(provider.chat).not.toHaveBeenCalled()
  })

  it('maps a provider failure to WIKI_AI_FAILED', async () => {
    const error = vi.spyOn(logger, 'error')
    provider.chat.mockRejectedValue(new Error('timeout'))

    expectErr(
      await WikiAiService.rewrite('u1', WS, 'w1', {
        action: 'elaborate',
        text: 'a',
      }),
      'WIKI_AI_FAILED',
    )
    expect(error).toHaveBeenCalledWith(
      'wiki_ai.provider_failed',
      expect.objectContaining({ message: 'timeout' }),
    )
  })

  it('logs a non-Error provider failure too', async () => {
    const error = vi.spyOn(logger, 'error')
    provider.chat.mockRejectedValue('boom')

    expectErr(
      await WikiAiService.rewrite('u1', WS, 'w1', {
        action: 'elaborate',
        text: 'a',
      }),
      'WIKI_AI_FAILED',
    )
    expect(error).toHaveBeenCalledWith(
      'wiki_ai.provider_failed',
      expect.objectContaining({ message: 'boom' }),
    )
  })

  it('maps an empty answer to WIKI_AI_FAILED', async () => {
    provider.chat.mockResolvedValue(chat('  '))

    expectErr(
      await WikiAiService.rewrite('u1', WS, 'w1', {
        action: 'summarize',
        text: 'a',
      }),
      'WIKI_AI_FAILED',
    )
  })
})
