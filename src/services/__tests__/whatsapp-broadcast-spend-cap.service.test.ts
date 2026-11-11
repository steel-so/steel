import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createFakeWhatsAppBroadcastList,
  createFakeWhatsAppBroadcastRecipient,
} from '@/src/__tests__/factories/whatsapp-broadcast.factory'
import { createFakeWhatsAppConnection } from '@/src/__tests__/factories/whatsapp-connection.factory'
import { createFakeWhatsAppContact } from '@/src/__tests__/factories/whatsapp-contact.factory'
import { createFakeWhatsAppTemplate } from '@/src/__tests__/factories/whatsapp-template.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError, whatsappSpendCapReached } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/repositories/whatsapp-connection.repository')
vi.mock('@/src/repositories/whatsapp-broadcast.repository')
vi.mock('@/src/repositories/whatsapp-template.repository')
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

import { logger } from '@/lib/axiom/logger'
import { WhatsAppSend } from '@/src/lib/whatsapp/send'
import { WhatsAppBroadcastRepository } from '@/src/repositories/whatsapp-broadcast.repository'
import { WhatsAppConnectionRepository } from '@/src/repositories/whatsapp-connection.repository'
import { WhatsAppTemplateRepository } from '@/src/repositories/whatsapp-template.repository'
import { WhatsAppBroadcastService } from '../whatsapp-broadcast.service'

const broadcastRepo = vi.mocked(WhatsAppBroadcastRepository)
const send = vi.mocked(WhatsAppSend)

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
        templateId: 'tpl1',
        status: 'RUNNING',
      }),
    }),
  )
  // Z-API keeps the test away from the Meta-only extras (Flows, Lite); the
  // service only looks at the error code.
  vi.mocked(WhatsAppConnectionRepository.findById).mockResolvedValue(
    ok(createFakeWhatsAppConnection({ id: 'conn1', provider: 'ZAPI' })),
  )
  vi.mocked(WhatsAppTemplateRepository.findById).mockResolvedValue(
    ok(createFakeWhatsAppTemplate({ id: 'tpl1', category: 'MARKETING' })),
  )
  broadcastRepo.failPendingRecipients.mockResolvedValue(ok(41))
  broadcastRepo.updateRecipientStatus.mockResolvedValue(ok(undefined))
  broadcastRepo.countPendingRecipients.mockResolvedValue(ok(0))
  broadcastRepo.countRecipientsByStatus.mockResolvedValue(
    ok({ PENDING: 0, SENT: 9, FAILED: 41, SKIPPED: 0, SKIPPED_NO_WHATSAPP: 0 }),
  )
  broadcastRepo.closeIfRunning.mockResolvedValue(
    ok(createFakeWhatsAppBroadcastList({ id: 'list1' })),
  )
  send.template.mockResolvedValue(err(whatsappSpendCapReached(1500, 1499.9)))
})

describe('sendToRecipient() with the spending cap (zap-spend-cap)', () => {
  it('fails every pending recipient with the cap reason and closes the list', async () => {
    const outcome = expectOk(
      await WhatsAppBroadcastService.sendToRecipient('list1', 'r1'),
    )

    expect(outcome).toEqual({
      status: 'failed',
      reason: 'WHATSAPP_SPEND_CAP_REACHED',
    })
    expect(broadcastRepo.failPendingRecipients).toHaveBeenCalledWith(
      'list1',
      expect.stringContaining('limite de gasto mensal'),
    )
    expect(broadcastRepo.updateRecipientStatus).not.toHaveBeenCalled()
    expect(broadcastRepo.closeIfRunning).toHaveBeenCalledWith('list1', 'DONE')
    expect(logger.warn).toHaveBeenCalledWith(
      'whatsapp.broadcast.spend_cap_reached',
      expect.objectContaining({ recipients: 41 }),
    )
  })

  it('propagates a failure stopping the recipients', async () => {
    broadcastRepo.failPendingRecipients.mockResolvedValue(
      err(databaseError('x')),
    )
    expectErr(
      await WhatsAppBroadcastService.sendToRecipient('list1', 'r1'),
      'DATABASE_ERROR',
    )
  })
})
