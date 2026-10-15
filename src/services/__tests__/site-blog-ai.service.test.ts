import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import { createFakeSite } from '@/src/__tests__/factories/site.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { aiQuotaExceeded, featureNotEnabled } from '@/src/errors'
import { err, ok } from '@/src/lib/result'
import {
  type SiteBlogAiDTO,
  SiteBlogAiSchema,
} from '@/src/schemas/site-blog.schema'

vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/site.repository')
vi.mock('@/src/services/ai-usage.service')
vi.mock('@/src/services/feature-flag.service')

import { MembershipRepository } from '@/src/repositories/membership.repository'
import { SiteRepository } from '@/src/repositories/site.repository'
import { AiUsageService } from '@/src/services/ai-usage.service'
import { assertFeature } from '@/src/services/feature-flag.service'
import { buildBlogAiSystem, SiteBlogAiService } from '../site-blog-ai.service'

const membership = vi.mocked(MembershipRepository)
const sites = vi.mocked(SiteRepository)
const ai = vi.mocked(AiUsageService)
const feature = vi.mocked(assertFeature)
const provider = { id: 'anthropic' as const, chat: vi.fn() }

const WS = 'ws1'
const SITE = 'site1'

function reply(output: Record<string, unknown>) {
  const text = JSON.stringify({
    title: '',
    excerpt: '',
    body: '',
    titles: [],
    faq: [],
    description: '',
    ...output,
  })
  return {
    text,
    toolCalls: [],
    message: { role: 'assistant', content: text },
    usage: { inputTokens: 1, outputTokens: 1 },
    stopReason: 'end',
  }
}

const dto = (input: Record<string, unknown>): SiteBlogAiDTO =>
  SiteBlogAiSchema.parse(input)

beforeEach(() => {
  membership.findByUserAndWorkspace.mockResolvedValue(
    ok(createFakeMembership({ role: 'MEMBER' })),
  )
  sites.findById.mockResolvedValue(
    ok(createFakeSite({ id: SITE, workspaceId: WS })),
  )
  feature.mockResolvedValue(ok(true))
  ai.prepare.mockResolvedValue(
    ok({
      feature: 'CRM_ASSISTANT',
      provider: provider as never,
      model: {
        key: 'k',
        provider: 'anthropic',
        model: 'm',
        label: 'M',
      } as never,
    }),
  )
  ai.record.mockResolvedValue(undefined)
})

describe('buildBlogAiSystem', () => {
  it('describes each task, the tone and the keyword', () => {
    expect(
      buildBlogAiSystem(
        dto({
          action: 'write',
          topic: 'x',
          tone: 'tecnico',
          focusKeyword: 'fibra',
        }),
      ),
    ).toContain('Palavra-chave principal: "fibra"')
    expect(
      buildBlogAiSystem(dto({ action: 'write', topic: 'x', tone: 'tecnico' })),
    ).toContain('Tom: técnico')
    expect(buildBlogAiSystem(dto({ action: 'summary', text: 'a' }))).toContain(
      'resumir o post',
    )
    expect(buildBlogAiSystem(dto({ action: 'titles', text: 'a' }))).toContain(
      '5 títulos',
    )
    expect(buildBlogAiSystem(dto({ action: 'faq', text: 'a' }))).toContain(
      'perguntas frequentes',
    )
  })
})

describe('SiteBlogAiService.run', () => {
  it('writes a post draft as a Plate value', async () => {
    provider.chat.mockResolvedValueOnce(
      reply({
        title: ' Título ',
        excerpt: 'Resumo',
        description: 'Desc',
        body: '## Sub\n\nTexto',
      }),
    )
    const result = expectOk(
      await SiteBlogAiService.run(
        'u1',
        WS,
        SITE,
        dto({ action: 'write', topic: 'Fibra', outline: 'pontos' }),
      ),
    )
    expect(result).toMatchObject({
      action: 'write',
      title: 'Título',
      excerpt: 'Resumo',
      description: 'Desc',
    })
    expect(result.content?.[0]).toEqual({
      type: 'h2',
      children: [{ text: 'Sub' }],
    })
    expect(provider.chat.mock.calls[0][0].messages[0].content).toContain(
      'Roteiro e instruções:\npontos',
    )
    expect(ai.record).toHaveBeenCalled()
  })

  it('summarizes, suggests titles and builds a FAQ', async () => {
    provider.chat.mockResolvedValueOnce(
      reply({ excerpt: 'Curto', description: 'D' }),
    )
    expect(
      expectOk(
        await SiteBlogAiService.run(
          'u1',
          WS,
          SITE,
          dto({ action: 'summary', text: 'Texto', topic: 'T' }),
        ),
      ),
    ).toEqual({ action: 'summary', excerpt: 'Curto', description: 'D' })
    expect(provider.chat.mock.calls[0][0].messages[0].content).toContain(
      'Título atual: T',
    )
    provider.chat.mockResolvedValueOnce(reply({ titles: [' A ', '', 'B'] }))
    expect(
      expectOk(
        await SiteBlogAiService.run(
          'u1',
          WS,
          SITE,
          dto({ action: 'titles', text: 'Texto' }),
        ),
      ).titles,
    ).toEqual(['A', 'B'])
    provider.chat.mockResolvedValueOnce(
      reply({
        faq: [
          { question: ' Q ', answer: ' A ' },
          { question: '', answer: 'x' },
        ],
      }),
    )
    expect(
      expectOk(
        await SiteBlogAiService.run(
          'u1',
          WS,
          SITE,
          dto({ action: 'faq', text: 'Texto' }),
        ),
      ).faq,
    ).toEqual([{ question: 'Q', answer: 'A' }])
  })

  it('fails on empty or invalid outputs and provider errors', async () => {
    const cases: Array<[Record<string, unknown>, Record<string, unknown>]> = [
      [{ action: 'write', topic: 'x' }, {}],
      [{ action: 'summary', text: 'x' }, {}],
      [{ action: 'titles', text: 'x' }, {}],
      [{ action: 'faq', text: 'x' }, {}],
    ]
    for (const [input, output] of cases) {
      provider.chat.mockResolvedValueOnce(reply(output))
      expectErr(
        await SiteBlogAiService.run('u1', WS, SITE, dto(input)),
        'SITE_BLOG_AI_FAILED',
      )
    }
    provider.chat.mockResolvedValueOnce({ ...reply({}), text: 'não é json' })
    expectErr(
      await SiteBlogAiService.run(
        'u1',
        WS,
        SITE,
        dto({ action: 'titles', text: 'x' }),
      ),
      'SITE_BLOG_AI_FAILED',
    )
    provider.chat.mockRejectedValueOnce(new Error('timeout'))
    expectErr(
      await SiteBlogAiService.run(
        'u1',
        WS,
        SITE,
        dto({ action: 'titles', text: 'x' }),
      ),
      'SITE_BLOG_AI_FAILED',
    )
    provider.chat.mockRejectedValueOnce('boom')
    expectErr(
      await SiteBlogAiService.run(
        'u1',
        WS,
        SITE,
        dto({ action: 'titles', text: 'x' }),
      ),
      'SITE_BLOG_AI_FAILED',
    )
  })

  it('respects the gates', async () => {
    feature.mockResolvedValueOnce(err(featureNotEnabled()))
    expect(
      (
        await SiteBlogAiService.run(
          'u1',
          WS,
          SITE,
          dto({ action: 'titles', text: 'x' }),
        )
      ).ok,
    ).toBe(false)
    ai.prepare.mockResolvedValueOnce(err(aiQuotaExceeded(10, 10)))
    expectErr(
      await SiteBlogAiService.run(
        'u1',
        WS,
        SITE,
        dto({ action: 'titles', text: 'x' }),
      ),
      'AI_QUOTA_EXCEEDED',
    )
    membership.findByUserAndWorkspace.mockResolvedValue(
      ok(createFakeMembership({ role: 'VIEWER' })),
    )
    expectErr(
      await SiteBlogAiService.run(
        'u1',
        WS,
        SITE,
        dto({ action: 'titles', text: 'x' }),
      ),
      'FORBIDDEN',
    )
    expect(provider.chat).not.toHaveBeenCalled()
  })
})
