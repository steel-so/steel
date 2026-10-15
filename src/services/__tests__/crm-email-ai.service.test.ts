import { Prisma } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { aiQuotaExceeded, databaseError, featureNotEnabled } from '@/src/errors'
import { EMAIL_AI_FIELDS } from '@/src/lib/canvas-email/ai-blocks'
import { validateEmailFragment } from '@/src/lib/canvas-email/fragments'
import { err, ok } from '@/src/lib/result'
import {
  type CrmEmailAiRewriteInput,
  CrmEmailAiRewriteSchema,
  type CrmEmailAiSectionInput,
  CrmEmailAiSectionSchema,
} from '@/src/schemas/crm-email-editor.schema'

vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/crm-email-builder.repository')
vi.mock('@/src/services/ai-usage.service')
vi.mock('@/src/services/feature-flag.service')

import { CrmEmailBuilderRepository } from '@/src/repositories/crm-email-builder.repository'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { AiUsageService } from '@/src/services/ai-usage.service'
import { assertFeature } from '@/src/services/feature-flag.service'
import {
  buildRewriteSystem,
  buildSectionSystem,
  CrmEmailAiService,
} from '../crm-email-ai.service'

const membership = vi.mocked(MembershipRepository)
const builderRepo = vi.mocked(CrmEmailBuilderRepository)
const ai = vi.mocked(AiUsageService)
const feature = vi.mocked(assertFeature)

const WS = 'ws1'
const ACTOR = 'u1'

const provider = { id: 'anthropic' as const, chat: vi.fn() }

function chat(payload: unknown) {
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload)
  return {
    text,
    toolCalls: [],
    message: { role: 'assistant' as const, content: text },
    usage: { inputTokens: 300, outputTokens: 120 },
    stopReason: 'end' as const,
  }
}

const rewrite = (input: Partial<CrmEmailAiRewriteInput> = {}) =>
  CrmEmailAiRewriteSchema.parse({
    blockType: 'email.heading',
    mode: 'persuasive',
    text: 'Conheça o novo plano',
    subject: 'Novidades',
    ...input,
  })

const section = (input: Partial<CrmEmailAiSectionInput> = {}) =>
  CrmEmailAiSectionSchema.parse({ prompt: 'Três benefícios', ...input })

const block = (overrides: Record<string, unknown>) => ({
  type: 'heading',
  text: '',
  level: 'h2',
  items: [],
  url: '',
  author: '',
  role: '',
  code: '',
  ...overrides,
})

beforeEach(() => {
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
})

describe('prompts', () => {
  it('describes a plain field, the mode and the current text', () => {
    const system = buildRewriteSystem(
      rewrite(),
      EMAIL_AI_FIELDS['email.heading'],
    )
    expect(system).toContain('mais persuasivo')
    expect(system).toContain('Campo: Título.')
    expect(system).toContain('uma linha só')
    expect(system).toContain('no máximo 300 caracteres')
    expect(system).toContain('Assunto do e-mail: Novidades.')
    expect(system).toContain('Conheça o novo plano')
    expect(system).toContain('{{primeiro_nome}}')
    expect(system).not.toContain('{{unsubscribe_url}}')
  })

  it('asks rich fields for the HTML subset and handles an empty field', () => {
    const system = buildRewriteSystem(
      rewrite({ mode: 'write', text: '', subject: '' }),
      EMAIL_AI_FIELDS['email.text'],
    )
    expect(system).toContain('texto rico')
    expect(system).toContain('O campo está vazio')
    expect(system).not.toContain('Assunto do e-mail')
  })

  it('offers the product block only with a product', () => {
    const withProduct = buildSectionSystem(section({ subject: 'Oferta' }), {
      name: 'Fibra 500',
      description: 'Internet rápida',
      price: 'R$ 99,90',
    })
    expect(withProduct).toContain('Produto do CRM: Fibra 500 — R$ 99,90.')
    expect(withProduct).toContain('Descrição: Internet rápida')
    expect(withProduct).toContain('Assunto do e-mail: Oferta.')
    const noPrice = buildSectionSystem(section(), {
      name: 'Fibra',
      description: '',
      price: '',
    })
    expect(noPrice).toContain('Produto do CRM: Fibra.')
    expect(noPrice).not.toContain('Descrição:')
    expect(buildSectionSystem(section(), null)).toContain('product: não use')
  })
})

describe('CrmEmailAiService.rewrite()', () => {
  it('returns the fitted suggestion and records usage', async () => {
    provider.chat.mockResolvedValueOnce(
      chat({ reply: 'Mais direto.', suggestion: '"Fibra que não para"' }),
    )
    const result = expectOk(
      await CrmEmailAiService.rewrite(ACTOR, WS, rewrite()),
    )
    expect(result).toEqual({ value: 'Fibra que não para' })
    expect(provider.chat).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'claude-x',
        jsonSchema: expect.objectContaining({ name: 'email_block_copy' }),
        messages: [
          {
            role: 'user',
            content:
              'Reescreva o texto atual seguindo as instruções do sistema.',
          },
        ],
      }),
    )
    expect(ai.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ workspaceId: WS, userId: ACTOR }),
    )
  })

  it('writes rich text from a request, sanitized', async () => {
    provider.chat.mockResolvedValueOnce(
      chat({
        reply: 'ok',
        suggestion: '<p>Olá {{primeiro_nome}}</p><script>x</script>',
      }),
    )
    const result = expectOk(
      await CrmEmailAiService.rewrite(
        ACTOR,
        WS,
        rewrite({
          blockType: 'email.text',
          mode: 'write',
          text: '',
          prompt: 'Boas-vindas',
        }),
      ),
    )
    expect(result.value).toContain('Olá {{primeiro_nome}}')
    expect(result.value).not.toContain('script')
    expect(provider.chat.mock.calls[0][0].messages[0].content).toBe(
      'Boas-vindas',
    )
  })

  it.each([
    ['a block without text', { blockType: 'email.divider' }],
    ['write without a request', { mode: 'write' as const, prompt: '' }],
    ['a rewrite of an empty field', { text: ' ' }],
  ])('refuses %s', async (_label, input) => {
    expectErr(
      await CrmEmailAiService.rewrite(ACTOR, WS, rewrite(input)),
      'VALIDATION_ERROR',
    )
    expect(provider.chat).not.toHaveBeenCalled()
  })

  it('refuses viewers, a disabled feature and an exhausted quota', async () => {
    membership.findByUserAndWorkspace.mockResolvedValueOnce(
      ok(createFakeMembership({ role: 'VIEWER' })),
    )
    expectErr(
      await CrmEmailAiService.rewrite(ACTOR, WS, rewrite()),
      'FORBIDDEN',
    )
    feature.mockResolvedValueOnce(err(featureNotEnabled()))
    expectErr(
      await CrmEmailAiService.rewrite(ACTOR, WS, rewrite()),
      'FEATURE_NOT_ENABLED',
    )
    ai.prepare.mockResolvedValueOnce(err(aiQuotaExceeded(10, 10)))
    expectErr(
      await CrmEmailAiService.rewrite(ACTOR, WS, rewrite()),
      'AI_QUOTA_EXCEEDED',
    )
  })

  it('fails cleanly when the provider throws or returns nothing usable', async () => {
    provider.chat.mockRejectedValueOnce(new Error('timeout'))
    expectErr(
      await CrmEmailAiService.rewrite(ACTOR, WS, rewrite()),
      'CRM_EMAIL_AI_FAILED',
    )
    provider.chat.mockRejectedValueOnce('boom')
    expectErr(
      await CrmEmailAiService.rewrite(ACTOR, WS, rewrite()),
      'CRM_EMAIL_AI_FAILED',
    )
    provider.chat.mockResolvedValueOnce(chat('not json'))
    expectErr(
      await CrmEmailAiService.rewrite(ACTOR, WS, rewrite()),
      'CRM_EMAIL_AI_FAILED',
    )
    provider.chat.mockResolvedValueOnce(chat({ reply: 'x', suggestion: ' ' }))
    expectErr(
      await CrmEmailAiService.rewrite(ACTOR, WS, rewrite()),
      'CRM_EMAIL_AI_FAILED',
    )
  })
})

describe('CrmEmailAiService.generateSection()', () => {
  it('returns a validated section fragment', async () => {
    provider.chat.mockResolvedValueOnce(
      chat({
        reply: 'Montei a seção.',
        section: {
          background: 'none',
          columns: [
            {
              blocks: [
                block({ type: 'heading', text: 'Benefícios' }),
                block({ type: 'text', text: 'Fibra de verdade.' }),
                block({ type: 'button', text: 'Fale com vendas' }),
              ],
            },
          ],
        },
      }),
    )
    const result = expectOk(
      await CrmEmailAiService.generateSection(ACTOR, WS, section()),
    )
    expect(result.reply).toBe('Montei a seção.')
    expect(validateEmailFragment(result.fragment).ok).toBe(true)
    expect(builderRepo.findProducts).not.toHaveBeenCalled()
  })

  it('presents a CRM product (prompt optional)', async () => {
    builderRepo.findProducts.mockResolvedValueOnce(
      ok([
        {
          id: 'p1',
          name: 'Fibra 500',
          description: null,
          unitPrice: new Prisma.Decimal(99.9),
          currency: 'BRL',
        },
      ]),
    )
    provider.chat.mockResolvedValueOnce(
      chat({
        reply: '',
        section: {
          background: 'soft',
          columns: [{ blocks: [block({ type: 'product' })] }],
        },
      }),
    )
    const result = expectOk(
      await CrmEmailAiService.generateSection(
        ACTOR,
        WS,
        section({ prompt: '', productId: 'p1' }),
      ),
    )
    expect(result.reply).toContain('Pronto')
    const product = Object.values(result.fragment.nodes).find(
      (node) => node.type === 'email.product',
    )
    expect(product?.props.productId).toBe('p1')
    expect(builderRepo.findProducts).toHaveBeenCalledWith(WS, ['p1'])
    expect(provider.chat.mock.calls[0][0].messages[0].content).toContain(
      'Fibra 500',
    )
  })

  it('refuses an unknown product and propagates DB errors', async () => {
    builderRepo.findProducts.mockResolvedValueOnce(ok([]))
    expectErr(
      await CrmEmailAiService.generateSection(
        ACTOR,
        WS,
        section({ productId: 'nope' }),
      ),
      'RESOURCE_NOT_FOUND',
    )
    builderRepo.findProducts.mockResolvedValueOnce(err(databaseError('boom')))
    expectErr(
      await CrmEmailAiService.generateSection(
        ACTOR,
        WS,
        section({ productId: 'p1' }),
      ),
      'DATABASE_ERROR',
    )
    expect(provider.chat).not.toHaveBeenCalled()
  })

  it('never returns invalid nodes', async () => {
    provider.chat.mockResolvedValueOnce(chat('nope'))
    const unparsable = expectErr(
      await CrmEmailAiService.generateSection(ACTOR, WS, section()),
      'CRM_EMAIL_AI_FAILED',
    )
    expect(unparsable.message).toContain('seção válida')

    provider.chat.mockResolvedValueOnce(
      chat({
        reply: 'x',
        section: {
          background: 'none',
          columns: [{ blocks: [block({ type: 'heading', text: '' })] }],
        },
      }),
    )
    const empty = expectErr(
      await CrmEmailAiService.generateSection(ACTOR, WS, section()),
      'CRM_EMAIL_AI_FAILED',
    )
    expect(empty.message).toContain('nenhum bloco')

    provider.chat.mockRejectedValueOnce(new Error('down'))
    expectErr(
      await CrmEmailAiService.generateSection(ACTOR, WS, section()),
      'CRM_EMAIL_AI_FAILED',
    )
  })

  it('refuses without access', async () => {
    feature.mockResolvedValueOnce(err(featureNotEnabled()))
    expectErr(
      await CrmEmailAiService.generateSection(ACTOR, WS, section()),
      'FEATURE_NOT_ENABLED',
    )
  })
})
