import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createFakeWhatsAppBroadcastList,
  createFakeWhatsAppBroadcastRecipient,
} from '@/src/__tests__/factories/whatsapp-broadcast.factory'
import { createFakeWhatsAppConnection } from '@/src/__tests__/factories/whatsapp-connection.factory'
import { createFakeWhatsAppContact } from '@/src/__tests__/factories/whatsapp-contact.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError, whatsappContactBlocked } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/repositories/whatsapp-connection.repository')
vi.mock('@/src/repositories/whatsapp-broadcast.repository')
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

import { WhatsAppSend } from '@/src/lib/whatsapp/send'
import { WhatsAppBroadcastRepository } from '@/src/repositories/whatsapp-broadcast.repository'
import { WhatsAppConnectionRepository } from '@/src/repositories/whatsapp-connection.repository'
import { WhatsAppContactBlockRepository } from '@/src/repositories/whatsapp-contact-block.repository'
import { WhatsAppBroadcastService } from '../whatsapp-broadcast.service'

const broadcastRepo = vi.mocked(WhatsAppBroadcastRepository)
const blocks = vi.mocked(WhatsAppContactBlockRepository)
const send = vi.mocked(WhatsAppSend)

const connection = createFakeWhatsAppConnection({
  id: 'conn1',
  provider: 'ZAPI',
})

beforeEach(() => {
  vi.clearAllMocks()
  broadcastRepo.findRecipientById.mockResolvedValue(
    ok({
      ...createFakeWhatsAppBroadcastRecipient({
        id: 'r1',
        broadcastListId: 'list1',
      }),
      contact: createFakeWhatsAppContact({ waId: '5511988887777' }),
      broadcastList: createFakeWhatsAppBroadcastList({
        id: 'list1',
        workspaceId: 'ws1',
        connectionId: 'conn1',
        templateId: null,
        mediaUrl: null,
        messageBody: 'Promoção',
        status: 'RUNNING',
      }),
    }),
  )
  vi.mocked(WhatsAppConnectionRepository.findById).mockResolvedValue(
    ok(connection),
  )
  broadcastRepo.updateRecipientStatus.mockResolvedValue(ok(undefined))
  broadcastRepo.countPendingRecipients.mockResolvedValue(ok(3))
  send.text.mockResolvedValue(ok({ providerMessageId: 'wamid.1' }))
})

describe('sendToRecipient() with a blocked contact (zap-block-contacts)', () => {
  it('skips the blocked recipient with the reason and keeps the list going', async () => {
    blocks.findActive.mockResolvedValueOnce(
      ok({ id: 'blk1' } as never),
    )
    const outcome = expectOk(
      await WhatsAppBroadcastService.sendToRecipient('list1', 'r1'),
    )
    expect(outcome).toEqual({ status: 'skipped', reason: 'blocked' })
    expect(blocks.findActive).toHaveBeenCalledWith('conn1', [
      '5511988887777',
      '551188887777',
    ])
    expect(broadcastRepo.updateRecipientStatus).toHaveBeenCalledWith('r1', {
      status: 'SKIPPED',
      errorMessage: 'Contato bloqueado neste número',
    })
    expect(send.text).not.toHaveBeenCalled()
    expect(broadcastRepo.countPendingRecipients).toHaveBeenCalledWith('list1')
  })

  it('sends to a recipient who is not blocked', async () => {
    const outcome = expectOk(
      await WhatsAppBroadcastService.sendToRecipient('list1', 'r1'),
    )
    expect(outcome).toEqual({ status: 'sent', providerMessageId: 'wamid.1' })
  })

  it('records a block that raced the check as a failed recipient', async () => {
    send.text.mockResolvedValue(err(whatsappContactBlocked()))
    const outcome = expectOk(
      await WhatsAppBroadcastService.sendToRecipient('list1', 'r1'),
    )
    expect(outcome).toEqual({
      status: 'failed',
      reason: 'WHATSAPP_CONTACT_BLOCKED',
    })
    expect(broadcastRepo.updateRecipientStatus).toHaveBeenCalledWith('r1', {
      status: 'FAILED',
      errorMessage: expect.stringContaining('bloqueado'),
    })
  })

  it('propagates a failed block lookup or skip', async () => {
    blocks.findActive.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await WhatsAppBroadcastService.sendToRecipient('list1', 'r1'),
      'DATABASE_ERROR',
    )

    blocks.findActive.mockResolvedValueOnce(ok({ id: 'blk1' } as never))
    broadcastRepo.updateRecipientStatus.mockResolvedValueOnce(
      err(databaseError()),
    )
    expectErr(
      await WhatsAppBroadcastService.sendToRecipient('list1', 'r1'),
      'DATABASE_ERROR',
    )
  })
})
