import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createFakeFlow,
  createFakeFlowResponse,
  createFakePublishedFlow,
} from '@/src/__tests__/factories/nov-z3-whatsapp-flows.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError } from '@/src/errors'
import { err, ok } from '@/src/lib/result'
import { flowFromPreset } from '@/src/lib/whatsapp/flows/templates'

vi.mock('@/src/repositories/whatsapp-flow.repository')
vi.mock('@/src/repositories/whatsapp-flow-response.repository')
vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { logger } from '@/lib/axiom/logger'
import { WhatsAppFlowRepository } from '@/src/repositories/whatsapp-flow.repository'
import { WhatsAppFlowResponseRepository } from '@/src/repositories/whatsapp-flow-response.repository'
import { WhatsAppFlowDispatchService } from '../whatsapp-flow-dispatch.service'

const flowRepo = vi.mocked(WhatsAppFlowRepository)
const responseRepo = vi.mocked(WhatsAppFlowResponseRepository)

const contact = { id: 'contact-1', name: 'Maria', waId: '5511999990000' }
const buttonTemplate = [
  { type: 'BODY', text: 'x' },
  {
    type: 'BUTTONS',
    buttons: [
      { type: 'QUICK_REPLY', text: 'a' },
      { type: 'FLOW', flow_id: 'meta-flow-1' },
    ],
  },
]

beforeEach(() => {
  vi.resetAllMocks()
})

describe('WhatsAppFlowDispatchService.prepareTemplateButton', () => {
  it('builds the FLOW button with a token and the prefill', async () => {
    flowRepo.findByMetaFlowId.mockResolvedValue(ok(createFakePublishedFlow()))

    const prepared = expectOk(
      await WhatsAppFlowDispatchService.prepareTemplateButton(
        'ws',
        buttonTemplate,
        contact,
      ),
    )

    expect(flowRepo.findByMetaFlowId).toHaveBeenCalledWith('ws', 'meta-flow-1')
    expect(prepared?.flowToken).toMatch(/^stlf\./)
    expect(prepared?.component).toMatchObject({
      type: 'button',
      sub_type: 'flow',
      index: '1',
      parameters: [
        {
          type: 'action',
          action: {
            flow_token: prepared?.flowToken,
            flow_action_data: expect.objectContaining({
              nome: 'Maria',
            }),
          },
        },
      ],
    })
  })

  it('falls back to the draft definition when nothing was published', async () => {
    flowRepo.findByMetaFlowId.mockResolvedValue(
      ok(createFakePublishedFlow({ publishedDefinition: null })),
    )
    const prepared = expectOk(
      await WhatsAppFlowDispatchService.prepareTemplateButton(
        'ws',
        buttonTemplate,
        contact,
      ),
    )
    expect(prepared).not.toBeNull()
  })

  it.each([
    ['no template components', undefined],
    ['no FLOW button', [{ type: 'BODY', text: 'x' }]],
    [
      'a FLOW button without a flow id',
      [{ type: 'BUTTONS', buttons: [{ type: 'FLOW' }] }],
    ],
  ])('does nothing for %s', async (_name, components) => {
    expect(
      expectOk(
        await WhatsAppFlowDispatchService.prepareTemplateButton(
          'ws',
          components,
          contact,
        ),
      ),
    ).toBeNull()
    expect(flowRepo.findByMetaFlowId).not.toHaveBeenCalled()
  })

  it('does nothing for a flow Steel does not know or has retired', async () => {
    flowRepo.findByMetaFlowId.mockResolvedValueOnce(ok(null))
    expect(
      expectOk(
        await WhatsAppFlowDispatchService.prepareTemplateButton(
          'ws',
          buttonTemplate,
          contact,
        ),
      ),
    ).toBeNull()
    flowRepo.findByMetaFlowId.mockResolvedValueOnce(
      ok(createFakePublishedFlow({ status: 'DEPRECATED' })),
    )
    expect(
      expectOk(
        await WhatsAppFlowDispatchService.prepareTemplateButton(
          'ws',
          buttonTemplate,
          contact,
        ),
      ),
    ).toBeNull()
  })

  it('propagates database failures', async () => {
    flowRepo.findByMetaFlowId.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await WhatsAppFlowDispatchService.prepareTemplateButton(
        'ws',
        buttonTemplate,
        contact,
      ),
      'DATABASE_ERROR',
    )
  })
})

describe('WhatsAppFlowDispatchService.prepareInteractive', () => {
  const meta = { id: 'conn-1', provider: 'META' as const }

  it('builds the interactive payload with the prefill', async () => {
    flowRepo.findById.mockResolvedValue(
      ok(
        createFakePublishedFlow({ connectionId: 'conn-1', ctaLabel: 'Abrir' }),
      ),
    )
    const result = expectOk(
      await WhatsAppFlowDispatchService.prepareInteractive(
        'ws',
        meta,
        'flow-1',
        contact,
        { bodyText: ' Oi! ', ctaLabel: '' },
      ),
    )
    expect(result).toMatchObject({
      kind: 'ready',
      input: {
        flowId: 'meta-flow-1',
        bodyText: 'Oi!',
        ctaLabel: 'Abrir',
        screen: 'SCREEN_A',
        draft: false,
        data: expect.objectContaining({ nome: 'Maria' }),
      },
    })
    if (result.kind === 'ready') {
      expect(result.input.flowToken).toMatch(/^stlf\./)
    }
  })

  it('uses the flow text by default and marks a Meta draft', async () => {
    const preset = flowFromPreset('SIGN_UP')
    flowRepo.findById.mockResolvedValue(
      ok(
        createFakePublishedFlow({
          connectionId: 'conn-1',
          metaStatus: 'DRAFT',
          publishedDefinition: null,
        }),
      ),
    )
    const result = expectOk(
      await WhatsAppFlowDispatchService.prepareInteractive(
        'ws',
        meta,
        'flow-1',
        contact,
      ),
    )
    expect(result).toMatchObject({
      kind: 'ready',
      input: { bodyText: preset.bodyText, draft: true },
    })
  })

  it.each([
    ['not_found', null, meta],
    [
      'deprecated',
      createFakePublishedFlow({ connectionId: 'conn-1', status: 'DEPRECATED' }),
      meta,
    ],
    ['not_published', createFakeFlow({ connectionId: 'conn-1' }), meta],
    [
      'other_connection',
      createFakePublishedFlow({ connectionId: 'conn-9' }),
      meta,
    ],
    [
      'not_meta',
      createFakePublishedFlow({ connectionId: 'conn-1' }),
      { id: 'conn-1', provider: 'ZAPI' as const },
    ],
  ])('blocks the send as %s', async (reason, flow, connection) => {
    flowRepo.findById.mockResolvedValue(ok(flow))
    expect(
      expectOk(
        await WhatsAppFlowDispatchService.prepareInteractive(
          'ws',
          connection,
          'flow-1',
          contact,
        ),
      ),
    ).toEqual({ kind: 'blocked', reason })
  })

  it('propagates database failures', async () => {
    flowRepo.findById.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await WhatsAppFlowDispatchService.prepareInteractive(
        'ws',
        meta,
        'flow-1',
        contact,
      ),
      'DATABASE_ERROR',
    )
  })
})

describe('WhatsAppFlowDispatchService.recordSent', () => {
  it('stores the pending answer', async () => {
    responseRepo.create.mockResolvedValue(ok(createFakeFlowResponse()))
    await WhatsAppFlowDispatchService.recordSent({
      workspaceId: 'ws',
      flowId: 'f1',
      contactId: 'c1',
      flowToken: 'stlf.f1.n',
    })
    expect(responseRepo.create).toHaveBeenCalledWith({
      workspaceId: 'ws',
      flowId: 'f1',
      contactId: 'c1',
      conversationId: null,
      flowToken: 'stlf.f1.n',
      messageId: null,
    })
  })

  it('only logs when the row cannot be stored', async () => {
    responseRepo.create.mockResolvedValue(err(databaseError('x')))
    await expect(
      WhatsAppFlowDispatchService.recordSent({
        workspaceId: 'ws',
        flowId: 'f1',
        contactId: 'c1',
        conversationId: 'conv',
        flowToken: 't',
        messageId: 'm',
      }),
    ).resolves.toBeUndefined()
    expect(logger.error).toHaveBeenCalledWith(
      'whatsapp.flow.response_record_failed',
      expect.objectContaining({ flowId: 'f1' }),
    )
  })
})
