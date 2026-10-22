import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import { createFakeWhatsAppBroadcastListWithRecipients } from '@/src/__tests__/factories/whatsapp-broadcast.factory'
import { createFakeWhatsAppConnection } from '@/src/__tests__/factories/whatsapp-connection.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError, featureNotEnabled } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/services/feature-flag.service')
vi.mock('@/src/repositories/whatsapp-connection.repository')
vi.mock('@/src/repositories/whatsapp-broadcast.repository')
vi.mock('@/src/repositories/whatsapp-contact.repository')

const { addBulk } = vi.hoisted(() => ({
  addBulk: vi.fn(async (_jobs: unknown[]) => []),
}))
vi.mock('@/src/lib/queue/queues', () => ({
  getWhatsappBroadcastQueue: vi.fn(() => ({ addBulk })),
}))

import { MembershipRepository } from '@/src/repositories/membership.repository'
import { WhatsAppBroadcastRepository } from '@/src/repositories/whatsapp-broadcast.repository'
import { WhatsAppConnectionRepository } from '@/src/repositories/whatsapp-connection.repository'
import { WhatsAppContactRepository } from '@/src/repositories/whatsapp-contact.repository'
import { WorkspaceModuleAccessRepository } from '@/src/repositories/workspace-module-access.repository'
import { assertFeature } from '../feature-flag.service'
import { WhatsAppBroadcastService } from '../whatsapp-broadcast.service'

const mockedMembershipRepo = vi.mocked(MembershipRepository)
const mockedConnectionRepo = vi.mocked(WhatsAppConnectionRepository)
const mockedBroadcastRepo = vi.mocked(WhatsAppBroadcastRepository)
const mockedContactRepo = vi.mocked(WhatsAppContactRepository)
const mockedAssertFeature = vi.mocked(assertFeature)

beforeEach(() => {
  mockedAssertFeature.mockResolvedValue(ok(true))
})

describe('WhatsAppBroadcastService', () => {
  describe('create()', () => {
    it('should forbid a MEMBER from creating a broadcast (admin-only)', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
        ok(createFakeMembership({ role: 'MEMBER' })),
      )

      const result = await WhatsAppBroadcastService.create('u1', 'ws1', {
        connectionId: 'conn1',
        name: 'Promoção',
        messageBody: 'Aproveite!',
        contactIds: ['c1'],
      })

      expectErr(result, 'FORBIDDEN')
      expect(mockedBroadcastRepo.create).not.toHaveBeenCalled()
    })

    it('should return MODULE_DISABLED when Comunicação is off for the workspace', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
        ok(createFakeMembership({ role: 'OWNER' })),
      )
      vi.mocked(
        WorkspaceModuleAccessRepository.isEnabled,
      ).mockResolvedValueOnce(ok(false))

      expectErr(
        await WhatsAppBroadcastService.list('u1', 'ws1'),
        'MODULE_DISABLED',
      )
    })

    it('should create the broadcast with deduplicated contact ids', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
        ok(createFakeMembership({ role: 'ADMIN' })),
      )
      mockedConnectionRepo.findById.mockResolvedValue(
        ok(createFakeWhatsAppConnection({ id: 'conn1' })),
      )
      const created = createFakeWhatsAppBroadcastListWithRecipients(
        { id: 'b1' },
        2,
      )
      mockedBroadcastRepo.create.mockResolvedValue(ok(created))
      mockedContactRepo.listBroadcastEligibleIds.mockImplementation(
        async (_workspaceId, ids) => ok(ids),
      )

      const result = await WhatsAppBroadcastService.create('u1', 'ws1', {
        connectionId: 'conn1',
        name: 'Promoção',
        messageBody: 'Aproveite!',
        contactIds: ['c1', 'c1', 'c2'],
      })

      expectOk(result)
      expect(mockedBroadcastRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ connectionId: 'conn1', createdById: 'u1' }),
        ['c1', 'c2'],
      )
    })

    it('should exclude opted-out contacts via the eligibility query', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
        ok(createFakeMembership({ role: 'ADMIN' })),
      )
      mockedConnectionRepo.findById.mockResolvedValue(
        ok(createFakeWhatsAppConnection({ id: 'conn1' })),
      )
      mockedBroadcastRepo.create.mockResolvedValue(
        ok(createFakeWhatsAppBroadcastListWithRecipients({ id: 'b1' }, 1)),
      )
      mockedContactRepo.listBroadcastEligibleIds.mockResolvedValue(ok(['c2']))

      expectOk(
        await WhatsAppBroadcastService.create('u1', 'ws1', {
          connectionId: 'conn1',
          name: 'Promoção',
          messageBody: 'Aproveite!',
          contactIds: ['c1', 'c2'],
        }),
      )
      expect(mockedContactRepo.listBroadcastEligibleIds).toHaveBeenCalledWith(
        'ws1',
        ['c1', 'c2'],
      )
      expect(mockedBroadcastRepo.create).toHaveBeenCalledWith(
        expect.anything(),
        ['c2'],
      )
    })

    it('should return WHATSAPP_BROADCAST_NO_RECIPIENTS when every contact opted out', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
        ok(createFakeMembership({ role: 'ADMIN' })),
      )
      mockedConnectionRepo.findById.mockResolvedValue(
        ok(createFakeWhatsAppConnection({ id: 'conn1' })),
      )
      mockedContactRepo.listBroadcastEligibleIds.mockResolvedValue(ok([]))

      expectErr(
        await WhatsAppBroadcastService.create('u1', 'ws1', {
          connectionId: 'conn1',
          name: 'Promoção',
          messageBody: 'Aproveite!',
          contactIds: ['c1'],
        }),
        'WHATSAPP_BROADCAST_NO_RECIPIENTS',
      )
      expect(mockedBroadcastRepo.create).not.toHaveBeenCalled()
    })

    it('should return WHATSAPP_CONNECTION_NOT_FOUND for an unknown connection', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
        ok(createFakeMembership({ role: 'ADMIN' })),
      )
      mockedConnectionRepo.findById.mockResolvedValue(ok(null))

      const result = await WhatsAppBroadcastService.create('u1', 'ws1', {
        connectionId: 'conn1',
        name: 'Promoção',
        messageBody: 'Aproveite!',
        contactIds: ['c1'],
      })

      expectErr(result, 'WHATSAPP_CONNECTION_NOT_FOUND')
    })
  })

  describe('create() with media', () => {
    it('should store the media type, mime and file name', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
        ok(createFakeMembership({ role: 'ADMIN' })),
      )
      mockedConnectionRepo.findById.mockResolvedValue(
        ok(createFakeWhatsAppConnection({ id: 'conn1' })),
      )
      mockedContactRepo.listBroadcastEligibleIds.mockResolvedValue(ok(['c1']))
      mockedBroadcastRepo.create.mockResolvedValue(
        ok(createFakeWhatsAppBroadcastListWithRecipients()),
      )

      expectOk(
        await WhatsAppBroadcastService.create('u1', 'ws1', {
          connectionId: 'conn1',
          name: 'Catálogo',
          messageBody: 'Confira',
          mediaUrl: 'https://cdn/abc.bin',
          mediaMimeType: 'application/pdf',
          mediaFileName: 'catalogo.pdf',
          contactIds: ['c1'],
        }),
      )

      expect(mockedBroadcastRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          mediaType: 'DOCUMENT',
          mediaMimeType: 'application/pdf',
          mediaFileName: 'catalogo.pdf',
        }),
        ['c1'],
      )
    })

    it('should store the "skip numbers without WhatsApp" choice', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
        ok(createFakeMembership({ role: 'ADMIN' })),
      )
      mockedConnectionRepo.findById.mockResolvedValue(
        ok(createFakeWhatsAppConnection({ id: 'conn1' })),
      )
      mockedContactRepo.listBroadcastEligibleIds.mockResolvedValue(ok(['c1']))
      mockedBroadcastRepo.create.mockResolvedValue(
        ok(createFakeWhatsAppBroadcastListWithRecipients({ id: 'b1' }, 1)),
      )

      expectOk(
        await WhatsAppBroadcastService.create('u1', 'ws1', {
          connectionId: 'conn1',
          name: 'X',
          messageBody: 'Y',
          skipNoWhatsapp: true,
          contactIds: ['c1'],
        }),
      )

      expect(mockedBroadcastRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ skipNoWhatsapp: true }),
        ['c1'],
      )
    })

    it('should reject media whose type cannot be identified', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
        ok(createFakeMembership({ role: 'ADMIN' })),
      )
      mockedConnectionRepo.findById.mockResolvedValue(
        ok(createFakeWhatsAppConnection({ id: 'conn1' })),
      )
      mockedContactRepo.listBroadcastEligibleIds.mockResolvedValue(ok(['c1']))

      expectErr(
        await WhatsAppBroadcastService.create('u1', 'ws1', {
          connectionId: 'conn1',
          name: 'X',
          messageBody: 'Y',
          mediaUrl: 'https://cdn/abc.bin',
          contactIds: ['c1'],
        }),
        'WHATSAPP_BROADCAST_MEDIA_INVALID',
      )
      expect(mockedBroadcastRepo.create).not.toHaveBeenCalled()
    })
  })

  describe('start()', () => {
    it('should enqueue one staggered job per recipient and mark the list RUNNING', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
        ok(createFakeMembership({ role: 'ADMIN' })),
      )
      const draft = createFakeWhatsAppBroadcastListWithRecipients(
        { id: 'b1', status: 'DRAFT' },
        3,
      )
      mockedBroadcastRepo.findById
        .mockResolvedValueOnce(ok(draft))
        .mockResolvedValueOnce(ok({ ...draft, status: 'RUNNING' }))
      mockedBroadcastRepo.updateStatus.mockResolvedValue(ok(undefined))

      const result = await WhatsAppBroadcastService.start('u1', 'ws1', 'b1')

      expectOk(result)
      expect(addBulk).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            data: expect.objectContaining({ broadcastListId: 'b1' }),
          }),
        ]),
      )
      expect(addBulk.mock.calls[0][0]).toHaveLength(3)
      expect(mockedBroadcastRepo.updateStatus).toHaveBeenCalledWith(
        'b1',
        'RUNNING',
      )
    })

    it('should skip contacts that opted out after the list was created', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
        ok(createFakeMembership({ role: 'ADMIN' })),
      )
      const draft = createFakeWhatsAppBroadcastListWithRecipients(
        { id: 'b1', status: 'DRAFT' },
        3,
      )
      draft.recipients[1].contact.broadcastOptedOutAt = new Date()
      draft.recipients[1].contact.broadcastOptOutSource = 'KEYWORD'
      mockedBroadcastRepo.findById.mockResolvedValue(ok(draft))
      mockedBroadcastRepo.updateStatus.mockResolvedValue(ok(undefined))
      mockedBroadcastRepo.markRecipientsSkipped.mockResolvedValue(ok(1))

      expectOk(await WhatsAppBroadcastService.start('u1', 'ws1', 'b1'))

      expect(mockedBroadcastRepo.markRecipientsSkipped).toHaveBeenCalledWith([
        draft.recipients[1].id,
      ])
      const jobs = addBulk.mock.calls[0][0] as {
        data: { recipientId: string }
      }[]
      expect(jobs.map((j) => j.data.recipientId)).toEqual([
        draft.recipients[0].id,
        draft.recipients[2].id,
      ])
    })

    it('should skip contacts without WhatsApp when the list asks for it', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
        ok(createFakeMembership({ role: 'ADMIN' })),
      )
      const draft = createFakeWhatsAppBroadcastListWithRecipients(
        { id: 'b1', status: 'DRAFT', skipNoWhatsapp: true },
        3,
      )
      draft.recipients[0].contact.hasWhatsapp = false
      draft.recipients[1].contact.hasWhatsapp = null // never checked: sent
      draft.recipients[2].contact.hasWhatsapp = true
      mockedBroadcastRepo.findById.mockResolvedValue(ok(draft))
      mockedBroadcastRepo.updateStatus.mockResolvedValue(ok(undefined))
      mockedBroadcastRepo.skipPendingWithoutWhatsapp.mockResolvedValue(ok(1))

      expectOk(await WhatsAppBroadcastService.start('u1', 'ws1', 'b1'))

      expect(
        mockedBroadcastRepo.skipPendingWithoutWhatsapp,
      ).toHaveBeenCalledWith('b1')
      const jobs = addBulk.mock.calls.at(-1)?.[0] as {
        data: { recipientId: string }
      }[]
      expect(jobs.map((j) => j.data.recipientId)).toEqual([
        draft.recipients[1].id,
        draft.recipients[2].id,
      ])
    })

    it('should send to contacts without WhatsApp when the list does not skip them', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
        ok(createFakeMembership({ role: 'ADMIN' })),
      )
      const draft = createFakeWhatsAppBroadcastListWithRecipients(
        { id: 'b1', status: 'DRAFT', skipNoWhatsapp: false },
        2,
      )
      draft.recipients[0].contact.hasWhatsapp = false
      mockedBroadcastRepo.findById.mockResolvedValue(ok(draft))
      mockedBroadcastRepo.updateStatus.mockResolvedValue(ok(undefined))
      mockedBroadcastRepo.skipPendingWithoutWhatsapp.mockClear()

      expectOk(await WhatsAppBroadcastService.start('u1', 'ws1', 'b1'))

      expect(
        mockedBroadcastRepo.skipPendingWithoutWhatsapp,
      ).not.toHaveBeenCalled()
      expect(addBulk.mock.calls.at(-1)?.[0]).toHaveLength(2)
    })

    it('should not queue recipients already skipped by a number check', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
        ok(createFakeMembership({ role: 'ADMIN' })),
      )
      const draft = createFakeWhatsAppBroadcastListWithRecipients(
        { id: 'b1', status: 'DRAFT', skipNoWhatsapp: true },
        2,
      )
      draft.recipients[0].status = 'SKIPPED_NO_WHATSAPP'
      draft.recipients[0].contact.hasWhatsapp = false
      mockedBroadcastRepo.findById.mockResolvedValue(ok(draft))
      mockedBroadcastRepo.updateStatus.mockResolvedValue(ok(undefined))
      mockedBroadcastRepo.skipPendingWithoutWhatsapp.mockResolvedValue(ok(0))

      expectOk(await WhatsAppBroadcastService.start('u1', 'ws1', 'b1'))

      const jobs = addBulk.mock.calls.at(-1)?.[0] as {
        data: { recipientId: string }
      }[]
      expect(jobs.map((j) => j.data.recipientId)).toEqual([
        draft.recipients[1].id,
      ])
    })

    it('should propagate a failure skipping recipients without WhatsApp', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
        ok(createFakeMembership({ role: 'ADMIN' })),
      )
      const draft = createFakeWhatsAppBroadcastListWithRecipients(
        { id: 'b1', status: 'DRAFT', skipNoWhatsapp: true },
        1,
      )
      draft.recipients[0].contact.hasWhatsapp = false
      mockedBroadcastRepo.findById.mockResolvedValue(ok(draft))
      mockedBroadcastRepo.skipPendingWithoutWhatsapp.mockResolvedValue(
        err(databaseError('x')),
      )

      expectErr(
        await WhatsAppBroadcastService.start('u1', 'ws1', 'b1'),
        'DATABASE_ERROR',
      )
    })

    it('should reject starting a broadcast that already left DRAFT status', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
        ok(createFakeMembership({ role: 'ADMIN' })),
      )
      const running = createFakeWhatsAppBroadcastListWithRecipients(
        { id: 'b1', status: 'RUNNING' },
        1,
      )
      mockedBroadcastRepo.findById.mockResolvedValue(ok(running))

      const result = await WhatsAppBroadcastService.start('u1', 'ws1', 'b1')

      expectErr(result, 'WHATSAPP_BROADCAST_LOCKED')
      expect(addBulk).not.toHaveBeenCalled()
    })
  })

  describe('feature flag communication.broadcasts', () => {
    beforeEach(() => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
        ok(createFakeMembership({ role: 'ADMIN' })),
      )
      mockedAssertFeature.mockResolvedValue(err(featureNotEnabled()))
    })

    it('should block create() when broadcasts are off for the workspace', async () => {
      expectErr(
        await WhatsAppBroadcastService.create('u1', 'ws1', {
          connectionId: 'conn1',
          name: 'Promoção',
          messageBody: 'Aproveite!',
          contactIds: ['c1'],
        }),
        'FEATURE_NOT_ENABLED',
      )
      expect(mockedAssertFeature).toHaveBeenCalledWith(
        'ws1',
        'communication.broadcasts',
      )
      expect(mockedBroadcastRepo.create).not.toHaveBeenCalled()
    })

    it('should block start() when broadcasts are off for the workspace', async () => {
      expectErr(
        await WhatsAppBroadcastService.start('u1', 'ws1', 'b1'),
        'FEATURE_NOT_ENABLED',
      )
      expect(addBulk).not.toHaveBeenCalled()
    })
  })
})
