import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import { createFakeWhatsAppConnection } from '@/src/__tests__/factories/whatsapp-connection.factory'
import { createFakeWhatsAppContact } from '@/src/__tests__/factories/whatsapp-contact.factory'
import { createFakeWhatsAppConversationWithPreview } from '@/src/__tests__/factories/whatsapp-conversation.factory'
import { createFakeWhatsAppMessage } from '@/src/__tests__/factories/whatsapp-message.factory'
import { createFakeWhatsAppTemplate } from '@/src/__tests__/factories/whatsapp-template.factory'
import { expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/whatsapp-connection.repository')
vi.mock('@/src/repositories/whatsapp-conversation.repository')
vi.mock('@/src/repositories/whatsapp-message.repository')
vi.mock('@/src/repositories/whatsapp-template.repository')
vi.mock('@/lib/axiom/audit', () => ({ auditMutation: vi.fn() }))
vi.mock('@/src/lib/search/index-hooks', () => ({
  indexSearchDocument: vi.fn(),
}))
vi.mock('@/src/lib/whatsapp/realtime', () => ({
  publishWhatsAppEvent: vi.fn(async () => undefined),
}))
vi.mock('@/src/lib/whatsapp/send', () => ({
  WhatsAppSend: { template: vi.fn() },
}))

import { WhatsAppSend } from '@/src/lib/whatsapp/send'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { WhatsAppConnectionRepository } from '@/src/repositories/whatsapp-connection.repository'
import { WhatsAppConversationRepository } from '@/src/repositories/whatsapp-conversation.repository'
import { WhatsAppMessageRepository } from '@/src/repositories/whatsapp-message.repository'
import { WhatsAppTemplateRepository } from '@/src/repositories/whatsapp-template.repository'
import { WhatsAppMessageService } from '../whatsapp-message.service'

const send = vi.mocked(WhatsAppSend)
const templateRepo = vi.mocked(WhatsAppTemplateRepository)
const messageRepo = vi.mocked(WhatsAppMessageRepository)
const connection = createFakeWhatsAppConnection({ id: 'conn1' })

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(MembershipRepository).findByUserAndWorkspace.mockResolvedValue(
    ok(createFakeMembership({ role: 'MEMBER' })),
  )
  const conversation = createFakeWhatsAppConversationWithPreview({
    id: 'c1',
    connectionId: 'conn1',
    aiActive: false,
    contact: createFakeWhatsAppContact({ waId: '5511' }),
  })
  vi.mocked(WhatsAppConversationRepository).findById.mockResolvedValue(
    ok(conversation),
  )
  vi.mocked(WhatsAppConversationRepository).update.mockResolvedValue(
    ok(conversation),
  )
  vi.mocked(WhatsAppConnectionRepository).findById.mockResolvedValue(
    ok(connection),
  )
  send.template.mockResolvedValue(ok({ providerMessageId: 'p1' }))
  messageRepo.create.mockResolvedValue(ok(createFakeWhatsAppMessage()))
})

const dto = {
  templateName: 'promo',
  language: 'pt_BR',
  components: [{ type: 'body', parameters: [] }],
}

describe('WhatsAppMessageService.sendTemplate() extras', () => {
  it('adds the media header and reply payloads and stores the buttons', async () => {
    templateRepo.findByConnectionAndName.mockResolvedValue(
      ok(
        createFakeWhatsAppTemplate({
          id: 'tpl1',
          headerFormat: 'IMAGE',
          headerMediaUrl: 'https://m/a.png',
          buttons: [{ id: 'b1', type: 'REPLY', label: 'Sim', actions: [] }],
        }),
      ),
    )

    expectOk(await WhatsAppMessageService.sendTemplate('u1', 'ws1', 'c1', dto))

    expect(templateRepo.findByConnectionAndName).toHaveBeenCalledWith(
      'conn1',
      'promo',
      'pt_BR',
    )
    const components = send.template.mock.calls[0][1].components as {
      type: string
    }[]
    expect(components.map((c) => c.type)).toEqual(['header', 'body', 'button'])
    expect(messageRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'TEMPLATE',
        buttons: [{ id: 'b1', type: 'REPLY', label: 'Sim' }],
      }),
    )
  })

  it('sends as built when the template is unknown or unreadable', async () => {
    templateRepo.findByConnectionAndName.mockResolvedValueOnce(ok(null))
    expectOk(await WhatsAppMessageService.sendTemplate('u1', 'ws1', 'c1', dto))
    templateRepo.findByConnectionAndName.mockResolvedValueOnce(
      err(databaseError()),
    )
    expectOk(await WhatsAppMessageService.sendTemplate('u1', 'ws1', 'c1', dto))

    expect(send.template.mock.calls[0][1].components).toEqual(dto.components)
    expect(send.template.mock.calls[1][1].components).toEqual(dto.components)
    expect(messageRepo.create.mock.calls[0][0].buttons).toBeUndefined()
  })
})
