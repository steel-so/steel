import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakePublishedFlow } from '@/src/__tests__/factories/nov-z3-whatsapp-flows.factory'
import {
  createFakeWhatsAppBroadcastList,
  createFakeWhatsAppBroadcastRecipient,
} from '@/src/__tests__/factories/whatsapp-broadcast.factory'
import { createFakeWhatsAppConnection } from '@/src/__tests__/factories/whatsapp-connection.factory'
import { createFakeWhatsAppContact } from '@/src/__tests__/factories/whatsapp-contact.factory'
import { createFakeWhatsAppSettings } from '@/src/__tests__/factories/whatsapp-settings.factory'
import { createFakeWhatsAppTemplate } from '@/src/__tests__/factories/whatsapp-template.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/repositories/whatsapp-connection.repository')
vi.mock('@/src/repositories/whatsapp-broadcast.repository')
vi.mock('@/src/repositories/whatsapp-template.repository')
vi.mock('@/src/repositories/whatsapp-settings.repository')
vi.mock('@/src/lib/whatsapp/send', () => ({
  WhatsAppSend: { text: vi.fn(), media: vi.fn(), template: vi.fn() },
}))
vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('@/lib/axiom/audit', () => ({ auditMutation: vi.fn() }))
vi.mock('@/src/services/whatsapp-notify', () => ({
  notifyWhatsAppUsers: vi.fn(async () => 1),
}))
vi.mock('@/src/lib/queue/queues', () => ({
  getWhatsappBroadcastQueue: vi.fn(() => ({ addBulk: vi.fn() })),
}))
vi.mock('@/src/services/whatsapp-flow-dispatch.service', () => ({
  WhatsAppFlowDispatchService: {
    prepareTemplateButton: vi.fn(),
    recordSent: vi.fn(async () => undefined),
  },
}))

import { WhatsAppSend } from '@/src/lib/whatsapp/send'
import { WhatsAppBroadcastRepository } from '@/src/repositories/whatsapp-broadcast.repository'
import { WhatsAppConnectionRepository } from '@/src/repositories/whatsapp-connection.repository'
import { WhatsAppSettingsRepository } from '@/src/repositories/whatsapp-settings.repository'
import { WhatsAppTemplateRepository } from '@/src/repositories/whatsapp-template.repository'
import { WhatsAppBroadcastService } from '../whatsapp-broadcast.service'
import { WhatsAppFlowDispatchService } from '../whatsapp-flow-dispatch.service'

const broadcastRepo = vi.mocked(WhatsAppBroadcastRepository)
const connectionRepo = vi.mocked(WhatsAppConnectionRepository)
const templateRepo = vi.mocked(WhatsAppTemplateRepository)
const settingsRepo = vi.mocked(WhatsAppSettingsRepository)
const send = vi.mocked(WhatsAppSend)
const dispatch = vi.mocked(WhatsAppFlowDispatchService)

const flowComponents = [
  { type: 'BODY', text: 'Responda nosso formulário' },
  {
    type: 'BUTTONS',
    buttons: [{ type: 'FLOW', text: 'Abrir', flow_id: 'meta-flow-1' }],
  },
]

const prepared = {
  flow: createFakePublishedFlow({ id: 'flow-1' }),
  flowToken: 'stlf.flow-1.n',
  component: {
    type: 'button',
    sub_type: 'flow',
    index: '0',
    parameters: [{ type: 'action', action: { flow_token: 'stlf.flow-1.n' } }],
  },
}

function arrange(provider: 'META' | 'ZAPI' = 'META') {
  const list = createFakeWhatsAppBroadcastList({
    id: 'list1',
    workspaceId: 'ws1',
    connectionId: 'conn1',
    templateId: 'tpl1',
    status: 'RUNNING',
  })
  broadcastRepo.findRecipientById.mockResolvedValue(
    ok({
      ...createFakeWhatsAppBroadcastRecipient({
        id: 'r1',
        broadcastListId: 'list1',
      }),
      contact: createFakeWhatsAppContact({
        id: 'contact-1',
        name: 'Maria',
        waId: '5511988887777',
      }),
      broadcastList: list,
    }),
  )
  connectionRepo.findById.mockResolvedValue(
    ok(createFakeWhatsAppConnection({ id: 'conn1', provider })),
  )
  templateRepo.findById.mockResolvedValue(
    ok(
      createFakeWhatsAppTemplate({
        id: 'tpl1',
        category: 'UTILITY',
        components: flowComponents as never,
      }),
    ),
  )
  settingsRepo.findByWorkspace.mockResolvedValue(
    ok(createFakeWhatsAppSettings({ workspaceId: 'ws1' })),
  )
  broadcastRepo.updateRecipientStatus.mockResolvedValue(ok(undefined))
  broadcastRepo.countPendingRecipients.mockResolvedValue(ok(1))
  send.template.mockResolvedValue(ok({ providerMessageId: 'wamid-1' }))
  dispatch.prepareTemplateButton.mockResolvedValue(ok(prepared))
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('sendToRecipient() with a Flow template', () => {
  it('adds the FLOW button with its token and records the pending answer', async () => {
    arrange()

    expectOk(await WhatsAppBroadcastService.sendToRecipient('list1', 'r1'))

    expect(dispatch.prepareTemplateButton).toHaveBeenCalledWith(
      'ws1',
      flowComponents,
      { id: 'contact-1', name: 'Maria', waId: '5511988887777' },
    )
    const input = send.template.mock.calls[0][1]
    expect(input.components).toContainEqual(prepared.component)
    expect(dispatch.recordSent).toHaveBeenCalledWith({
      workspaceId: 'ws1',
      flowId: 'flow-1',
      contactId: 'contact-1',
      flowToken: 'stlf.flow-1.n',
    })
  })

  it('sends without a token when the flow is not one of ours', async () => {
    arrange()
    dispatch.prepareTemplateButton.mockResolvedValue(ok(null))

    expectOk(await WhatsAppBroadcastService.sendToRecipient('list1', 'r1'))

    expect(send.template.mock.calls[0][1].components).not.toContainEqual(
      prepared.component,
    )
    expect(dispatch.recordSent).not.toHaveBeenCalled()
  })

  it('does not record an answer when the send failed', async () => {
    arrange()
    send.template.mockResolvedValue(err(databaseError('provider down')))

    expectOk(await WhatsAppBroadcastService.sendToRecipient('list1', 'r1'))

    expect(dispatch.recordSent).not.toHaveBeenCalled()
  })

  it('never looks for a flow on a Z-API connection', async () => {
    arrange('ZAPI')

    expectOk(await WhatsAppBroadcastService.sendToRecipient('list1', 'r1'))

    expect(dispatch.prepareTemplateButton).not.toHaveBeenCalled()
  })

  it('propagates a lookup failure without sending', async () => {
    arrange()
    dispatch.prepareTemplateButton.mockResolvedValue(err(databaseError('x')))

    expectErr(
      await WhatsAppBroadcastService.sendToRecipient('list1', 'r1'),
      'DATABASE_ERROR',
    )
    expect(send.template).not.toHaveBeenCalled()
  })
})
