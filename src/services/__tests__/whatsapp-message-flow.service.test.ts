import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import { createFakeWhatsAppConnection } from '@/src/__tests__/factories/whatsapp-connection.factory'
import { createFakeWhatsAppConversationWithPreview } from '@/src/__tests__/factories/whatsapp-conversation.factory'
import { createFakeWhatsAppMessage } from '@/src/__tests__/factories/whatsapp-message.factory'
import { createFakeWhatsAppTemplate } from '@/src/__tests__/factories/whatsapp-template.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/services/whatsapp-business-hours.service', () => ({
  WhatsAppBusinessHoursService: {
    assertOpen: vi.fn(async () => ({ ok: true, value: undefined })),
  },
}))
vi.mock('@/src/services/whatsapp-sla.service', () => ({
  WhatsAppSlaService: { onOutbound: vi.fn(async () => undefined) },
}))
vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/whatsapp-connection.repository')
vi.mock('@/src/repositories/whatsapp-conversation.repository')
vi.mock('@/src/repositories/whatsapp-message.repository')
vi.mock('@/src/repositories/whatsapp-template.repository')
vi.mock('@/src/lib/whatsapp/realtime', () => ({
  publishWhatsAppEvent: vi.fn(async () => undefined),
}))
vi.mock('@/src/lib/whatsapp/send', () => ({
  WhatsAppSend: { flow: vi.fn(), template: vi.fn() },
}))

import { WhatsAppSend } from '@/src/lib/whatsapp/send'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { WhatsAppConnectionRepository } from '@/src/repositories/whatsapp-connection.repository'
import { WhatsAppConversationRepository } from '@/src/repositories/whatsapp-conversation.repository'
import { WhatsAppMessageRepository } from '@/src/repositories/whatsapp-message.repository'
import { WhatsAppTemplateRepository } from '@/src/repositories/whatsapp-template.repository'
import { WhatsAppMessageService } from '../whatsapp-message.service'

const membershipRepo = vi.mocked(MembershipRepository)
const connectionRepo = vi.mocked(WhatsAppConnectionRepository)
const conversationRepo = vi.mocked(WhatsAppConversationRepository)
const messageRepo = vi.mocked(WhatsAppMessageRepository)
const templateRepo = vi.mocked(WhatsAppTemplateRepository)
const send = vi.mocked(WhatsAppSend)

const interactive = {
  kind: 'INTERACTIVE' as const,
  connectionId: 'conn1',
  flowId: 'meta-flow',
  flowToken: 'stlf.f.n',
  bodyText: 'Preencha',
  ctaLabel: 'Abrir',
  screen: 'SCREEN_A',
  draft: false,
  label: 'Cadastro',
}

const byTemplate = {
  kind: 'TEMPLATE' as const,
  connectionId: 'conn1',
  templateName: 'cadastro',
  language: 'pt_BR',
  flowToken: 'stlf.f.n',
  label: 'Cadastro',
}

beforeEach(() => {
  vi.resetAllMocks()
  membershipRepo.findByUserAndWorkspace.mockResolvedValue(
    ok(createFakeMembership({ role: 'MEMBER' })),
  )
  conversationRepo.findById.mockResolvedValue(
    ok(
      createFakeWhatsAppConversationWithPreview({
        id: 'conv1',
        workspaceId: 'ws1',
        connectionId: 'conn1',
        contactId: 'contact1',
        aiActive: false,
      }),
    ),
  )
  conversationRepo.update.mockResolvedValue(
    ok(createFakeWhatsAppConversationWithPreview()),
  )
  connectionRepo.findById.mockResolvedValue(
    ok(createFakeWhatsAppConnection({ id: 'conn1', workspaceId: 'ws1' })),
  )
  messageRepo.create.mockImplementation(async (data) =>
    ok(createFakeWhatsAppMessage({ ...data, id: 'msg1' } as never)),
  )
  send.flow.mockResolvedValue(ok({ providerMessageId: 'pm-flow' }))
  send.template.mockResolvedValue(ok({ providerMessageId: 'pm-tpl' }))
})

describe('WhatsAppMessageService.sendFlow()', () => {
  it('sends the interactive flow and records it on the timeline', async () => {
    const result = expectOk(
      await WhatsAppMessageService.sendFlow('u1', 'ws1', 'conv1', interactive),
    )
    expect(result.contactId).toBe('contact1')
    expect(result.message.id).toBe('msg1')
    expect(send.flow).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        flowId: 'meta-flow',
        flowToken: 'stlf.f.n',
        screen: 'SCREEN_A',
        draft: false,
      }),
      expect.objectContaining({ cost: expect.anything() }),
    )
    expect(messageRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        direction: 'OUT',
        type: 'TEXT',
        text: 'Formulário enviado: Cadastro',
        providerMessageId: 'pm-flow',
        senderUserId: 'u1',
      }),
    )
  })

  it('sends a template whose FLOW button gets the token', async () => {
    templateRepo.findByConnectionAndName.mockResolvedValue(
      ok(
        createFakeWhatsAppTemplate({
          category: 'UTILITY',
          components: [
            { type: 'BODY', text: 'x' },
            {
              type: 'BUTTONS',
              buttons: [{ type: 'QUICK_REPLY', text: 'a' }, { type: 'FLOW' }],
            },
          ],
        }),
      ),
    )
    expectOk(
      await WhatsAppMessageService.sendFlow('u1', 'ws1', 'conv1', byTemplate),
    )
    expect(send.template).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        templateName: 'cadastro',
        components: [
          {
            type: 'button',
            sub_type: 'flow',
            index: '1',
            parameters: [
              { type: 'action', action: { flow_token: 'stlf.f.n' } },
            ],
          },
        ],
      }),
      expect.objectContaining({
        cost: expect.objectContaining({ templateCategory: 'UTILITY' }),
      }),
    )
    expect(messageRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'TEMPLATE', text: 'cadastro' }),
    )
  })

  it('falls back to button index 0 when the template is unknown or malformed', async () => {
    templateRepo.findByConnectionAndName.mockResolvedValue(ok(null))
    expectOk(
      await WhatsAppMessageService.sendFlow('u1', 'ws1', 'conv1', byTemplate),
    )
    expect(
      (send.template.mock.calls[0][1].components?.[0] as { index: string })
        .index,
    ).toBe('0')

    templateRepo.findByConnectionAndName.mockResolvedValue(
      ok(createFakeWhatsAppTemplate({ components: 'oops' as never })),
    )
    expectOk(
      await WhatsAppMessageService.sendFlow('u1', 'ws1', 'conv1', byTemplate),
    )
    templateRepo.findByConnectionAndName.mockResolvedValue(
      ok(
        createFakeWhatsAppTemplate({
          components: [{ type: 'BODY' }, { type: 'BUTTONS' }] as never,
        }),
      ),
    )
    expectOk(
      await WhatsAppMessageService.sendFlow('u1', 'ws1', 'conv1', byTemplate),
    )
    expect(
      (send.template.mock.calls[2][1].components?.[0] as { index: string })
        .index,
    ).toBe('0')
  })

  it('refuses a chat that is on another connection than the flow', async () => {
    expectErr(
      await WhatsAppMessageService.sendFlow('u1', 'ws1', 'conv1', {
        ...interactive,
        connectionId: 'other',
      }),
      'WHATSAPP_FLOW_NOT_SENDABLE',
    )
    expect(send.flow).not.toHaveBeenCalled()
  })

  it('propagates authorization, provider and storage failures', async () => {
    membershipRepo.findByUserAndWorkspace.mockResolvedValueOnce(ok(null))
    expectErr(
      await WhatsAppMessageService.sendFlow('u1', 'ws1', 'conv1', interactive),
      'FORBIDDEN',
    )

    conversationRepo.findById.mockResolvedValueOnce(ok(null))
    expectErr(
      await WhatsAppMessageService.sendFlow('u1', 'ws1', 'conv1', interactive),
      'WHATSAPP_CONVERSATION_NOT_FOUND',
    )

    send.flow.mockResolvedValueOnce(
      err({ code: 'WHATSAPP_PROVIDER_ERROR' as const, message: 'x' }),
    )
    expectErr(
      await WhatsAppMessageService.sendFlow('u1', 'ws1', 'conv1', interactive),
      'WHATSAPP_PROVIDER_ERROR',
    )

    messageRepo.create.mockResolvedValueOnce(
      err({ code: 'DATABASE_ERROR' as const, message: 'x' }),
    )
    expectErr(
      await WhatsAppMessageService.sendFlow('u1', 'ws1', 'conv1', interactive),
      'DATABASE_ERROR',
    )

    templateRepo.findByConnectionAndName.mockResolvedValueOnce(
      err({ code: 'DATABASE_ERROR' as const, message: 'x' }),
    )
    expectErr(
      await WhatsAppMessageService.sendFlow('u1', 'ws1', 'conv1', byTemplate),
      'DATABASE_ERROR',
    )

    templateRepo.findByConnectionAndName.mockResolvedValueOnce(ok(null))
    send.template.mockResolvedValueOnce(
      err({ code: 'WHATSAPP_PROVIDER_ERROR' as const, message: 'x' }),
    )
    expectErr(
      await WhatsAppMessageService.sendFlow('u1', 'ws1', 'conv1', byTemplate),
      'WHATSAPP_PROVIDER_ERROR',
    )

    templateRepo.findByConnectionAndName.mockResolvedValueOnce(ok(null))
    messageRepo.create.mockResolvedValueOnce(
      err({ code: 'DATABASE_ERROR' as const, message: 'x' }),
    )
    expectErr(
      await WhatsAppMessageService.sendFlow('u1', 'ws1', 'conv1', byTemplate),
      'DATABASE_ERROR',
    )
  })
})
