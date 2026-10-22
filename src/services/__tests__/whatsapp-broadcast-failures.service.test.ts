import type { WhatsAppBroadcastList } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import {
  createFakeWhatsAppBroadcastList,
  createFakeWhatsAppBroadcastListWithCounts,
  createFakeWhatsAppBroadcastListWithRecipients,
  createFakeWhatsAppBroadcastRecipient,
} from '@/src/__tests__/factories/whatsapp-broadcast.factory'
import { createFakeWhatsAppConnection } from '@/src/__tests__/factories/whatsapp-connection.factory'
import { createFakeWhatsAppContact } from '@/src/__tests__/factories/whatsapp-contact.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import type { AppError } from '@/src/errors/app-error'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/services/feature-flag.service')
vi.mock('@/src/repositories/whatsapp-connection.repository')
vi.mock('@/src/repositories/whatsapp-broadcast.repository')
vi.mock('@/src/repositories/whatsapp-contact.repository')
vi.mock('@/src/repositories/whatsapp-template.repository')
vi.mock('@/src/lib/whatsapp/send', () => ({
  WhatsAppSend: { text: vi.fn(), media: vi.fn(), template: vi.fn() },
}))
vi.mock('@/lib/axiom/audit', () => ({ auditMutation: vi.fn() }))
vi.mock('@/src/services/whatsapp-notify', () => ({
  notifyWhatsAppUsers: vi.fn(async () => 1),
}))
vi.mock('@/lib/axiom/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}))

const { addBulk } = vi.hoisted(() => ({
  addBulk: vi.fn(async (_jobs: unknown[]) => []),
}))
vi.mock('@/src/lib/queue/queues', () => ({
  getWhatsappBroadcastQueue: vi.fn(() => ({ addBulk })),
}))

import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import { WhatsAppSend } from '@/src/lib/whatsapp/send'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { WhatsAppBroadcastRepository } from '@/src/repositories/whatsapp-broadcast.repository'
import { WhatsAppConnectionRepository } from '@/src/repositories/whatsapp-connection.repository'
import { WhatsAppContactRepository } from '@/src/repositories/whatsapp-contact.repository'
import { WhatsAppTemplateRepository } from '@/src/repositories/whatsapp-template.repository'
import { assertFeature } from '../feature-flag.service'
import { WhatsAppBroadcastService } from '../whatsapp-broadcast.service'

const mockedMembershipRepo = vi.mocked(MembershipRepository)
const mockedConnectionRepo = vi.mocked(WhatsAppConnectionRepository)
const mockedBroadcastRepo = vi.mocked(WhatsAppBroadcastRepository)
const mockedContactRepo = vi.mocked(WhatsAppContactRepository)
const mockedTemplateRepo = vi.mocked(WhatsAppTemplateRepository)
const mockedSend = vi.mocked(WhatsAppSend)

const DB_ERROR: AppError = { code: 'DATABASE_ERROR', message: 'db down' }

beforeEach(() => {
  vi.mocked(assertFeature).mockResolvedValue(ok(true))
})

function asAdmin() {
  mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
    ok(createFakeMembership({ role: 'ADMIN' })),
  )
}

function asNonMember() {
  mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(ok(null))
}

describe('WhatsAppBroadcastService reads', () => {
  it('list() should map the workspace broadcasts', async () => {
    asAdmin()
    mockedBroadcastRepo.listByWorkspace.mockResolvedValue(
      ok([createFakeWhatsAppBroadcastListWithCounts({ id: 'b1' })]),
    )

    const lists = expectOk(await WhatsAppBroadcastService.list('u1', 'ws1'))

    expect(lists.map((l) => l.id)).toEqual(['b1'])
  })

  it('list() should propagate a repository failure', async () => {
    asAdmin()
    mockedBroadcastRepo.listByWorkspace.mockResolvedValue(err(DB_ERROR))

    expectErr(
      await WhatsAppBroadcastService.list('u1', 'ws1'),
      'DATABASE_ERROR',
    )
  })

  it('get() should return the broadcast detail', async () => {
    asAdmin()
    mockedBroadcastRepo.findById.mockResolvedValue(
      ok(createFakeWhatsAppBroadcastListWithRecipients({ id: 'b1' }, 2)),
    )

    const detail = expectOk(
      await WhatsAppBroadcastService.get('u1', 'ws1', 'b1'),
    )

    expect(detail.id).toBe('b1')
    expect(mockedBroadcastRepo.findById).toHaveBeenCalledWith('b1', 'ws1')
  })

  it('get() should return FORBIDDEN for a non-member', async () => {
    asNonMember()

    expectErr(
      await WhatsAppBroadcastService.get('u1', 'ws1', 'b1'),
      'FORBIDDEN',
    )
  })

  it('get() should propagate a repository failure', async () => {
    asAdmin()
    mockedBroadcastRepo.findById.mockResolvedValue(err(DB_ERROR))

    expectErr(
      await WhatsAppBroadcastService.get('u1', 'ws1', 'b1'),
      'DATABASE_ERROR',
    )
  })

  it('get() should return WHATSAPP_BROADCAST_NOT_FOUND when missing', async () => {
    asAdmin()
    mockedBroadcastRepo.findById.mockResolvedValue(ok(null))

    expectErr(
      await WhatsAppBroadcastService.get('u1', 'ws1', 'b1'),
      'WHATSAPP_BROADCAST_NOT_FOUND',
    )
  })
})

describe('WhatsAppBroadcastService.create() failures', () => {
  const dto = {
    connectionId: 'conn1',
    name: 'Promoção',
    messageBody: 'Aproveite!',
    contactIds: ['c1'],
  }

  function arrangeCreate() {
    asAdmin()
    mockedConnectionRepo.findById.mockResolvedValue(
      ok(createFakeWhatsAppConnection({ id: 'conn1' })),
    )
    mockedContactRepo.listBroadcastEligibleIds.mockResolvedValue(ok(['c1']))
    mockedBroadcastRepo.create.mockResolvedValue(
      ok(createFakeWhatsAppBroadcastListWithRecipients({ id: 'b1' }, 1)),
    )
  }

  it('should propagate a connection lookup failure', async () => {
    arrangeCreate()
    mockedConnectionRepo.findById.mockResolvedValue(err(DB_ERROR))

    expectErr(
      await WhatsAppBroadcastService.create('u1', 'ws1', dto),
      'DATABASE_ERROR',
    )
  })

  it('should propagate an eligibility lookup failure', async () => {
    arrangeCreate()
    mockedContactRepo.listBroadcastEligibleIds.mockResolvedValue(err(DB_ERROR))

    expectErr(
      await WhatsAppBroadcastService.create('u1', 'ws1', dto),
      'DATABASE_ERROR',
    )
  })

  it('should infer the media kind from the URL and store null metadata', async () => {
    arrangeCreate()

    expectOk(
      await WhatsAppBroadcastService.create('u1', 'ws1', {
        ...dto,
        mediaUrl: 'https://cdn.example.com/folheto.pdf',
      }),
    )

    expect(mockedBroadcastRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        mediaType: 'DOCUMENT',
        mediaMimeType: null,
        mediaFileName: null,
      }),
      ['c1'],
    )
  })

  it('should propagate a create failure', async () => {
    arrangeCreate()
    mockedBroadcastRepo.create.mockResolvedValue(err(DB_ERROR))

    expectErr(
      await WhatsAppBroadcastService.create('u1', 'ws1', dto),
      'DATABASE_ERROR',
    )
    expect(auditMutation).not.toHaveBeenCalled()
  })
})

describe('WhatsAppBroadcastService.start() failures', () => {
  function draft(recipientCount = 1) {
    return createFakeWhatsAppBroadcastListWithRecipients(
      { id: 'b1', status: 'DRAFT' },
      recipientCount,
    )
  }

  function arrangeStart(list = draft()) {
    asAdmin()
    mockedBroadcastRepo.findById.mockResolvedValue(ok(list))
    mockedBroadcastRepo.markRecipientsSkipped.mockResolvedValue(ok(1))
    mockedBroadcastRepo.updateStatus.mockResolvedValue(ok(undefined))
    return list
  }

  it('should return FORBIDDEN for a non-member', async () => {
    asNonMember()

    expectErr(
      await WhatsAppBroadcastService.start('u1', 'ws1', 'b1'),
      'FORBIDDEN',
    )
  })

  it('should propagate a lookup failure', async () => {
    arrangeStart()
    mockedBroadcastRepo.findById.mockResolvedValue(err(DB_ERROR))

    expectErr(
      await WhatsAppBroadcastService.start('u1', 'ws1', 'b1'),
      'DATABASE_ERROR',
    )
  })

  it('should return WHATSAPP_BROADCAST_NOT_FOUND when missing', async () => {
    arrangeStart()
    mockedBroadcastRepo.findById.mockResolvedValue(ok(null))

    expectErr(
      await WhatsAppBroadcastService.start('u1', 'ws1', 'b1'),
      'WHATSAPP_BROADCAST_NOT_FOUND',
    )
  })

  it('should propagate a failure skipping opted-out recipients', async () => {
    const list = draft(1)
    list.recipients[0].contact.broadcastOptedOutAt = new Date()
    arrangeStart(list)
    mockedBroadcastRepo.markRecipientsSkipped.mockResolvedValue(err(DB_ERROR))

    expectErr(
      await WhatsAppBroadcastService.start('u1', 'ws1', 'b1'),
      'DATABASE_ERROR',
    )
    expect(addBulk).not.toHaveBeenCalled()
  })

  it('should finish immediately as DONE when every recipient opted out', async () => {
    const list = draft(2)
    for (const recipient of list.recipients) {
      recipient.contact.broadcastOptedOutAt = new Date()
    }
    arrangeStart(list)

    expectOk(await WhatsAppBroadcastService.start('u1', 'ws1', 'b1'))

    expect(addBulk).toHaveBeenCalledWith([])
    expect(mockedBroadcastRepo.updateStatus).toHaveBeenCalledWith('b1', 'DONE')
    expect(auditMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'start',
        meta: { recipients: 0, skipped: 2, skippedNoWhatsapp: 0 },
      }),
    )
  })

  it('should propagate a status update failure', async () => {
    arrangeStart()
    mockedBroadcastRepo.updateStatus.mockResolvedValue(err(DB_ERROR))

    expectErr(
      await WhatsAppBroadcastService.start('u1', 'ws1', 'b1'),
      'DATABASE_ERROR',
    )
  })

  it('should propagate a failure reloading the started broadcast', async () => {
    const list = arrangeStart()
    mockedBroadcastRepo.findById
      .mockResolvedValueOnce(ok(list))
      .mockResolvedValueOnce(err(DB_ERROR))

    expectErr(
      await WhatsAppBroadcastService.start('u1', 'ws1', 'b1'),
      'DATABASE_ERROR',
    )
  })

  it('should return WHATSAPP_BROADCAST_NOT_FOUND when the reload finds nothing', async () => {
    const list = arrangeStart()
    mockedBroadcastRepo.findById
      .mockResolvedValueOnce(ok(list))
      .mockResolvedValueOnce(ok(null))

    expectErr(
      await WhatsAppBroadcastService.start('u1', 'ws1', 'b1'),
      'WHATSAPP_BROADCAST_NOT_FOUND',
    )
  })
})

describe('WhatsAppBroadcastService.sendToRecipient() failures', () => {
  function arrangeRecipient(options?: {
    list?: Partial<WhatsAppBroadcastList>
    optedOut?: boolean
  }) {
    const list = createFakeWhatsAppBroadcastList({
      id: 'list1',
      workspaceId: 'ws1',
      connectionId: 'conn1',
      status: 'RUNNING',
      ...options?.list,
    })
    mockedBroadcastRepo.findRecipientById.mockResolvedValue(
      ok({
        ...createFakeWhatsAppBroadcastRecipient({
          id: 'r1',
          broadcastListId: 'list1',
          status: 'PENDING',
        }),
        contact: createFakeWhatsAppContact({
          waId: '5511988887777',
          broadcastOptedOutAt: options?.optedOut ? new Date() : null,
        }),
        broadcastList: list,
      }),
    )
    mockedConnectionRepo.findById.mockResolvedValue(
      ok(createFakeWhatsAppConnection({ id: 'conn1' })),
    )
    mockedBroadcastRepo.updateRecipientStatus.mockResolvedValue(ok(undefined))
    mockedBroadcastRepo.markRecipientsSkipped.mockResolvedValue(ok(1))
    mockedBroadcastRepo.countPendingRecipients.mockResolvedValue(ok(0))
    mockedBroadcastRepo.countRecipientsByStatus.mockResolvedValue(
      ok({
        PENDING: 0,
        SENT: 1,
        FAILED: 0,
        SKIPPED: 0,
        SKIPPED_NO_WHATSAPP: 0,
      }),
    )
    mockedBroadcastRepo.closeIfRunning.mockResolvedValue(
      ok(createFakeWhatsAppBroadcastList({ id: 'list1' })),
    )
  }

  const send = () => WhatsAppBroadcastService.sendToRecipient('list1', 'r1')

  it('should propagate a failure skipping an opted-out recipient', async () => {
    arrangeRecipient({ optedOut: true })
    mockedBroadcastRepo.markRecipientsSkipped.mockResolvedValue(err(DB_ERROR))

    expectErr(await send(), 'DATABASE_ERROR')
    expect(mockedBroadcastRepo.closeIfRunning).not.toHaveBeenCalled()
  })

  it('should propagate a connection lookup failure', async () => {
    arrangeRecipient()
    mockedConnectionRepo.findById.mockResolvedValue(err(DB_ERROR))

    expectErr(await send(), 'DATABASE_ERROR')
  })

  it('should propagate a failure flagging a recipient whose connection vanished', async () => {
    arrangeRecipient()
    mockedConnectionRepo.findById.mockResolvedValue(ok(null))
    mockedBroadcastRepo.updateRecipientStatus.mockResolvedValue(err(DB_ERROR))

    expectErr(await send(), 'DATABASE_ERROR')
  })

  it('should propagate a template lookup failure', async () => {
    arrangeRecipient({ list: { templateId: 't1' } })
    mockedTemplateRepo.findById.mockResolvedValue(err(DB_ERROR))

    expectErr(await send(), 'DATABASE_ERROR')
  })

  it('should propagate a failure flagging a recipient whose template vanished', async () => {
    arrangeRecipient({ list: { templateId: 't1' } })
    mockedTemplateRepo.findById.mockResolvedValue(ok(null))
    mockedBroadcastRepo.updateRecipientStatus.mockResolvedValue(err(DB_ERROR))

    expectErr(await send(), 'DATABASE_ERROR')
  })

  it('should log but still report sent when recording the delivery fails', async () => {
    arrangeRecipient()
    mockedSend.text.mockResolvedValue(ok({ providerMessageId: 'wamid-1' }))
    mockedBroadcastRepo.updateRecipientStatus.mockResolvedValue(err(DB_ERROR))

    expect(expectOk(await send())).toEqual({
      status: 'sent',
      providerMessageId: 'wamid-1',
    })
    expect(logger.error).toHaveBeenCalledWith(
      'whatsapp.broadcast.recipient_status_update_failed',
      expect.objectContaining({ recipientId: 'r1', reason: 'DATABASE_ERROR' }),
    )
  })

  it('should keep the list open when closing it fails', async () => {
    arrangeRecipient()
    mockedSend.text.mockResolvedValue(ok({ providerMessageId: 'wamid-1' }))
    mockedBroadcastRepo.closeIfRunning.mockResolvedValue(err(DB_ERROR))

    expectOk(await send())

    expect(auditMutation).not.toHaveBeenCalled()
  })

  it('should send media without a hint as an image', async () => {
    arrangeRecipient({
      list: {
        mediaUrl: 'https://cdn.example.com/media/abc',
        mediaType: null,
        mediaMimeType: null,
        mediaFileName: null,
      },
    })
    mockedSend.media.mockResolvedValue(ok({ providerMessageId: 'wamid-2' }))

    expectOk(await send())

    expect(mockedSend.media).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        type: 'image',
        caption: 'Aproveite nossas ofertas!',
      }),
      { cost: expect.objectContaining({ source: 'BROADCAST' }) },
    )
  })

  it('should still report the audio as sent when its follow-up text fails', async () => {
    arrangeRecipient({
      list: {
        mediaUrl: 'https://cdn.example.com/a.ogg',
        mediaType: 'AUDIO',
        messageBody: 'Ouça a novidade',
      },
    })
    mockedSend.media.mockResolvedValue(ok({ providerMessageId: 'wamid-3' }))
    mockedSend.text.mockResolvedValue(
      err({ code: 'WHATSAPP_PROVIDER_ERROR', message: 'offline' }),
    )

    expect(expectOk(await send())).toEqual({
      status: 'sent',
      providerMessageId: 'wamid-3',
    })
    expect(logger.warn).toHaveBeenCalledWith(
      'whatsapp.broadcast.audio_caption_failed',
      expect.objectContaining({ reason: 'WHATSAPP_PROVIDER_ERROR' }),
    )
  })
})
