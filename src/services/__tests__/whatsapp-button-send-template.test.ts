import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeWhatsAppTemplate } from '@/src/__tests__/factories/whatsapp-template.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError } from '@/src/errors'
import { err, ok } from '@/src/lib/result'
import { WhatsAppButtonActionSchema } from '@/src/schemas/whatsapp-button.schema'

vi.mock('@/src/repositories/whatsapp-template.repository')

import { WhatsAppTemplateRepository } from '@/src/repositories/whatsapp-template.repository'
import {
  WhatsAppButtonSendTemplateGuard as Guard,
  sendTemplateTargetProblem,
  sendTemplateTargets,
} from '../whatsapp-button-send-template'

const repo = vi.mocked(WhatsAppTemplateRepository)

function tpl(
  id: string,
  sends: string[] = [],
  overrides: Partial<Parameters<typeof createFakeWhatsAppTemplate>[0]> = {},
) {
  return createFakeWhatsAppTemplate({
    id,
    workspaceId: 'ws1',
    connectionId: 'conn1',
    buttons: sends.length
      ? [
          {
            id: 'b1',
            type: 'REPLY',
            label: 'Sim',
            actions: sends.map((templateId) => ({
              kind: 'SEND_TEMPLATE' as const,
              templateId,
            })),
          },
        ]
      : null,
    ...overrides,
  })
}

function store(templates: ReturnType<typeof tpl>[]) {
  repo.findById.mockImplementation(async (id) =>
    ok(templates.find((template) => template.id === id) ?? null),
  )
}

const buttonsSending = (...ids: string[]) => [
  {
    type: 'REPLY',
    actions: ids.map((templateId) => ({ kind: 'SEND_TEMPLATE', templateId })),
  },
]

beforeEach(() => vi.clearAllMocks())

describe('SEND_TEMPLATE schema', () => {
  it('needs a template id', () => {
    expect(
      WhatsAppButtonActionSchema.safeParse({
        kind: 'SEND_TEMPLATE',
        templateId: 'tpl2',
      }).success,
    ).toBe(true)
    expect(
      WhatsAppButtonActionSchema.safeParse({
        kind: 'SEND_TEMPLATE',
        templateId: '',
      }).success,
    ).toBe(false)
  })
})

describe('sendTemplateTargets', () => {
  it('collects the distinct targets of reply buttons only', () => {
    expect(
      sendTemplateTargets([
        ...buttonsSending('a', 'b', 'a'),
        { type: 'URL' },
        { type: 'REPLY', actions: [{ kind: 'REPLY' }] },
      ]),
    ).toEqual(['a', 'b'])
  })
})

describe('sendTemplateTargetProblem', () => {
  const ok1 = tpl('t')
  it('accepts an approved variable-free template of the connection', () => {
    expect(sendTemplateTargetProblem(ok1, 'conn1')).toBeNull()
    expect(sendTemplateTargetProblem(ok1, null)).toBeNull()
  })

  it.each([
    ['missing', null, 'não existe'],
    ['pending', tpl('t', [], { status: 'PENDING' }), 'aprovado'],
    ['paused', tpl('t', [], { status: 'PAUSED' }), 'aprovado'],
    [
      'other connection',
      tpl('t', [], { connectionId: 'conn2' }),
      'mesma conexão',
    ],
    [
      'with variables',
      tpl('t', [], { components: [{ type: 'BODY', text: 'Oi {{1}}' }] }),
      'variáveis',
    ],
  ])('refuses a %s template', (_name, template, message) => {
    expect(sendTemplateTargetProblem(template, 'conn1')).toContain(message)
  })
})

describe('WhatsAppButtonSendTemplateGuard.assert', () => {
  const base = {
    workspaceId: 'ws1',
    connectionId: 'conn1',
    ownerTemplateId: 'A',
  }

  it('does nothing without SEND_TEMPLATE actions', async () => {
    expectOk(await Guard.assert({ ...base, buttons: [{ type: 'URL' }] }))
    expect(repo.findById).not.toHaveBeenCalled()
  })

  it('accepts a valid target', async () => {
    store([tpl('A'), tpl('B')])
    expectOk(await Guard.assert({ ...base, buttons: buttonsSending('B') }))
  })

  it('refuses a template that sends itself', async () => {
    store([tpl('A')])
    expectErr(
      await Guard.assert({ ...base, buttons: buttonsSending('A') }),
      'VALIDATION_ERROR',
    )
  })

  it('refuses a target that is missing, not approved or of another connection', async () => {
    store([
      tpl('A'),
      tpl('P', [], { status: 'PENDING' }),
      tpl('X', [], { connectionId: 'c2' }),
    ])
    for (const id of ['nope', 'P', 'X']) {
      expectErr(
        await Guard.assert({ ...base, buttons: buttonsSending(id) }),
        'VALIDATION_ERROR',
      )
    }
  })

  it('refuses a loop A -> B -> A, direct or through a longer chain', async () => {
    store([tpl('A'), tpl('B', ['A'])])
    expectErr(
      await Guard.assert({ ...base, buttons: buttonsSending('B') }),
      'VALIDATION_ERROR',
    )

    store([tpl('A'), tpl('B', ['C']), tpl('C', ['D']), tpl('D', ['A'])])
    expectErr(
      await Guard.assert({ ...base, buttons: buttonsSending('B') }),
      'VALIDATION_ERROR',
    )
  })

  it('accepts a chain that does not come back, even with a diamond', async () => {
    store([tpl('A'), tpl('B', ['D', 'C']), tpl('C', ['D']), tpl('D')])
    expectOk(await Guard.assert({ ...base, buttons: buttonsSending('B') }))
  })

  it('stops on an unrelated cycle without hanging', async () => {
    store([tpl('A'), tpl('B', ['C']), tpl('C', ['B'])])
    expectOk(await Guard.assert({ ...base, buttons: buttonsSending('B') }))
  })

  it('skips the loop search for a quick reply (no owner template)', async () => {
    store([tpl('B', ['A'])])
    expectOk(
      await Guard.assert({
        workspaceId: 'ws1',
        connectionId: null,
        ownerTemplateId: null,
        buttons: buttonsSending('B'),
      }),
    )
  })

  it('propagates database errors', async () => {
    repo.findById.mockResolvedValue(err(databaseError()))
    expectErr(
      await Guard.assert({ ...base, buttons: buttonsSending('B') }),
      'DATABASE_ERROR',
    )
  })
})
