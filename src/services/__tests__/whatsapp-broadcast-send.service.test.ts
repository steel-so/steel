import { describe, expect, it, vi } from 'vitest'
import {
  createFakeWhatsAppBroadcastList,
  createFakeWhatsAppBroadcastRecipient,
} from '@/src/__tests__/factories/whatsapp-broadcast.factory'
import { createFakeWhatsAppConnection } from '@/src/__tests__/factories/whatsapp-connection.factory'
import { createFakeWhatsAppContact } from '@/src/__tests__/factories/whatsapp-contact.factory'
import { createFakeWhatsAppTemplate } from '@/src/__tests__/factories/whatsapp-template.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/repositories/whatsapp-connection.repository')
vi.mock('@/src/repositories/whatsapp-broadcast.repository')
vi.mock('@/src/repositories/whatsapp-template.repository')
vi.mock('@/src/lib/whatsapp/send', () => ({
  WhatsAppSend: { text: vi.fn(), media: vi.fn(), template: vi.fn() },
}))
vi.mock('@/lib/axiom/audit', () => ({ auditMutation: vi.fn() }))
vi.mock('@/src/services/whatsapp-notify', () => ({
  notifyWhatsAppUsers: vi.fn(async () => 1),
}))

const { addBulk } = vi.hoisted(() => ({
  addBulk: vi.fn(async (_jobs: unknown[]) => []),
}))
vi.mock('@/src/lib/queue/queues', () => ({
  getWhatsappBroadcastQueue: vi.fn(() => ({ addBulk })),
}))

import type { WhatsAppBroadcastList } from '@prisma/client'
import { auditMutation } from '@/lib/axiom/audit'
import { databaseError, whatsappProviderError } from '@/src/errors'
import { WhatsAppSend } from '@/src/lib/whatsapp/send'
import { WhatsAppBroadcastRepository } from '@/src/repositories/whatsapp-broadcast.repository'
import { WhatsAppConnectionRepository } from '@/src/repositories/whatsapp-connection.repository'
import { WhatsAppTemplateRepository } from '@/src/repositories/whatsapp-template.repository'
import { WhatsAppBroadcastService } from '../whatsapp-broadcast.service'
import { notifyWhatsAppUsers } from '../whatsapp-notify'

const mockedBroadcastRepo = vi.mocked(WhatsAppBroadcastRepository)
const mockedConnectionRepo = vi.mocked(WhatsAppConnectionRepository)
const mockedTemplateRepo = vi.mocked(WhatsAppTemplateRepository)
const mockedSend = vi.mocked(WhatsAppSend)

function arrangeRecipient(options?: {
  list?: Partial<WhatsAppBroadcastList>
  optedOut?: boolean
  status?: 'PENDING' | 'SENT'
}) {
  const list = createFakeWhatsAppBroadcastList({
    id: 'list1',
    workspaceId: 'ws1',
    connectionId: 'conn1',
    status: 'RUNNING',
    ...options?.list,
  })
  const contact = createFakeWhatsAppContact({
    waId: '5511988887777',
    broadcastOptedOutAt: options?.optedOut ? new Date() : null,
  })
  mockedBroadcastRepo.findRecipientById.mockResolvedValue(
    ok({
      ...createFakeWhatsAppBroadcastRecipient({
        id: 'r1',
        broadcastListId: 'list1',
        status: options?.status ?? 'PENDING',
      }),
      contact,
      broadcastList: list,
    }),
  )
  const connection = createFakeWhatsAppConnection({ id: 'conn1' })
  mockedConnectionRepo.findById.mockResolvedValue(ok(connection))
  mockedBroadcastRepo.updateRecipientStatus.mockResolvedValue(ok(undefined))
  mockedBroadcastRepo.markRecipientsSkipped.mockResolvedValue(ok(1))
  mockedBroadcastRepo.countPendingRecipients.mockResolvedValue(ok(0))
  mockedBroadcastRepo.countRecipientsByStatus.mockResolvedValue(
    ok({ PENDING: 0, SENT: 1, FAILED: 0, SKIPPED: 0, SKIPPED_NO_WHATSAPP: 0 }),
  )
  mockedBroadcastRepo.closeIfRunning.mockResolvedValue(
    ok(createFakeWhatsAppBroadcastList({ id: 'list1' })),
  )
  return { connection }
}

describe('WhatsAppBroadcastService.sendToRecipient()', () => {
  it('should skip a missing recipient', async () => {
    mockedBroadcastRepo.findRecipientById.mockResolvedValue(ok(null))
    expect(
      expectOk(await WhatsAppBroadcastService.sendToRecipient('list1', 'r1')),
    ).toEqual({ status: 'skipped', reason: 'recipient_missing' })
  })

  it('should skip a recipient that is no longer PENDING', async () => {
    arrangeRecipient({ status: 'SENT' })
    expect(
      expectOk(await WhatsAppBroadcastService.sendToRecipient('list1', 'r1')),
    ).toEqual({ status: 'skipped', reason: 'not_pending' })
    expect(mockedSend.text).not.toHaveBeenCalled()
  })

  it('should skip a contact without WhatsApp when the list skips them', async () => {
    arrangeRecipient({ list: { skipNoWhatsapp: true } })
    mockedBroadcastRepo.findRecipientById.mockResolvedValue(
      ok({
        ...createFakeWhatsAppBroadcastRecipient({
          id: 'r1',
          broadcastListId: 'list1',
        }),
        contact: createFakeWhatsAppContact({ hasWhatsapp: false }),
        broadcastList: createFakeWhatsAppBroadcastList({
          id: 'list1',
          workspaceId: 'ws1',
          skipNoWhatsapp: true,
        }),
      }),
    )
    mockedBroadcastRepo.markRecipientNoWhatsapp.mockResolvedValue(ok(1))

    const outcome = expectOk(
      await WhatsAppBroadcastService.sendToRecipient('list1', 'r1'),
    )

    expect(outcome).toEqual({ status: 'skipped', reason: 'no_whatsapp' })
    expect(mockedBroadcastRepo.markRecipientNoWhatsapp).toHaveBeenCalledWith(
      'r1',
    )
    expect(mockedSend.text).not.toHaveBeenCalled()
    expect(mockedBroadcastRepo.closeIfRunning).toHaveBeenCalled()
  })

  it('should propagate a failure marking the recipient without WhatsApp', async () => {
    arrangeRecipient()
    mockedBroadcastRepo.findRecipientById.mockResolvedValue(
      ok({
        ...createFakeWhatsAppBroadcastRecipient({ id: 'r1' }),
        contact: createFakeWhatsAppContact({ hasWhatsapp: false }),
        broadcastList: createFakeWhatsAppBroadcastList({
          id: 'list1',
          skipNoWhatsapp: true,
        }),
      }),
    )
    mockedBroadcastRepo.markRecipientNoWhatsapp.mockResolvedValue(
      err(databaseError('x')),
    )

    expectErr(
      await WhatsAppBroadcastService.sendToRecipient('list1', 'r1'),
      'DATABASE_ERROR',
    )
  })

  it.each([
    ['the list does not skip', false, false],
    ['the contact was never checked', true, null],
    ['the contact has WhatsApp', true, true],
  ])(
    'should still send when %s',
    async (_name, skipNoWhatsapp, hasWhatsapp) => {
      arrangeRecipient({ list: { skipNoWhatsapp } })
      mockedBroadcastRepo.findRecipientById.mockResolvedValue(
        ok({
          ...createFakeWhatsAppBroadcastRecipient({ id: 'r1' }),
          contact: createFakeWhatsAppContact({ hasWhatsapp }),
          broadcastList: createFakeWhatsAppBroadcastList({
            id: 'list1',
            workspaceId: 'ws1',
            connectionId: 'conn1',
            skipNoWhatsapp,
          }),
        }),
      )
      mockedSend.text.mockResolvedValue(ok({ providerMessageId: 'wamid.1' }))

      const outcome = expectOk(
        await WhatsAppBroadcastService.sendToRecipient('list1', 'r1'),
      )

      expect(outcome.status).toBe('sent')
    },
  )

  it('should mark an opted-out contact as SKIPPED without sending (LGPD)', async () => {
    arrangeRecipient({ optedOut: true })

    const outcome = expectOk(
      await WhatsAppBroadcastService.sendToRecipient('list1', 'r1'),
    )

    expect(outcome).toEqual({ status: 'skipped', reason: 'opted_out' })
    expect(mockedBroadcastRepo.markRecipientsSkipped).toHaveBeenCalledWith([
      'r1',
    ])
    expect(mockedSend.text).not.toHaveBeenCalled()
    expect(mockedSend.media).not.toHaveBeenCalled()
    expect(mockedBroadcastRepo.closeIfRunning).toHaveBeenCalledWith(
      'list1',
      'DONE',
    )
  })

  it('should send a text broadcast and close the list when drained', async () => {
    const { connection } = arrangeRecipient()
    mockedSend.text.mockResolvedValue(ok({ providerMessageId: 'wamid-1' }))

    const outcome = expectOk(
      await WhatsAppBroadcastService.sendToRecipient('list1', 'r1'),
    )

    expect(outcome).toEqual({ status: 'sent', providerMessageId: 'wamid-1' })
    expect(mockedSend.text).toHaveBeenCalledWith(
      connection,
      {
        to: '5511988887777',
        text: 'Aproveite nossas ofertas!',
      },
      { cost: expect.objectContaining({ source: 'BROADCAST' }) },
    )
    expect(mockedBroadcastRepo.updateRecipientStatus).toHaveBeenCalledWith(
      'r1',
      expect.objectContaining({ status: 'SENT', providerMessageId: 'wamid-1' }),
    )
    expect(mockedBroadcastRepo.closeIfRunning).toHaveBeenCalledWith(
      'list1',
      'DONE',
    )
    expect(auditMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'whatsapp_broadcast_list',
        actorId: null,
        targetId: 'list1',
      }),
    )
  })

  it('should keep the list RUNNING while recipients are pending', async () => {
    arrangeRecipient()
    mockedBroadcastRepo.countPendingRecipients.mockResolvedValue(ok(3))
    mockedSend.text.mockResolvedValue(ok({ providerMessageId: 'wamid-1' }))

    await WhatsAppBroadcastService.sendToRecipient('list1', 'r1')

    expect(mockedBroadcastRepo.closeIfRunning).not.toHaveBeenCalled()
  })

  it('should send video media as video with the message as caption', async () => {
    const { connection } = arrangeRecipient({
      list: {
        mediaUrl: 'https://cdn/promo.mp4',
        mediaType: 'VIDEO',
        mediaMimeType: 'video/mp4',
      },
    })
    mockedSend.media.mockResolvedValue(ok({ providerMessageId: 'wamid-v' }))

    expectOk(await WhatsAppBroadcastService.sendToRecipient('list1', 'r1'))

    expect(mockedSend.media).toHaveBeenCalledWith(
      connection,
      {
        to: '5511988887777',
        mediaUrl: 'https://cdn/promo.mp4',
        type: 'video',
        caption: 'Aproveite nossas ofertas!',
      },
      { cost: expect.objectContaining({ source: 'BROADCAST' }) },
    )
  })

  it('should send a document with its original file name', async () => {
    arrangeRecipient({
      list: {
        mediaUrl: 'https://cdn/abc.bin',
        mediaType: 'DOCUMENT',
        mediaMimeType: 'application/pdf',
        mediaFileName: 'catalogo.pdf',
      },
    })
    mockedSend.media.mockResolvedValue(ok({ providerMessageId: 'wamid-d' }))

    expectOk(await WhatsAppBroadcastService.sendToRecipient('list1', 'r1'))

    expect(mockedSend.media).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ type: 'document', fileName: 'catalogo.pdf' }),
      { cost: expect.objectContaining({ source: 'BROADCAST' }) },
    )
  })

  it('should send audio without caption and the message as a follow-up text', async () => {
    arrangeRecipient({
      list: { mediaUrl: 'https://cdn/a.ogg', mediaType: 'AUDIO' },
    })
    mockedSend.media.mockResolvedValue(ok({ providerMessageId: 'wamid-a' }))
    mockedSend.text.mockResolvedValue(ok({ providerMessageId: 'wamid-t' }))

    const outcome = expectOk(
      await WhatsAppBroadcastService.sendToRecipient('list1', 'r1'),
    )

    expect(outcome).toEqual({ status: 'sent', providerMessageId: 'wamid-a' })
    expect(mockedSend.media).toHaveBeenCalledWith(
      expect.anything(),
      {
        to: '5511988887777',
        mediaUrl: 'https://cdn/a.ogg',
        type: 'audio',
      },
      { cost: expect.objectContaining({ source: 'BROADCAST' }) },
    )
    expect(mockedSend.text).toHaveBeenCalledWith(
      expect.anything(),
      { to: '5511988887777', text: 'Aproveite nossas ofertas!' },
      { cost: expect.objectContaining({ source: 'BROADCAST' }) },
    )
  })

  it('should infer the media type from the URL on legacy lists', async () => {
    arrangeRecipient({ list: { mediaUrl: 'https://cdn/old.mp4' } })
    mockedSend.media.mockResolvedValue(ok({ providerMessageId: 'wamid-l' }))

    await WhatsAppBroadcastService.sendToRecipient('list1', 'r1')

    expect(mockedSend.media).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ type: 'video' }),
      { cost: expect.objectContaining({ source: 'BROADCAST' }) },
    )
  })

  it('should send a template broadcast with the recipient variables', async () => {
    arrangeRecipient({ list: { templateId: 'tpl1' } })
    mockedTemplateRepo.findById.mockResolvedValue(
      ok(createFakeWhatsAppTemplate({ id: 'tpl1', name: 'lembrete' })),
    )
    mockedSend.template.mockResolvedValue(ok({ providerMessageId: 'wamid-2' }))

    expectOk(await WhatsAppBroadcastService.sendToRecipient('list1', 'r1'))

    expect(mockedTemplateRepo.findById).toHaveBeenCalledWith('tpl1', 'ws1')
    expect(mockedSend.template).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ templateName: 'lembrete', language: 'pt_BR' }),
      { cost: expect.objectContaining({ source: 'BROADCAST' }) },
    )
  })

  it('should fail the recipient when the template is gone', async () => {
    arrangeRecipient({ list: { templateId: 'tpl1' } })
    mockedTemplateRepo.findById.mockResolvedValue(ok(null))

    const outcome = expectOk(
      await WhatsAppBroadcastService.sendToRecipient('list1', 'r1'),
    )

    expect(outcome).toEqual({ status: 'failed', reason: 'template_missing' })
    expect(mockedBroadcastRepo.updateRecipientStatus).toHaveBeenCalledWith(
      'r1',
      { status: 'FAILED', errorMessage: 'Template não encontrado' },
    )
  })

  it('should fail the recipient when the connection is gone', async () => {
    arrangeRecipient()
    mockedConnectionRepo.findById.mockResolvedValue(ok(null))

    expect(
      expectOk(await WhatsAppBroadcastService.sendToRecipient('list1', 'r1')),
    ).toEqual({ status: 'failed', reason: 'connection_missing' })
  })

  it('should record FAILED with the provider message when the send fails', async () => {
    arrangeRecipient()
    mockedSend.text.mockResolvedValue(err(whatsappProviderError('fora do ar')))

    const outcome = expectOk(
      await WhatsAppBroadcastService.sendToRecipient('list1', 'r1'),
    )

    expect(outcome).toEqual({
      status: 'failed',
      reason: 'WHATSAPP_PROVIDER_ERROR',
    })
    expect(mockedBroadcastRepo.updateRecipientStatus).toHaveBeenCalledWith(
      'r1',
      { status: 'FAILED', errorMessage: 'fora do ar' },
    )
  })

  it('should propagate database errors on lookup', async () => {
    mockedBroadcastRepo.findRecipientById.mockResolvedValue(
      err(databaseError('down')),
    )
    expectErr(
      await WhatsAppBroadcastService.sendToRecipient('list1', 'r1'),
      'DATABASE_ERROR',
    )
  })
})

describe('WhatsAppBroadcastService.enqueueDueScheduledRecipients()', () => {
  it('should enqueue due recipients with a deterministic job id', async () => {
    const list = createFakeWhatsAppBroadcastList({ id: 'list1' })
    mockedBroadcastRepo.listDueScheduledRecipients.mockResolvedValue(
      ok([
        {
          ...createFakeWhatsAppBroadcastRecipient({
            id: 'r1',
            broadcastListId: 'list1',
          }),
          contact: { waId: '1', broadcastOptedOutAt: null, hasWhatsapp: null },
          broadcastList: list,
        },
      ]),
    )

    const result = expectOk(
      await WhatsAppBroadcastService.enqueueDueScheduledRecipients(new Date()),
    )

    expect(result).toEqual({ due: 1 })
    expect(addBulk).toHaveBeenCalledWith([
      expect.objectContaining({
        data: { broadcastListId: 'list1', recipientId: 'r1' },
        opts: { jobId: 'broadcast-recipient-r1' },
      }),
    ])
  })

  it('should propagate database errors', async () => {
    mockedBroadcastRepo.listDueScheduledRecipients.mockResolvedValue(
      err(databaseError('down')),
    )
    expectErr(
      await WhatsAppBroadcastService.enqueueDueScheduledRecipients(new Date()),
      'DATABASE_ERROR',
    )
  })
})

describe('WhatsAppBroadcastService · finished notice', () => {
  const notify = vi.mocked(notifyWhatsAppUsers)

  it('tells the creator the broadcast finished, with the tally', async () => {
    arrangeRecipient()
    mockedSend.text.mockResolvedValue(ok({ providerMessageId: 'wamid-1' }))
    mockedBroadcastRepo.countRecipientsByStatus.mockResolvedValue(
      ok({
        PENDING: 0,
        SENT: 8,
        FAILED: 2,
        SKIPPED: 1,
        SKIPPED_NO_WHATSAPP: 0,
      }),
    )
    mockedBroadcastRepo.closeIfRunning.mockResolvedValue(
      ok(
        createFakeWhatsAppBroadcastList({
          id: 'list1',
          workspaceId: 'ws1',
          name: 'Black Friday',
          createdById: 'creator',
        }),
      ),
    )

    expectOk(await WhatsAppBroadcastService.sendToRecipient('list1', 'r1'))

    expect(mockedBroadcastRepo.closeIfRunning).toHaveBeenCalledWith(
      'list1',
      'DONE',
    )
    const [input] = notify.mock.calls[0]
    expect(input).toMatchObject({
      workspaceId: 'ws1',
      kind: 'WHATSAPP_BROADCAST_FINISHED',
      userIds: ['creator'],
      title: 'Transmissão "Black Friday" concluída',
      body: '8 enviada(s), 2 com falha.',
    })
    expect(input.path).toBe('/zap/transmissoes')
  })

  it('closes as FAILED and says so when nothing went out', async () => {
    arrangeRecipient()
    mockedSend.text.mockResolvedValue(
      err(whatsappProviderError('Número inválido')),
    )
    mockedBroadcastRepo.countRecipientsByStatus.mockResolvedValue(
      ok({
        PENDING: 0,
        SENT: 0,
        FAILED: 3,
        SKIPPED: 0,
        SKIPPED_NO_WHATSAPP: 0,
      }),
    )
    mockedBroadcastRepo.closeIfRunning.mockResolvedValue(
      ok(createFakeWhatsAppBroadcastList({ id: 'list1', name: 'Aviso' })),
    )

    expectOk(await WhatsAppBroadcastService.sendToRecipient('list1', 'r1'))

    expect(mockedBroadcastRepo.closeIfRunning).toHaveBeenCalledWith(
      'list1',
      'FAILED',
    )
    expect(notify.mock.calls[0][0].title).toBe('Transmissão "Aviso" falhou')
  })

  it('is announced once: a job that lost the race to close stays quiet', async () => {
    arrangeRecipient()
    mockedSend.text.mockResolvedValue(ok({ providerMessageId: 'wamid-1' }))
    mockedBroadcastRepo.closeIfRunning.mockResolvedValue(ok(null))

    expectOk(await WhatsAppBroadcastService.sendToRecipient('list1', 'r1'))

    expect(notify).not.toHaveBeenCalled()
    expect(auditMutation).not.toHaveBeenCalled()
  })

  it('does not close the list when the tally cannot be read', async () => {
    arrangeRecipient()
    mockedSend.text.mockResolvedValue(ok({ providerMessageId: 'wamid-1' }))
    mockedBroadcastRepo.countRecipientsByStatus.mockResolvedValue(
      err(databaseError()),
    )

    expectOk(await WhatsAppBroadcastService.sendToRecipient('list1', 'r1'))

    expect(mockedBroadcastRepo.closeIfRunning).not.toHaveBeenCalled()
    expect(notify).not.toHaveBeenCalled()
  })
})
