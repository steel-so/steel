import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import {
  createFakeWhatsAppBroadcastList,
  createFakeWhatsAppBroadcastListWithRecipients,
  createFakeWhatsAppBroadcastRecipient,
} from '@/src/__tests__/factories/whatsapp-broadcast.factory'
import { createFakeWhatsAppConnection } from '@/src/__tests__/factories/whatsapp-connection.factory'
import { createFakeWhatsAppContact } from '@/src/__tests__/factories/whatsapp-contact.factory'
import { createFakeWhatsAppTemplate } from '@/src/__tests__/factories/whatsapp-template.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { ok } from '@/src/lib/result'

vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/services/feature-flag.service')
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
vi.mock('@/src/services/whatsapp-contact-block.service', () => ({
  CONTACT_BLOCKED_SKIP: 'blocked',
  WhatsAppContactBlockService: { isBlocked: vi.fn(async () => ok(false)) },
}))
vi.mock('@/src/services/whatsapp-flow-dispatch.service', () => ({
  WhatsAppFlowDispatchService: {
    prepareTemplateButton: vi.fn(async () => ok(null)),
    recordSent: vi.fn(async () => undefined),
  },
}))

const { addBulk, numberQuality } = vi.hoisted(() => ({
  addBulk: vi.fn(async (_jobs: unknown[]) => []),
  numberQuality: vi.fn(),
}))
vi.mock('@/src/lib/queue/queues', () => ({
  getWhatsappBroadcastQueue: vi.fn(() => ({ addBulk })),
}))
vi.mock('@/src/lib/whatsapp/meta-number-quality', () => ({
  metaNumberQualityOf: numberQuality,
}))

import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import { WhatsAppSend } from '@/src/lib/whatsapp/send'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { WhatsAppBroadcastRepository } from '@/src/repositories/whatsapp-broadcast.repository'
import { WhatsAppConnectionRepository } from '@/src/repositories/whatsapp-connection.repository'
import { WhatsAppTemplateRepository } from '@/src/repositories/whatsapp-template.repository'
import { assertFeature } from '../feature-flag.service'
import { WhatsAppBroadcastService } from '../whatsapp-broadcast.service'
import { notifyWhatsAppUsers } from '../whatsapp-notify'

const broadcastRepo = vi.mocked(WhatsAppBroadcastRepository)
const connectionRepo = vi.mocked(WhatsAppConnectionRepository)
const templateRepo = vi.mocked(WhatsAppTemplateRepository)
const send = vi.mocked(WhatsAppSend)

const QUALITY_PREFIX = 'Envios bloqueados pela qualidade:'

function metaConnection() {
  return createFakeWhatsAppConnection({ id: 'conn1', provider: 'META' })
}

function template(overrides = {}) {
  return createFakeWhatsAppTemplate({
    id: 'tpl1',
    name: 'cobranca',
    category: 'UTILITY',
    quality: 'GREEN',
    ...overrides,
  })
}

function recipientFor(listOverrides = {}) {
  return ok({
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
      ...listOverrides,
    }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  numberQuality.mockResolvedValue('GREEN')
  vi.mocked(assertFeature).mockResolvedValue(ok(true))
  vi.mocked(MembershipRepository.findByUserAndWorkspace).mockResolvedValue(
    ok(createFakeMembership({ role: 'ADMIN' })),
  )
  broadcastRepo.findRecipientById.mockResolvedValue(recipientFor())
  connectionRepo.findById.mockResolvedValue(ok(metaConnection()))
  templateRepo.findById.mockResolvedValue(ok(template()))
  broadcastRepo.updateRecipientStatus.mockResolvedValue(ok(undefined))
  broadcastRepo.countPendingRecipients.mockResolvedValue(ok(5))
  broadcastRepo.pauseIfActive.mockImplementation(async (id, reason) =>
    ok(
      createFakeWhatsAppBroadcastList({
        id,
        status: 'PAUSED',
        pausedReason: reason,
      }),
    ),
  )
  send.template.mockResolvedValue(ok({ providerMessageId: 'wamid.1' }))
  send.text.mockResolvedValue(ok({ providerMessageId: 'wamid.2' }))
  send.media.mockResolvedValue(ok({ providerMessageId: 'wamid.3' }))
})

describe('sendToRecipient() with the quality gate', () => {
  it('pauses the list when the number is RED and leaves the recipient PENDING', async () => {
    numberQuality.mockResolvedValue('RED')

    const outcome = expectOk(
      await WhatsAppBroadcastService.sendToRecipient('list1', 'r1'),
    )

    expect(outcome).toEqual({ status: 'paused', reason: 'quality_blocked' })
    expect(broadcastRepo.pauseIfActive).toHaveBeenCalledWith(
      'list1',
      expect.stringContaining(`${QUALITY_PREFIX} o número desta conexão`),
    )
    expect(send.template).not.toHaveBeenCalled()
    expect(broadcastRepo.updateRecipientStatus).not.toHaveBeenCalled()
    expect(broadcastRepo.closeIfRunning).not.toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalledWith(
      'whatsapp.broadcast.quality_blocked',
      expect.objectContaining({ broadcastListId: 'list1', subject: 'NUMBER' }),
    )
    expect(auditMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        targetId: 'list1',
        meta: expect.objectContaining({ status: 'PAUSED' }),
      }),
    )
    expect(notifyWhatsAppUsers).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Transmissão "Promoção de fim de ano" pausada',
      }),
    )
  })

  it('pauses the list when the template is RED and names it', async () => {
    templateRepo.findById.mockResolvedValue(ok(template({ quality: 'RED' })))

    const outcome = expectOk(
      await WhatsAppBroadcastService.sendToRecipient('list1', 'r1'),
    )

    expect(outcome).toEqual({ status: 'paused', reason: 'quality_blocked' })
    expect(broadcastRepo.pauseIfActive).toHaveBeenCalledWith(
      'list1',
      expect.stringContaining('o template "cobranca"'),
    )
    expect(send.template).not.toHaveBeenCalled()
  })

  it('does not notify again when another job already paused the list', async () => {
    numberQuality.mockResolvedValue('RED')
    broadcastRepo.pauseIfActive.mockResolvedValue(ok(null))

    expect(
      expectOk(await WhatsAppBroadcastService.sendToRecipient('list1', 'r1')),
    ).toEqual({ status: 'paused', reason: 'quality_blocked' })
    expect(notifyWhatsAppUsers).not.toHaveBeenCalled()
    expect(auditMutation).not.toHaveBeenCalled()
  })

  it('does nothing for the next jobs of an already paused list', async () => {
    broadcastRepo.findRecipientById.mockResolvedValue(
      recipientFor({ status: 'PAUSED' }),
    )

    expect(
      expectOk(await WhatsAppBroadcastService.sendToRecipient('list1', 'r1')),
    ).toEqual({ status: 'paused', reason: 'list_paused' })
    expect(connectionRepo.findById).not.toHaveBeenCalled()
    expect(send.template).not.toHaveBeenCalled()
    expect(broadcastRepo.updateRecipientStatus).not.toHaveBeenCalled()
  })

  it.each(['GREEN', 'YELLOW', 'UNKNOWN'] as const)(
    'sends when the number is %s',
    async (quality) => {
      numberQuality.mockResolvedValue(quality)

      expect(
        expectOk(await WhatsAppBroadcastService.sendToRecipient('list1', 'r1'))
          .status,
      ).toBe('sent')
      expect(send.template).toHaveBeenCalledTimes(1)
      expect(broadcastRepo.pauseIfActive).not.toHaveBeenCalled()
    },
  )

  it.each(['YELLOW', 'UNKNOWN', 'GREEN'] as const)(
    'sends when the template is %s',
    async (quality) => {
      templateRepo.findById.mockResolvedValue(ok(template({ quality })))

      expect(
        expectOk(await WhatsAppBroadcastService.sendToRecipient('list1', 'r1'))
          .status,
      ).toBe('sent')
    },
  )

  it('never gates a non-Meta connection', async () => {
    numberQuality.mockResolvedValue('RED')
    connectionRepo.findById.mockResolvedValue(
      ok(createFakeWhatsAppConnection({ id: 'conn1', provider: 'ZAPI' })),
    )
    templateRepo.findById.mockResolvedValue(ok(template({ quality: 'RED' })))

    expect(
      expectOk(await WhatsAppBroadcastService.sendToRecipient('list1', 'r1'))
        .status,
    ).toBe('sent')
    expect(numberQuality).not.toHaveBeenCalled()
  })

  it('does not gate a text-only broadcast even with a RED number', async () => {
    numberQuality.mockResolvedValue('RED')
    broadcastRepo.findRecipientById.mockResolvedValue(
      recipientFor({ templateId: null }),
    )

    expect(
      expectOk(await WhatsAppBroadcastService.sendToRecipient('list1', 'r1'))
        .status,
    ).toBe('sent')
    expect(send.text).toHaveBeenCalledTimes(1)
    expect(numberQuality).not.toHaveBeenCalled()
    expect(broadcastRepo.pauseIfActive).not.toHaveBeenCalled()
  })

  it('does not gate a media broadcast even with a RED number', async () => {
    numberQuality.mockResolvedValue('RED')
    broadcastRepo.findRecipientById.mockResolvedValue(
      recipientFor({
        templateId: null,
        mediaUrl: 'https://cdn.test/promo.jpg',
        mediaType: 'IMAGE',
      }),
    )

    expect(
      expectOk(await WhatsAppBroadcastService.sendToRecipient('list1', 'r1'))
        .status,
    ).toBe('sent')
    expect(send.media).toHaveBeenCalledTimes(1)
    expect(numberQuality).not.toHaveBeenCalled()
  })
})

describe('start() with the quality gate', () => {
  function draft(overrides = {}) {
    return createFakeWhatsAppBroadcastListWithRecipients(
      {
        id: 'b1',
        workspaceId: 'ws1',
        connectionId: 'conn1',
        templateId: 'tpl1',
        status: 'DRAFT',
        ...overrides,
      },
      2,
    )
  }

  it('refuses to start while the number is RED', async () => {
    numberQuality.mockResolvedValue('RED')
    broadcastRepo.findById.mockResolvedValue(ok(draft()))

    const error = expectErr(
      await WhatsAppBroadcastService.start('u1', 'ws1', 'b1'),
      'WHATSAPP_QUALITY_BLOCKED',
    )

    expect(error.message).toContain(QUALITY_PREFIX)
    expect(error.message).toContain('as transmissões ficam bloqueadas')
    expect(error.message).toContain('continue a transmissão')
    expect(addBulk).not.toHaveBeenCalled()
    expect(broadcastRepo.updateStatus).not.toHaveBeenCalled()
  })

  it('refuses to start while the template is RED', async () => {
    templateRepo.findById.mockResolvedValue(ok(template({ quality: 'RED' })))
    broadcastRepo.findById.mockResolvedValue(ok(draft()))

    const error = expectErr(
      await WhatsAppBroadcastService.start('u1', 'ws1', 'b1'),
      'WHATSAPP_QUALITY_BLOCKED',
    )

    expect(error.message).toContain('o template "cobranca"')
    expect(error.message).toContain('troque o template da transmissão')
    expect(addBulk).not.toHaveBeenCalled()
  })

  it.each(['GREEN', 'YELLOW', 'UNKNOWN'] as const)(
    'starts when the number is %s',
    async (quality) => {
      numberQuality.mockResolvedValue(quality)
      broadcastRepo.findById.mockResolvedValue(ok(draft()))
      broadcastRepo.updateStatus.mockResolvedValue(ok(undefined))

      expectOk(await WhatsAppBroadcastService.start('u1', 'ws1', 'b1'))
      expect(addBulk).toHaveBeenCalledTimes(1)
    },
  )

  it('starts a text-only broadcast with a RED number', async () => {
    numberQuality.mockResolvedValue('RED')
    broadcastRepo.findById.mockResolvedValue(ok(draft({ templateId: null })))
    broadcastRepo.updateStatus.mockResolvedValue(ok(undefined))

    expectOk(await WhatsAppBroadcastService.start('u1', 'ws1', 'b1'))
    expect(connectionRepo.findById).not.toHaveBeenCalled()
    expect(addBulk).toHaveBeenCalledTimes(1)
  })

  it('starts on a non-Meta connection', async () => {
    numberQuality.mockResolvedValue('RED')
    connectionRepo.findById.mockResolvedValue(
      ok(createFakeWhatsAppConnection({ id: 'conn1', provider: 'ZAPI' })),
    )
    broadcastRepo.findById.mockResolvedValue(ok(draft()))
    broadcastRepo.updateStatus.mockResolvedValue(ok(undefined))

    expectOk(await WhatsAppBroadcastService.start('u1', 'ws1', 'b1'))
    expect(numberQuality).not.toHaveBeenCalled()
  })
})

describe('retryFailed() with the quality gate', () => {
  it('refuses to resend while the number is RED', async () => {
    numberQuality.mockResolvedValue('RED')
    broadcastRepo.findById.mockResolvedValue(
      ok(
        createFakeWhatsAppBroadcastListWithRecipients({
          id: 'b1',
          connectionId: 'conn1',
          templateId: 'tpl1',
          status: 'DONE',
        }),
      ),
    )

    expectErr(
      await WhatsAppBroadcastService.retryFailed('u1', 'ws1', 'b1'),
      'WHATSAPP_QUALITY_BLOCKED',
    )
    expect(broadcastRepo.resetFailedRecipients).not.toHaveBeenCalled()
    expect(addBulk).not.toHaveBeenCalled()
  })
})

describe('resume()', () => {
  function paused(overrides = {}, recipients = 3) {
    const list = createFakeWhatsAppBroadcastListWithRecipients(
      {
        id: 'b1',
        workspaceId: 'ws1',
        connectionId: 'conn1',
        templateId: 'tpl1',
        status: 'PAUSED',
        pausedReason: `${QUALITY_PREFIX} o número`,
        ...overrides,
      },
      recipients,
    )
    for (const recipient of list.recipients) recipient.status = 'PENDING'
    return list
  }

  beforeEach(() => {
    broadcastRepo.resumePaused.mockResolvedValue(
      ok(createFakeWhatsAppBroadcastList({ id: 'b1', status: 'RUNNING' })),
    )
  })

  it('stays paused while the quality is still RED', async () => {
    numberQuality.mockResolvedValue('RED')
    broadcastRepo.findById.mockResolvedValue(ok(paused()))

    expectErr(
      await WhatsAppBroadcastService.resume('u1', 'ws1', 'b1'),
      'WHATSAPP_QUALITY_BLOCKED',
    )
    expect(broadcastRepo.resumePaused).not.toHaveBeenCalled()
    expect(addBulk).not.toHaveBeenCalled()
  })

  it('queues only the PENDING recipients again and goes back to RUNNING', async () => {
    const list = paused({}, 3)
    list.recipients[0].status = 'SENT'
    broadcastRepo.findById.mockResolvedValue(ok(list))

    expectOk(await WhatsAppBroadcastService.resume('u1', 'ws1', 'b1'))

    expect(broadcastRepo.resumePaused).toHaveBeenCalledWith('b1', 'RUNNING')
    const jobs = addBulk.mock.calls[0][0] as {
      data: { recipientId: string }
    }[]
    expect(jobs.map((job) => job.data.recipientId)).toEqual([
      list.recipients[1].id,
      list.recipients[2].id,
    ])
    expect(auditMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        meta: expect.objectContaining({ resumed: true, status: 'RUNNING' }),
      }),
    )
  })

  it('puts a scheduled (CSV) list back to QUEUED for the schedule tick', async () => {
    const list = paused()
    for (const recipient of list.recipients) {
      recipient.scheduledAt = new Date('2026-12-01T10:00:00Z')
    }
    broadcastRepo.findById.mockResolvedValue(ok(list))

    expectOk(await WhatsAppBroadcastService.resume('u1', 'ws1', 'b1'))

    expect(broadcastRepo.resumePaused).toHaveBeenCalledWith('b1', 'QUEUED')
    expect(addBulk).not.toHaveBeenCalled()
  })

  it('closes the list when nothing is left pending', async () => {
    const list = paused({}, 2)
    for (const recipient of list.recipients) recipient.status = 'SENT'
    broadcastRepo.findById.mockResolvedValue(ok(list))
    broadcastRepo.countPendingRecipients.mockResolvedValue(ok(0))
    broadcastRepo.countRecipientsByStatus.mockResolvedValue(
      ok({
        PENDING: 0,
        SENT: 2,
        FAILED: 0,
        SKIPPED: 0,
        SKIPPED_NO_WHATSAPP: 0,
      }),
    )
    broadcastRepo.closeIfRunning.mockResolvedValue(ok(null))

    expectOk(await WhatsAppBroadcastService.resume('u1', 'ws1', 'b1'))
    expect(broadcastRepo.closeIfRunning).toHaveBeenCalledWith('b1', 'DONE')
  })

  it('refuses a list that is not paused', async () => {
    broadcastRepo.findById.mockResolvedValue(ok(paused({ status: 'RUNNING' })))

    expectErr(
      await WhatsAppBroadcastService.resume('u1', 'ws1', 'b1'),
      'WHATSAPP_BROADCAST_LOCKED',
    )
  })

  it('reports a lost race with another resume', async () => {
    broadcastRepo.findById.mockResolvedValue(ok(paused()))
    broadcastRepo.resumePaused.mockResolvedValue(ok(null))

    expectErr(
      await WhatsAppBroadcastService.resume('u1', 'ws1', 'b1'),
      'WHATSAPP_BROADCAST_LOCKED',
    )
    expect(addBulk).not.toHaveBeenCalled()
  })

  it('does not return a missing list', async () => {
    broadcastRepo.findById.mockResolvedValue(ok(null))

    expectErr(
      await WhatsAppBroadcastService.resume('u1', 'ws1', 'b1'),
      'WHATSAPP_BROADCAST_NOT_FOUND',
    )
  })
})

describe('cancel() of a paused list', () => {
  it('discards the pending recipients and closes the list', async () => {
    broadcastRepo.findById.mockResolvedValue(
      ok(
        createFakeWhatsAppBroadcastListWithRecipients({
          id: 'b1',
          status: 'PAUSED',
        }),
      ),
    )
    broadcastRepo.cancelPendingRecipients.mockResolvedValue(ok(3))
    broadcastRepo.updateStatus.mockResolvedValue(ok(undefined))

    expectOk(await WhatsAppBroadcastService.cancel('u1', 'ws1', 'b1'))
    expect(broadcastRepo.updateStatus).toHaveBeenCalledWith('b1', 'DONE')
  })
})
