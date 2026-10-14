import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { aiQuotaExceeded, featureNotEnabled } from '@/src/errors'
import { err, ok } from '@/src/lib/result'
import {
  type CrmTextAiAssistDTO,
  CrmTextAiAssistSchema,
} from '@/src/schemas/crm-text-ai.schema'

vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/services/ai-usage.service')
vi.mock('@/src/services/feature-flag.service')

import { logger } from '@/lib/axiom/logger'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { AiUsageService } from '@/src/services/ai-usage.service'
import { assertFeature } from '@/src/services/feature-flag.service'
import { buildTextAiSystem, CrmTextAiService } from '../crm-text-ai.service'

const membership = vi.mocked(MembershipRepository)
const ai = vi.mocked(AiUsageService)
const feature = vi.mocked(assertFeature)

const WS = 'ws1'
const ACTOR = 'u1'

function chat(text: string) {
  return {
    text,
    toolCalls: [],
    message: { role: 'assistant' as const, content: text },
    usage: { inputTokens: 200, outputTokens: 80 },
    stopReason: 'end' as const,
  }
}

const provider = { id: 'anthropic' as const, chat: vi.fn() }

function dto(overrides: Partial<CrmTextAiAssistDTO> = {}): CrmTextAiAssistDTO {
  return CrmTextAiAssistSchema.parse({
    surface: 'LANDING_PAGE',
    text: 'Internet rápida pra sua empresa',
    messages: [{ role: 'user', content: 'Deixe mais persuasivo' }],
    field: { label: 'Título principal', maxLength: 60 },
    context: { title: 'Fibra empresarial', section: 'Destaque' },
    ...overrides,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  membership.findByUserAndWorkspace.mockResolvedValue(
    ok(createFakeMembership({ role: 'MEMBER' })),
  )
  feature.mockResolvedValue(ok(true))
  ai.prepare.mockResolvedValue(
    ok({
      feature: 'CRM_ASSISTANT',
      provider: provider as never,
      model: {
        key: 'anthropic:claude',
        provider: 'anthropic',
        model: 'claude-x',
        label: 'Claude',
      } as never,
    }),
  )
  ai.record.mockResolvedValue(undefined)
  provider.chat.mockResolvedValue(
    chat(
      JSON.stringify({
        reply: 'Foquei no benefício principal.',
        suggestion: 'Fibra que não para a sua empresa',
      }),
    ),
  )
})

describe('buildTextAiSystem()', () => {
  it('describes the field, the page and the current text', () => {
    const system = buildTextAiSystem(dto())
    expect(system).toContain('uma linha só')
    expect(system).toContain('no máximo 60 caracteres')
    expect(system).toContain('Campo: Título principal.')
    expect(system).toContain('Seção: Destaque.')
    expect(system).toContain('Título: Fibra empresarial.')
    expect(system).toContain('Internet rápida pra sua empresa')
  })

  it('asks to write from scratch when the field is empty', () => {
    const system = buildTextAiSystem(
      dto({ text: '', field: { multiline: true }, context: {} }),
    )
    expect(system).toContain('O campo está vazio')
    expect(system).toContain('várias linhas')
    expect(system).not.toContain('Campo:')
    expect(system).not.toContain('no máximo')
  })
})

describe('buildTextAiSystem() per surface', () => {
  it('writes proposals as a B2B document without inventing terms', () => {
    const system = buildTextAiSystem(dto({ surface: 'DOCUMENT' }))
    expect(system).toContain('propostas comerciais B2B')
    expect(system).toContain('Não invente valores')
  })

  it('writes social copy for the given network', () => {
    const system = buildTextAiSystem(
      dto({ surface: 'SOCIAL', context: { platform: 'Instagram · Reels' } }),
    )
    expect(system).toContain('social media')
    expect(system).toContain('Rede social: Instagram · Reels.')
  })
})

describe('CrmTextAiService.assist()', () => {
  it.each([
    ['LANDING_PAGE', 'landing-pages', 'EDIT'],
    ['DOCUMENT', 'documents', 'EDIT'],
    ['SOCIAL', 'social', 'CREATE'],
  ] as const)(
    'requires the %s permission',
    async (surface, resource, action) => {
      membership.findByUserAndWorkspace.mockResolvedValue(
        ok(createFakeMembership({ role: 'MEMBER' })),
      )
      const authz = await import('@/src/services/authz')
      const spy = vi.spyOn(authz, 'assertModuleMember')
      await CrmTextAiService.assist(ACTOR, WS, dto({ surface }))
      expect(spy).toHaveBeenCalledWith(ACTOR, WS, 'CRM', { resource, action })
      spy.mockRestore()
    },
  )

  it('returns FORBIDDEN for a non-member', async () => {
    membership.findByUserAndWorkspace.mockResolvedValue(ok(null))
    expectErr(await CrmTextAiService.assist(ACTOR, WS, dto()), 'FORBIDDEN')
    expect(ai.prepare).not.toHaveBeenCalled()
  })

  it('respects the plan feature gate', async () => {
    feature.mockResolvedValue(err(featureNotEnabled()))
    expectErr(
      await CrmTextAiService.assist(ACTOR, WS, dto()),
      'FEATURE_NOT_ENABLED',
    )
    expect(feature).toHaveBeenCalledWith(WS, 'crm.aiAssistant')
    expect(provider.chat).not.toHaveBeenCalled()
  })

  it('propagates the AI quota error', async () => {
    ai.prepare.mockResolvedValue(err(aiQuotaExceeded(50, 50)))
    expectErr(
      await CrmTextAiService.assist(ACTOR, WS, dto()),
      'AI_QUOTA_EXCEEDED',
    )
    expect(provider.chat).not.toHaveBeenCalled()
  })

  it('answers with a suggestion and records the usage under CRM', async () => {
    const reply = expectOk(await CrmTextAiService.assist(ACTOR, WS, dto()))
    expect(reply).toEqual({
      reply: 'Foquei no benefício principal.',
      suggestion: 'Fibra que não para a sua empresa',
    })
    expect(ai.prepare).toHaveBeenCalledWith(WS, 'CRM_ASSISTANT', ACTOR)
    expect(ai.record).toHaveBeenCalledWith(expect.anything(), {
      workspaceId: WS,
      userId: ACTOR,
      usage: { inputTokens: 200, outputTokens: 80 },
      scope: { module: 'CRM' },
    })
    const request = provider.chat.mock.calls[0][0]
    expect(request.model).toBe('claude-x')
    expect(request.jsonSchema.name).toBe('crm_field_copy')
    expect(request.messages).toEqual([
      { role: 'user', content: 'Deixe mais persuasivo' },
    ])
  })

  it('passes the chat history through in order', async () => {
    await CrmTextAiService.assist(
      ACTOR,
      WS,
      dto({
        messages: [
          { role: 'user', content: 'Melhore' },
          { role: 'assistant', content: 'Que tal assim?' },
          { role: 'user', content: 'Mais curto' },
        ],
      }),
    )
    expect(provider.chat.mock.calls[0][0].messages).toEqual([
      { role: 'user', content: 'Melhore' },
      { role: 'assistant', content: 'Que tal assim?' },
      { role: 'user', content: 'Mais curto' },
    ])
  })

  it('keeps a single-line suggestion on one line, unquoted and capped', async () => {
    provider.chat.mockResolvedValue(
      chat(
        JSON.stringify({
          reply: 'Pronto.',
          suggestion: `"Primeira linha\nsegunda linha ${'x'.repeat(80)}"`,
        }),
      ),
    )
    const reply = expectOk(await CrmTextAiService.assist(ACTOR, WS, dto()))
    expect(reply.suggestion).not.toContain('\n')
    expect(reply.suggestion?.startsWith('Primeira linha segunda')).toBe(true)
    expect(reply.suggestion?.length).toBeLessThanOrEqual(60)
    expect(reply.suggestion?.startsWith('"')).toBe(false)
  })

  it('keeps line breaks in a multi-line field', async () => {
    provider.chat.mockResolvedValue(
      chat(JSON.stringify({ reply: 'Ok', suggestion: 'Linha 1\nLinha 2' })),
    )
    const reply = expectOk(
      await CrmTextAiService.assist(
        ACTOR,
        WS,
        dto({ field: { multiline: true } }),
      ),
    )
    expect(reply.suggestion).toBe('Linha 1\nLinha 2')
  })

  it('returns a null suggestion when the AI only talked', async () => {
    provider.chat.mockResolvedValue(
      chat(
        JSON.stringify({
          reply: 'Títulos curtos convertem mais.',
          suggestion: '',
        }),
      ),
    )
    const reply = expectOk(await CrmTextAiService.assist(ACTOR, WS, dto()))
    expect(reply).toEqual({
      reply: 'Títulos curtos convertem mais.',
      suggestion: null,
    })
  })

  it('fills a default reply when only a suggestion came back', async () => {
    provider.chat.mockResolvedValue(
      chat(JSON.stringify({ reply: ' ', suggestion: 'Novo texto' })),
    )
    const reply = expectOk(await CrmTextAiService.assist(ACTOR, WS, dto()))
    expect(reply.reply).toBe('Aqui está uma sugestão:')
  })

  it('fails with CRM_TEXT_AI_FAILED on invalid output', async () => {
    const warn = vi.spyOn(logger, 'warn')
    provider.chat.mockResolvedValue(chat('not json'))
    expectErr(
      await CrmTextAiService.assist(ACTOR, WS, dto()),
      'CRM_TEXT_AI_FAILED',
    )
    expect(warn).toHaveBeenCalledWith(
      'crm_text_ai.invalid_output',
      expect.anything(),
    )
  })

  it('fails with CRM_TEXT_AI_FAILED on an empty answer', async () => {
    provider.chat.mockResolvedValue(
      chat(JSON.stringify({ reply: '', suggestion: '' })),
    )
    expectErr(
      await CrmTextAiService.assist(ACTOR, WS, dto()),
      'CRM_TEXT_AI_FAILED',
    )
  })

  it('fails with CRM_TEXT_AI_FAILED when the provider throws', async () => {
    const error = vi.spyOn(logger, 'error')
    provider.chat.mockRejectedValue(new Error('boom'))
    expectErr(
      await CrmTextAiService.assist(ACTOR, WS, dto()),
      'CRM_TEXT_AI_FAILED',
    )
    expect(ai.record).not.toHaveBeenCalled()
    expect(error).toHaveBeenCalledWith(
      'crm_text_ai.provider_failed',
      expect.objectContaining({ message: 'boom' }),
    )
  })

  it('logs a non-Error provider failure as a string', async () => {
    const error = vi.spyOn(logger, 'error')
    provider.chat.mockRejectedValue('offline')
    expectErr(
      await CrmTextAiService.assist(ACTOR, WS, dto()),
      'CRM_TEXT_AI_FAILED',
    )
    expect(error).toHaveBeenCalledWith(
      'crm_text_ai.provider_failed',
      expect.objectContaining({ message: 'offline' }),
    )
  })
})

describe('CrmTextAiAssistSchema', () => {
  it('requires the last turn to come from the user', () => {
    const parsed = CrmTextAiAssistSchema.safeParse({
      surface: 'SOCIAL',
      messages: [{ role: 'assistant', content: 'Oi' }],
    })
    expect(parsed.success).toBe(false)
  })

  it('rejects an empty conversation', () => {
    expect(
      CrmTextAiAssistSchema.safeParse({ surface: 'SOCIAL', messages: [] })
        .success,
    ).toBe(false)
  })

  it('defaults the text, field and page', () => {
    const parsed = CrmTextAiAssistSchema.parse({
      surface: 'DOCUMENT',
      messages: [{ role: 'user', content: 'Escreva um título' }],
    })
    expect(parsed).toMatchObject({
      text: '',
      field: { multiline: false },
      context: {},
    })
  })
})
