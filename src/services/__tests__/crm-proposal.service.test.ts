import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeCrmProposal } from '@/src/__tests__/factories/crm-proposal.factory'
import { createFakeCrmProposalTemplate } from '@/src/__tests__/factories/crm-proposal-template.factory'
import { createFakeCrmSettings } from '@/src/__tests__/factories/crm-settings.factory'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError, notFound } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/services/crm-notifications')
vi.mock('@/src/services/steel-agent-dispatcher', () => ({
  dispatchSteelAgentEvent: vi.fn(),
}))
vi.mock('@/lib/axiom/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}))
vi.mock('@/lib/axiom/audit', () => ({ auditMutation: vi.fn() }))
vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/crm-company.repository')
vi.mock('@/src/repositories/crm-person.repository')
vi.mock('@/src/repositories/crm-opportunity.repository')
vi.mock('@/src/repositories/crm-proposal.repository')
vi.mock('@/src/repositories/crm-proposal-template.repository')
vi.mock('@/src/repositories/crm-settings.repository')
vi.mock('@/src/lib/mail/crm/send-proposal-expired')

import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import { sendCrmProposalExpiredEmail } from '@/src/lib/mail/crm/send-proposal-expired'
import { CrmCompanyRepository } from '@/src/repositories/crm-company.repository'
import { CrmOpportunityRepository } from '@/src/repositories/crm-opportunity.repository'
import { CrmPersonRepository } from '@/src/repositories/crm-person.repository'
import {
  CrmProposalRepository,
  CrmProposalViewRepository,
} from '@/src/repositories/crm-proposal.repository'
import { CrmProposalTemplateRepository } from '@/src/repositories/crm-proposal-template.repository'
import { CrmSettingsRepository } from '@/src/repositories/crm-settings.repository'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { WorkspaceModuleAccessRepository } from '@/src/repositories/workspace-module-access.repository'
import {
  notifyCrmProposalAccepted,
  notifyCrmProposalExpired,
  notifyCrmProposalViewed,
} from '../crm-notifications'
import { CrmProposalService } from '../crm-proposal.service'
import { dispatchSteelAgentEvent } from '../steel-agent-dispatcher'

const mockedMembershipRepo = vi.mocked(MembershipRepository)
const mockedProposalRepo = vi.mocked(CrmProposalRepository)
const mockedViewRepo = vi.mocked(CrmProposalViewRepository)
const mockedTemplateRepo = vi.mocked(CrmProposalTemplateRepository)
const mockedSettingsRepo = vi.mocked(CrmSettingsRepository)
const mockedSendExpired = vi.mocked(sendCrmProposalExpiredEmail)
const mockedCompanyRepo = vi.mocked(CrmCompanyRepository)
const mockedPersonRepo = vi.mocked(CrmPersonRepository)
const mockedOpportunityRepo = vi.mocked(CrmOpportunityRepository)
const mockedModuleAccess = vi.mocked(WorkspaceModuleAccessRepository)
const mockedAudit = vi.mocked(auditMutation)
const mockedLogger = vi.mocked(logger)

const DAY_MS = 86_400_000
const PAST = new Date('2026-01-10T15:00:00.000Z')
const future = () => new Date(Date.now() + 10 * DAY_MS)

function mockRole(role: 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER') {
  mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
    ok(createFakeMembership({ role })),
  )
}

beforeEach(() => {
  mockedSettingsRepo.findByWorkspace.mockResolvedValue(ok(null))
})

const fakeProposalWithSections = (
  overrides?: Parameters<typeof createFakeCrmProposal>[0],
) => ({
  ...createFakeCrmProposal(overrides),
  sections: [],
})

describe('CrmProposalService', () => {
  describe('list()', () => {
    it('should return FORBIDDEN for a non-member', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(ok(null))
      expectErr(await CrmProposalService.list('u1', 'ws1'), 'FORBIDDEN')
    })
  })

  describe('create()', () => {
    it('should create a proposal with the given sections', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
        ok(createFakeMembership({ role: 'MEMBER' })),
      )
      mockedProposalRepo.create.mockResolvedValue(
        ok(fakeProposalWithSections({ id: 'p1', name: 'Proposta X' })),
      )

      expectOk(
        await CrmProposalService.create('u1', 'ws1', {
          name: 'Proposta X',
          responsibleId: 'u1',
          sections: [
            {
              type: 'COVER',
              order: 0,
              enabled: true,
              content: { type: 'COVER', title: 'Proposta X' },
            },
          ],
        }),
      )
      expect(mockedProposalRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Proposta X' }),
      )
    })

    it('should copy enabled template sections when no sections are given', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
        ok(createFakeMembership({ role: 'MEMBER' })),
      )
      mockedTemplateRepo.findById.mockResolvedValue(
        ok({
          ...createFakeCrmProposalTemplate({ id: 't1', workspaceId: 'ws1' }),
          sections: [
            {
              id: 'ts1',
              templateId: 't1',
              type: 'TERMS_CONDITIONS' as const,
              order: 0,
              enabled: true,
              defaultContent: {
                type: 'TERMS_CONDITIONS',
                text: 'Termos padrão',
              },
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          ],
        }),
      )
      mockedProposalRepo.create.mockResolvedValue(
        ok(fakeProposalWithSections({ id: 'p1', name: 'Proposta X' })),
      )

      expectOk(
        await CrmProposalService.create('u1', 'ws1', {
          name: 'Proposta X',
          responsibleId: 'u1',
          templateId: 't1',
          sections: [],
        }),
      )
      expect(mockedProposalRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          sections: [
            expect.objectContaining({
              type: 'TERMS_CONDITIONS',
              content: { type: 'TERMS_CONDITIONS', text: 'Termos padrão' },
            }),
          ],
        }),
      )
    })
  })

  describe('update()', () => {
    it('should replace sections when provided', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
        ok(createFakeMembership({ role: 'MEMBER' })),
      )
      const existing = fakeProposalWithSections({ id: 'p1' })
      mockedProposalRepo.findById.mockResolvedValue(ok(existing))
      mockedProposalRepo.update.mockResolvedValue(ok(existing))

      expectOk(
        await CrmProposalService.update('u1', 'ws1', 'p1', {
          sections: [
            {
              type: 'COVER',
              order: 0,
              enabled: true,
              content: { type: 'COVER', title: 'V2' },
            },
          ],
        }),
      )
      expect(mockedProposalRepo.update).toHaveBeenCalledWith(
        'p1',
        expect.objectContaining({
          sections: [expect.objectContaining({ type: 'COVER' })],
        }),
      )
    })
  })

  describe('send()', () => {
    it('should transition status to SENT', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
        ok(createFakeMembership({ role: 'MEMBER' })),
      )
      const existing = fakeProposalWithSections({ id: 'p1', status: 'DRAFT' })
      mockedProposalRepo.findById.mockResolvedValue(ok(existing))
      mockedProposalRepo.setStatus.mockResolvedValue(
        ok({ ...existing, status: 'SENT' }),
      )

      const dto = expectOk(await CrmProposalService.send('u1', 'ws1', 'p1'))
      expect(dto.status).toBe('SENT')
      expect(mockedProposalRepo.setStatus).toHaveBeenCalledWith('p1', 'SENT')
    })
  })

  describe('getPublicByShareToken()', () => {
    it('should return the public shape without auth', async () => {
      mockedProposalRepo.findByShareToken.mockResolvedValue(
        ok(
          fakeProposalWithSections({
            id: 'p1',
            shareToken: 'tok',
            status: 'SENT',
          }),
        ),
      )
      mockedProposalRepo.setStatus.mockResolvedValue(
        ok(fakeProposalWithSections({ id: 'p1', status: 'VIEWED' })),
      )

      const dto = expectOk(
        await CrmProposalService.getPublicByShareToken('tok'),
      )
      expect(dto.id).toBe('p1')
      expect(dto).not.toHaveProperty('shareToken')
    })

    it('should mark a SENT proposal as VIEWED on first public view', async () => {
      mockedProposalRepo.findByShareToken.mockResolvedValue(
        ok(fakeProposalWithSections({ id: 'p1', status: 'SENT' })),
      )
      mockedProposalRepo.setStatus.mockResolvedValue(
        ok(fakeProposalWithSections({ id: 'p1', status: 'VIEWED' })),
      )

      await CrmProposalService.getPublicByShareToken('tok')
      expect(mockedProposalRepo.setStatus).toHaveBeenCalledWith('p1', 'VIEWED')
      expect(notifyCrmProposalViewed).toHaveBeenCalledWith({
        workspaceId: expect.any(String),
        proposal: expect.objectContaining({ id: 'p1' }),
      })
      expect(dispatchSteelAgentEvent).toHaveBeenCalledWith(
        expect.any(String),
        'crm.proposal.viewed',
        expect.objectContaining({ proposalId: 'p1' }),
      )
    })

    it('should not notify on later views or when the status write fails', async () => {
      vi.mocked(notifyCrmProposalViewed).mockClear()
      mockedProposalRepo.findByShareToken.mockResolvedValue(
        ok(fakeProposalWithSections({ id: 'p1', status: 'VIEWED' })),
      )
      await CrmProposalService.getPublicByShareToken('tok')

      mockedProposalRepo.findByShareToken.mockResolvedValue(
        ok(fakeProposalWithSections({ id: 'p1', status: 'SENT' })),
      )
      mockedProposalRepo.setStatus.mockResolvedValue(err(databaseError()))
      await CrmProposalService.getPublicByShareToken('tok')

      expect(notifyCrmProposalViewed).not.toHaveBeenCalled()
    })
  })

  describe('recordView()', () => {
    it('should hash the ip before recording', async () => {
      mockedProposalRepo.findByShareToken.mockResolvedValue(
        ok(fakeProposalWithSections({ id: 'p1', shareToken: 'tok' })),
      )
      mockedViewRepo.record.mockResolvedValue(
        ok({
          id: 'v1',
          proposalId: 'p1',
          viewId: 'view1',
          ipHash: 'hashed',
          durationMs: 0,
          reachedEnd: false,
          scrolledPct: 0,
          referrer: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      )

      expectOk(
        await CrmProposalService.recordView('tok', '1.2.3.4', {
          viewId: 'view1',
          durationMs: 0,
          reachedEnd: false,
          scrolledPct: 0,
        }),
      )
      expect(mockedViewRepo.record).toHaveBeenCalledWith(
        expect.objectContaining({
          ipHash: expect.not.stringContaining('1.2.3.4'),
        }),
      )
    })
  })

  describe('validity on create()', () => {
    it('should default validUntil to today + the workspace validity days', async () => {
      mockRole('MEMBER')
      mockedSettingsRepo.findByWorkspace.mockResolvedValue(
        ok(createFakeCrmSettings({ proposalValidityDays: 7 })),
      )
      mockedProposalRepo.create.mockResolvedValue(
        ok(fakeProposalWithSections({ id: 'p1' })),
      )

      expectOk(
        await CrmProposalService.create('u1', 'ws1', {
          name: 'Proposta X',
          responsibleId: 'u1',
          sections: [],
        }),
      )

      const validUntil = mockedProposalRepo.create.mock.calls[0]?.[0]
        .validUntil as Date
      const days = (validUntil.getTime() - Date.now()) / DAY_MS
      expect(days).toBeGreaterThan(6)
      expect(days).toBeLessThanOrEqual(8)
    })

    it('should keep an explicit validUntil', async () => {
      mockRole('MEMBER')
      const explicit = future()
      mockedProposalRepo.create.mockResolvedValue(
        ok(fakeProposalWithSections({ id: 'p1' })),
      )

      expectOk(
        await CrmProposalService.create('u1', 'ws1', {
          name: 'Proposta X',
          responsibleId: 'u1',
          validUntil: explicit,
          sections: [],
        }),
      )
      expect(mockedProposalRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ validUntil: explicit }),
      )
    })
  })

  describe('validity on update()', () => {
    it('should block marking an expired proposal as accepted', async () => {
      mockRole('ADMIN')
      mockedProposalRepo.findById.mockResolvedValue(
        ok(fakeProposalWithSections({ status: 'SENT', validUntil: PAST })),
      )

      expectErr(
        await CrmProposalService.update('u1', 'ws1', 'p1', {
          status: 'ACCEPTED',
        }),
        'CRM_PROPOSAL_EXPIRED',
      )
      expect(mockedProposalRepo.update).not.toHaveBeenCalled()
    })

    it('should keep autosaving an overdue proposal when validity is untouched', async () => {
      mockRole('MEMBER')
      const existing = fakeProposalWithSections({
        status: 'SENT',
        validUntil: PAST,
      })
      mockedProposalRepo.findById.mockResolvedValue(ok(existing))
      mockedProposalRepo.update.mockResolvedValue(ok(existing))

      expectOk(
        await CrmProposalService.update('u1', 'ws1', 'p1', {
          name: 'Renomeada',
          validUntil: new Date(PAST),
        }),
      )
    })

    it('should only let an admin change the validity of an expired proposal', async () => {
      mockRole('MEMBER')
      mockedProposalRepo.findById.mockResolvedValue(
        ok(fakeProposalWithSections({ status: 'EXPIRED', validUntil: PAST })),
      )

      expectErr(
        await CrmProposalService.update('u1', 'ws1', 'p1', {
          validUntil: future(),
        }),
        'FORBIDDEN',
      )
    })

    it('should reopen an expired proposal when an admin moves the validity forward', async () => {
      mockRole('OWNER')
      const existing = fakeProposalWithSections({
        status: 'EXPIRED',
        validUntil: PAST,
      })
      mockedProposalRepo.findById.mockResolvedValue(ok(existing))
      mockedViewRepo.countByProposal.mockResolvedValue(ok(0))
      mockedProposalRepo.update.mockResolvedValue(
        ok({ ...existing, status: 'SENT' }),
      )

      expectOk(
        await CrmProposalService.update('u1', 'ws1', 'p1', {
          validUntil: future(),
        }),
      )
      expect(mockedProposalRepo.update).toHaveBeenCalledWith(
        'p1',
        expect.objectContaining({ status: 'SENT', expiredAt: null }),
      )
    })
  })

  describe('validity on send()', () => {
    it('should refuse to send a proposal whose validity already passed', async () => {
      mockRole('MEMBER')
      mockedProposalRepo.findById.mockResolvedValue(
        ok(fakeProposalWithSections({ status: 'DRAFT', validUntil: PAST })),
      )

      expectErr(
        await CrmProposalService.send('u1', 'ws1', 'p1'),
        'CRM_PROPOSAL_EXPIRED',
      )
      expect(mockedProposalRepo.setStatus).not.toHaveBeenCalled()
    })
  })

  describe('extendValidity()', () => {
    it('should restore an expired, already viewed proposal to VIEWED', async () => {
      mockRole('ADMIN')
      const existing = fakeProposalWithSections({
        id: 'p1',
        status: 'EXPIRED',
        validUntil: PAST,
        expiredAt: new Date(),
      })
      const next = future()
      mockedProposalRepo.findById.mockResolvedValue(ok(existing))
      mockedViewRepo.countByProposal.mockResolvedValue(ok(3))
      mockedProposalRepo.update.mockResolvedValue(
        ok({
          ...existing,
          status: 'VIEWED',
          validUntil: next,
          expiredAt: null,
        }),
      )

      const dto = expectOk(
        await CrmProposalService.extendValidity('u1', 'ws1', 'p1', {
          validUntil: next,
        }),
      )

      expect(dto.status).toBe('VIEWED')
      expect(dto.isExpired).toBe(false)
      expect(mockedProposalRepo.update).toHaveBeenCalledWith('p1', {
        validUntil: next,
        status: 'VIEWED',
        expiredAt: null,
        updatedById: 'u1',
      })
    })

    it('should only extend (no status change) a proposal that is still open', async () => {
      mockRole('ADMIN')
      const existing = fakeProposalWithSections({
        id: 'p1',
        status: 'SENT',
        validUntil: future(),
      })
      const next = new Date(Date.now() + 40 * DAY_MS)
      mockedProposalRepo.findById.mockResolvedValue(ok(existing))
      mockedProposalRepo.update.mockResolvedValue(
        ok({ ...existing, validUntil: next }),
      )

      expectOk(
        await CrmProposalService.extendValidity('u1', 'ws1', 'p1', {
          validUntil: next,
        }),
      )
      expect(mockedProposalRepo.update).toHaveBeenCalledWith('p1', {
        validUntil: next,
        updatedById: 'u1',
      })
    })

    it('should require a future date', async () => {
      mockRole('ADMIN')
      mockedProposalRepo.findById.mockResolvedValue(
        ok(fakeProposalWithSections({ status: 'EXPIRED', validUntil: PAST })),
      )

      expectErr(
        await CrmProposalService.extendValidity('u1', 'ws1', 'p1', {
          validUntil: new Date('2026-01-20T12:00:00.000Z'),
        }),
        'VALIDATION_ERROR',
      )
    })

    it('should refuse proposals already answered by the client', async () => {
      mockRole('ADMIN')
      mockedProposalRepo.findById.mockResolvedValue(
        ok(fakeProposalWithSections({ status: 'ACCEPTED' })),
      )

      expectErr(
        await CrmProposalService.extendValidity('u1', 'ws1', 'p1', {
          validUntil: future(),
        }),
        'CONFLICT',
      )
    })

    it('should be restricted to OWNER/ADMIN', async () => {
      mockRole('MEMBER')

      expectErr(
        await CrmProposalService.extendValidity('u1', 'ws1', 'p1', {
          validUntil: future(),
        }),
        'FORBIDDEN',
      )
      expect(mockedProposalRepo.findById).not.toHaveBeenCalled()
    })
  })

  describe('accept()', () => {
    it('should record the acceptance of a proposal within its validity', async () => {
      const existing = fakeProposalWithSections({
        id: 'p1',
        status: 'VIEWED',
        validUntil: future(),
      })
      mockedProposalRepo.findByShareToken
        .mockResolvedValueOnce(ok(existing))
        .mockResolvedValueOnce(
          ok({
            ...existing,
            status: 'ACCEPTED',
            acceptedAt: new Date(),
            acceptedByName: 'Maria',
          }),
        )
      mockedProposalRepo.accept.mockResolvedValue(ok(true))

      const dto = expectOk(
        await CrmProposalService.accept('tok', '1.2.3.4', { name: 'Maria' }),
      )

      expect(dto.status).toBe('ACCEPTED')
      expect(dto.acceptedByName).toBe('Maria')
      expect(mockedProposalRepo.accept).toHaveBeenCalledWith('p1', {
        name: 'Maria',
        at: expect.any(Date),
      })
      expect(notifyCrmProposalAccepted).toHaveBeenCalledWith({
        workspaceId: existing.workspaceId,
        proposal: existing,
        acceptedByName: 'Maria',
      })
    })

    it('should block acceptance after expiry with a clear message', async () => {
      mockedProposalRepo.findByShareToken.mockResolvedValue(
        ok(
          fakeProposalWithSections({
            status: 'SENT',
            validUntil: new Date('2026-01-10T15:00:00.000Z'),
          }),
        ),
      )

      const error = expectErr(
        await CrmProposalService.accept('tok', '1.2.3.4', { name: 'Maria' }),
        'CRM_PROPOSAL_EXPIRED',
      )
      expect(error.message).toContain('10/01/2026')
      expect(mockedProposalRepo.accept).not.toHaveBeenCalled()
    })

    it('should refuse an already accepted proposal', async () => {
      mockedProposalRepo.findByShareToken.mockResolvedValue(
        ok(fakeProposalWithSections({ status: 'ACCEPTED' })),
      )

      expectErr(
        await CrmProposalService.accept('tok', '1.2.3.4', { name: 'Maria' }),
        'CRM_PROPOSAL_NOT_ACCEPTABLE',
      )
    })

    it('should refuse when another request changed the status first', async () => {
      mockedProposalRepo.findByShareToken.mockResolvedValue(
        ok(fakeProposalWithSections({ status: 'SENT', validUntil: null })),
      )
      mockedProposalRepo.accept.mockResolvedValue(ok(false))

      expectErr(
        await CrmProposalService.accept('tok', '1.2.3.4', { name: 'Maria' }),
        'CRM_PROPOSAL_NOT_ACCEPTABLE',
      )
    })
  })

  describe('expireDue()', () => {
    function candidate(
      overrides: Partial<ReturnType<typeof createFakeCrmProposal>> = {},
    ) {
      return {
        ...createFakeCrmProposal({
          status: 'SENT',
          validUntil: PAST,
          workspaceId: 'ws1',
          ...overrides,
        }),
        responsible: { id: 'u1', name: 'Ana', email: 'ana@acme.com' },
        workspace: { id: 'ws1', name: 'Acme', slug: 'acme' },
      }
    }

    it('should expire overdue proposals and notify the responsible', async () => {
      mockedProposalRepo.listExpirationCandidates.mockResolvedValue(
        ok([candidate({ id: 'p1', name: 'Proposta ERP' })]),
      )
      mockedProposalRepo.markExpired.mockResolvedValue(ok(true))

      const result = expectOk(await CrmProposalService.expireDue())

      expect(result).toEqual({ candidates: 1, expired: 1, notified: 1 })
      expect(mockedProposalRepo.markExpired).toHaveBeenCalledWith(
        'p1',
        expect.any(Date),
      )
      expect(mockedSendExpired).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'ana@acme.com',
          proposalName: 'Proposta ERP',
          proposalUrl: expect.stringContaining('/acme/crm/proposals/p1'),
        }),
      )
      expect(notifyCrmProposalExpired).toHaveBeenCalledWith({
        workspaceId: 'ws1',
        proposal: expect.objectContaining({ id: 'p1' }),
      })
    })

    it('should not notify when the workspace turned the e-mail off', async () => {
      mockedSettingsRepo.findByWorkspace.mockResolvedValue(
        ok(createFakeCrmSettings({ notifyProposalExpiry: false })),
      )
      mockedProposalRepo.listExpirationCandidates.mockResolvedValue(
        ok([candidate({ id: 'p1' })]),
      )
      mockedProposalRepo.markExpired.mockResolvedValue(ok(true))

      const result = expectOk(await CrmProposalService.expireDue())

      expect(result.expired).toBe(1)
      expect(result.notified).toBe(0)
      expect(mockedSendExpired).not.toHaveBeenCalled()
      // The e-mail toggle is workspace-wide; in-app has per-user mute.
      expect(notifyCrmProposalExpired).toHaveBeenCalled()
    })

    it('should keep a proposal valid until the end of its last day', async () => {
      const now = new Date('2026-10-10T20:00:00.000Z') // 17:00 em São Paulo
      mockedProposalRepo.listExpirationCandidates.mockResolvedValue(
        ok([
          candidate({
            id: 'p1',
            validUntil: new Date('2026-10-10T15:00:00.000Z'),
          }),
        ]),
      )

      const result = expectOk(await CrmProposalService.expireDue(now))

      expect(result).toEqual({ candidates: 1, expired: 0, notified: 0 })
      expect(mockedProposalRepo.markExpired).not.toHaveBeenCalled()
    })

    it('should not notify twice when the proposal was already handled', async () => {
      mockedProposalRepo.listExpirationCandidates.mockResolvedValue(
        ok([candidate({ id: 'p1' })]),
      )
      mockedProposalRepo.markExpired.mockResolvedValue(ok(false))

      const result = expectOk(await CrmProposalService.expireDue())
      expect(result).toEqual({ candidates: 1, expired: 0, notified: 0 })
      expect(mockedSendExpired).not.toHaveBeenCalled()
    })

    it('should keep going when the e-mail fails', async () => {
      mockedProposalRepo.listExpirationCandidates.mockResolvedValue(
        ok([candidate({ id: 'p1' }), candidate({ id: 'p2' })]),
      )
      mockedProposalRepo.markExpired.mockResolvedValue(ok(true))
      mockedSendExpired
        .mockRejectedValueOnce(new Error('resend down'))
        .mockResolvedValueOnce({ id: 'mail' })

      const result = expectOk(await CrmProposalService.expireDue())
      expect(result).toEqual({ candidates: 2, expired: 2, notified: 1 })
    })
  })
})

describe('CrmProposalService — authz, errors and edge branches', () => {
  const dbErr = () => err(databaseError())
  const nf = () => err(notFound('Proposta'))

  describe('reads', () => {
    it('should list proposals for a VIEWER', async () => {
      mockRole('VIEWER')
      mockedProposalRepo.listByWorkspace.mockResolvedValue(
        ok([{ ...createFakeCrmProposal({ id: 'p1' }), _count: { views: 0 } }]),
      )
      const list = expectOk(await CrmProposalService.list('u1', 'ws1'))
      expect(list.map((p) => p.id)).toEqual(['p1'])
    })

    it('should propagate list repository errors', async () => {
      mockRole('VIEWER')
      mockedProposalRepo.listByWorkspace.mockResolvedValue(dbErr())
      expectErr(await CrmProposalService.list('u1', 'ws1'), 'DATABASE_ERROR')
    })

    it('should return MODULE_DISABLED when the CRM is off', async () => {
      mockRole('OWNER')
      mockedModuleAccess.isEnabled.mockResolvedValueOnce(ok(false))
      expectErr(await CrmProposalService.list('u1', 'ws1'), 'MODULE_DISABLED')
    })

    it('should return a proposal by id', async () => {
      mockRole('VIEWER')
      mockedProposalRepo.findById.mockResolvedValue(
        ok(fakeProposalWithSections({ id: 'p1' })),
      )
      const dto = expectOk(await CrmProposalService.getById('u1', 'ws1', 'p1'))
      expect(dto.id).toBe('p1')
    })

    it('should deny getById for a non-member and propagate NOT_FOUND', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValueOnce(
        ok(null),
      )
      expectErr(
        await CrmProposalService.getById('u1', 'ws1', 'p1'),
        'FORBIDDEN',
      )
      mockRole('VIEWER')
      mockedProposalRepo.findById.mockResolvedValue(nf())
      expectErr(
        await CrmProposalService.getById('u1', 'ws1', 'p1'),
        'RESOURCE_NOT_FOUND',
      )
    })
  })

  describe('create() related entities and failures', () => {
    const base = { name: 'P', responsibleId: 'u2', sections: [] }

    it('should deny a VIEWER', async () => {
      mockRole('VIEWER')
      expectErr(await CrmProposalService.create('u1', 'ws1', base), 'FORBIDDEN')
      expect(mockedProposalRepo.create).not.toHaveBeenCalled()
    })

    it('should validate company, contact and opportunity in the workspace', async () => {
      mockRole('MEMBER')
      mockedCompanyRepo.findById.mockResolvedValue(ok({} as never))
      mockedPersonRepo.findById.mockResolvedValue(ok({} as never))
      mockedOpportunityRepo.findById.mockResolvedValue(ok({} as never))
      mockedProposalRepo.create.mockResolvedValue(
        ok(fakeProposalWithSections({ id: 'p1' })),
      )
      expectOk(
        await CrmProposalService.create('u1', 'ws1', {
          ...base,
          companyId: 'c1',
          contactId: 'pe1',
          opportunityId: 'o1',
        }),
      )
      expect(mockedCompanyRepo.findById).toHaveBeenCalledWith('c1', 'ws1')
      expect(mockedPersonRepo.findById).toHaveBeenCalledWith('pe1', 'ws1')
      expect(mockedOpportunityRepo.findById).toHaveBeenCalledWith('o1', 'ws1')
      expect(mockedAudit).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'create', targetId: 'p1' }),
      )
    })

    it('should reject a company from another workspace', async () => {
      mockRole('MEMBER')
      mockedCompanyRepo.findById.mockResolvedValue(err(notFound('Empresa')))
      expectErr(
        await CrmProposalService.create('u1', 'ws1', {
          ...base,
          companyId: 'c1',
        }),
        'RESOURCE_NOT_FOUND',
      )
    })

    it('should reject a contact from another workspace', async () => {
      mockRole('MEMBER')
      mockedPersonRepo.findById.mockResolvedValue(err(notFound('Pessoa')))
      expectErr(
        await CrmProposalService.create('u1', 'ws1', {
          ...base,
          contactId: 'pe1',
        }),
        'RESOURCE_NOT_FOUND',
      )
    })

    it('should reject an opportunity from another workspace', async () => {
      mockRole('MEMBER')
      mockedOpportunityRepo.findById.mockResolvedValue(
        err(notFound('Oportunidade')),
      )
      expectErr(
        await CrmProposalService.create('u1', 'ws1', {
          ...base,
          opportunityId: 'o1',
        }),
        'RESOURCE_NOT_FOUND',
      )
    })

    it('should reject a responsible who is not a workspace member', async () => {
      mockedMembershipRepo.findByUserAndWorkspace
        .mockResolvedValueOnce(ok(createFakeMembership({ role: 'MEMBER' })))
        .mockResolvedValueOnce(ok(null))
      expectErr(await CrmProposalService.create('u1', 'ws1', base), 'FORBIDDEN')
    })

    it('should propagate a missing template', async () => {
      mockRole('MEMBER')
      mockedTemplateRepo.findById.mockResolvedValue(err(notFound('Template')))
      expectErr(
        await CrmProposalService.create('u1', 'ws1', {
          ...base,
          templateId: 't1',
        }),
        'RESOURCE_NOT_FOUND',
      )
    })

    it('should skip disabled or empty template sections', async () => {
      mockRole('MEMBER')
      const section = {
        templateId: 't1',
        type: 'COVER' as const,
        order: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      }
      mockedTemplateRepo.findById.mockResolvedValue(
        ok({
          ...createFakeCrmProposalTemplate({ id: 't1' }),
          sections: [
            {
              ...section,
              id: 's1',
              enabled: false,
              defaultContent: { type: 'COVER', title: 'x' },
            },
            { ...section, id: 's2', enabled: true, defaultContent: null },
          ],
        }),
      )
      mockedProposalRepo.create.mockResolvedValue(
        ok(fakeProposalWithSections({ id: 'p1' })),
      )
      expectOk(
        await CrmProposalService.create('u1', 'ws1', {
          ...base,
          templateId: 't1',
        }),
      )
      expect(mockedProposalRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ sections: [] }),
      )
    })

    it('should propagate settings errors when defaulting validity', async () => {
      mockRole('MEMBER')
      mockedSettingsRepo.findByWorkspace.mockResolvedValue(dbErr())
      expectErr(
        await CrmProposalService.create('u1', 'ws1', base),
        'DATABASE_ERROR',
      )
      expect(mockedProposalRepo.create).not.toHaveBeenCalled()
    })

    it('should audit a failed creation', async () => {
      mockRole('MEMBER')
      mockedProposalRepo.create.mockResolvedValue(dbErr())
      expectErr(
        await CrmProposalService.create('u1', 'ws1', base),
        'DATABASE_ERROR',
      )
      expect(mockedAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          outcome: 'failure',
          reason: 'DATABASE_ERROR',
        }),
      )
    })
  })

  describe('update() branches', () => {
    it('should deny a VIEWER', async () => {
      mockRole('VIEWER')
      expectErr(
        await CrmProposalService.update('u1', 'ws1', 'p1', { name: 'x' }),
        'FORBIDDEN',
      )
    })

    it('should propagate NOT_FOUND', async () => {
      mockRole('MEMBER')
      mockedProposalRepo.findById.mockResolvedValue(nf())
      expectErr(
        await CrmProposalService.update('u1', 'ws1', 'p1', { name: 'x' }),
        'RESOURCE_NOT_FOUND',
      )
    })

    it('should validate related entities passed on update', async () => {
      mockRole('MEMBER')
      mockedProposalRepo.findById.mockResolvedValue(
        ok(fakeProposalWithSections({ id: 'p1' })),
      )
      mockedCompanyRepo.findById.mockResolvedValue(err(notFound('Empresa')))
      expectErr(
        await CrmProposalService.update('u1', 'ws1', 'p1', {
          companyId: 'c1',
        }),
        'RESOURCE_NOT_FOUND',
      )
      expect(mockedProposalRepo.update).not.toHaveBeenCalled()
    })

    it('should block accepting an EXPIRED proposal even with a future date', async () => {
      mockRole('OWNER')
      mockedProposalRepo.findById.mockResolvedValue(
        ok(fakeProposalWithSections({ status: 'EXPIRED', validUntil: null })),
      )
      const error = expectErr(
        await CrmProposalService.update('u1', 'ws1', 'p1', {
          status: 'ACCEPTED',
          validUntil: future(),
        }),
        'CRM_PROPOSAL_EXPIRED',
      )
      expect(error.message).not.toContain(' em ')
    })

    it('should accept a proposal still within validity', async () => {
      mockRole('MEMBER')
      const existing = fakeProposalWithSections({
        status: 'SENT',
        validUntil: future(),
      })
      mockedProposalRepo.findById.mockResolvedValue(ok(existing))
      mockedProposalRepo.update.mockResolvedValue(
        ok({ ...existing, status: 'ACCEPTED' }),
      )
      expectOk(
        await CrmProposalService.update('u1', 'ws1', 'p1', {
          status: 'ACCEPTED',
        }),
      )
      expect(mockedProposalRepo.update).toHaveBeenCalledWith(
        'p1',
        expect.objectContaining({ status: 'ACCEPTED', expiredAt: undefined }),
      )
    })

    it('should require a future date when an admin reopens an expired proposal', async () => {
      mockRole('ADMIN')
      mockedProposalRepo.findById.mockResolvedValue(
        ok(fakeProposalWithSections({ status: 'EXPIRED', validUntil: PAST })),
      )
      expectErr(
        await CrmProposalService.update('u1', 'ws1', 'p1', {
          validUntil: new Date('2026-01-12T12:00:00.000Z'),
        }),
        'VALIDATION_ERROR',
      )
    })

    it('should keep an explicit status when an admin reopens an expired proposal', async () => {
      mockRole('ADMIN')
      const existing = fakeProposalWithSections({
        status: 'EXPIRED',
        validUntil: PAST,
      })
      mockedProposalRepo.findById.mockResolvedValue(ok(existing))
      mockedProposalRepo.update.mockResolvedValue(
        ok({ ...existing, status: 'DRAFT' }),
      )
      expectOk(
        await CrmProposalService.update('u1', 'ws1', 'p1', {
          status: 'DRAFT',
          validUntil: future(),
        }),
      )
      expect(mockedViewRepo.countByProposal).not.toHaveBeenCalled()
      expect(mockedProposalRepo.update).toHaveBeenCalledWith(
        'p1',
        expect.objectContaining({ status: 'DRAFT', expiredAt: null }),
      )
    })

    it('should propagate view count errors when reopening', async () => {
      mockRole('OWNER')
      mockedProposalRepo.findById.mockResolvedValue(
        ok(fakeProposalWithSections({ status: 'EXPIRED', validUntil: PAST })),
      )
      mockedViewRepo.countByProposal.mockResolvedValue(dbErr())
      expectErr(
        await CrmProposalService.update('u1', 'ws1', 'p1', {
          validUntil: future(),
        }),
        'DATABASE_ERROR',
      )
    })

    it('should let a MEMBER clear the validity of an open proposal', async () => {
      mockRole('MEMBER')
      const existing = fakeProposalWithSections({
        status: 'SENT',
        validUntil: future(),
      })
      mockedProposalRepo.findById.mockResolvedValue(ok(existing))
      mockedProposalRepo.update.mockResolvedValue(
        ok({ ...existing, validUntil: null }),
      )
      expectOk(
        await CrmProposalService.update('u1', 'ws1', 'p1', {
          validUntil: null,
        }),
      )
      expect(mockedProposalRepo.update).toHaveBeenCalledWith(
        'p1',
        expect.objectContaining({ validUntil: null, expiredAt: undefined }),
      )
    })

    it('should let a MEMBER rename an expired proposal without reopening it', async () => {
      mockRole('MEMBER')
      const existing = fakeProposalWithSections({
        status: 'EXPIRED',
        validUntil: PAST,
      })
      mockedProposalRepo.findById.mockResolvedValue(ok(existing))
      mockedProposalRepo.update.mockResolvedValue(ok(existing))
      expectOk(
        await CrmProposalService.update('u1', 'ws1', 'p1', {
          name: 'Renomeada',
          status: 'EXPIRED',
        }),
      )
      expect(mockedProposalRepo.update).toHaveBeenCalledWith(
        'p1',
        expect.objectContaining({ status: 'EXPIRED', expiredAt: undefined }),
      )
    })

    it('should propagate update errors without auditing', async () => {
      mockRole('MEMBER')
      mockedProposalRepo.findById.mockResolvedValue(
        ok(fakeProposalWithSections()),
      )
      mockedProposalRepo.update.mockResolvedValue(dbErr())
      expectErr(
        await CrmProposalService.update('u1', 'ws1', 'p1', { name: 'x' }),
        'DATABASE_ERROR',
      )
      expect(mockedAudit).not.toHaveBeenCalled()
    })
  })

  describe('remove()', () => {
    it('should deny a MEMBER (members cannot delete documents)', async () => {
      mockRole('MEMBER')
      expectErr(await CrmProposalService.remove('u1', 'ws1', 'p1'), 'FORBIDDEN')
      expect(mockedProposalRepo.softDelete).not.toHaveBeenCalled()
    })

    it('should soft delete for an ADMIN and audit', async () => {
      mockRole('ADMIN')
      mockedProposalRepo.findById.mockResolvedValue(
        ok(fakeProposalWithSections({ id: 'p1' })),
      )
      mockedProposalRepo.softDelete.mockResolvedValue(ok(undefined as never))
      expectOk(await CrmProposalService.remove('u1', 'ws1', 'p1'))
      expect(mockedAudit).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'delete', targetId: 'p1' }),
      )
    })

    it('should propagate NOT_FOUND and soft delete errors', async () => {
      mockRole('OWNER')
      mockedProposalRepo.findById.mockResolvedValueOnce(nf())
      expectErr(
        await CrmProposalService.remove('u1', 'ws1', 'p1'),
        'RESOURCE_NOT_FOUND',
      )

      mockedProposalRepo.findById.mockResolvedValue(
        ok(fakeProposalWithSections()),
      )
      mockedProposalRepo.softDelete.mockResolvedValue(dbErr())
      expectErr(
        await CrmProposalService.remove('u1', 'ws1', 'p1'),
        'DATABASE_ERROR',
      )
    })
  })

  describe('reorder()', () => {
    it('should delegate to the repository for a MEMBER', async () => {
      mockRole('MEMBER')
      mockedProposalRepo.reorder.mockResolvedValue(ok(undefined))
      expectOk(await CrmProposalService.reorder('u1', 'ws1', ['a', 'b']))
      expect(mockedProposalRepo.reorder).toHaveBeenCalledWith('ws1', ['a', 'b'])
    })

    it('should deny a VIEWER', async () => {
      mockRole('VIEWER')
      expectErr(
        await CrmProposalService.reorder('u1', 'ws1', ['a']),
        'FORBIDDEN',
      )
    })
  })

  describe('getMetrics()', () => {
    it('should compute metrics for an existing proposal', async () => {
      mockRole('VIEWER')
      mockedProposalRepo.findById.mockResolvedValue(
        ok(fakeProposalWithSections({ id: 'p1' })),
      )
      mockedViewRepo.metricsFor.mockResolvedValue(
        ok({
          totalViews: 4,
          uniqueVisitors: 2,
          completed: 1,
          avgDurationMs: 1000,
          views: [],
        }),
      )
      const dto = expectOk(
        await CrmProposalService.getMetrics('u1', 'ws1', 'p1'),
      )
      expect(dto).toMatchObject({ totalViews: 4, completionRate: 0.25 })
    })

    it('should deny a non-member', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(ok(null))
      expectErr(
        await CrmProposalService.getMetrics('u1', 'ws1', 'p1'),
        'FORBIDDEN',
      )
    })

    it('should propagate NOT_FOUND and metrics errors', async () => {
      mockRole('VIEWER')
      mockedProposalRepo.findById.mockResolvedValueOnce(nf())
      expectErr(
        await CrmProposalService.getMetrics('u1', 'ws1', 'p1'),
        'RESOURCE_NOT_FOUND',
      )
      mockedProposalRepo.findById.mockResolvedValue(
        ok(fakeProposalWithSections()),
      )
      mockedViewRepo.metricsFor.mockResolvedValue(dbErr())
      expectErr(
        await CrmProposalService.getMetrics('u1', 'ws1', 'p1'),
        'DATABASE_ERROR',
      )
    })
  })

  describe('public routes', () => {
    const view = {
      viewId: 'v',
      durationMs: 0,
      reachedEnd: false,
      scrolledPct: 0,
    }

    it('should propagate an unknown share token', async () => {
      mockedProposalRepo.findByShareToken.mockResolvedValue(nf())
      expectErr(
        await CrmProposalService.getPublicByShareToken('x'),
        'RESOURCE_NOT_FOUND',
      )
      expectErr(
        await CrmProposalService.recordView('x', '1.1.1.1', view),
        'RESOURCE_NOT_FOUND',
      )
      expectErr(
        await CrmProposalService.accept('x', '1.1.1.1', { name: 'M' }),
        'RESOURCE_NOT_FOUND',
      )
    })

    it('should block public access when the CRM module is disabled', async () => {
      mockedProposalRepo.findByShareToken.mockResolvedValue(
        ok(fakeProposalWithSections({ status: 'SENT', validUntil: future() })),
      )
      mockedModuleAccess.isEnabled.mockResolvedValue(ok(false))
      expectErr(
        await CrmProposalService.getPublicByShareToken('tok'),
        'MODULE_DISABLED',
      )
      expectErr(
        await CrmProposalService.recordView('tok', '1.1.1.1', view),
        'MODULE_DISABLED',
      )
      expectErr(
        await CrmProposalService.accept('tok', '1.1.1.1', { name: 'M' }),
        'MODULE_DISABLED',
      )
      expect(mockedProposalRepo.setStatus).not.toHaveBeenCalled()
      expect(mockedProposalRepo.accept).not.toHaveBeenCalled()
      mockedModuleAccess.isEnabled.mockResolvedValue(ok(true))
    })

    it('should not re-mark an already viewed proposal', async () => {
      mockedProposalRepo.findByShareToken.mockResolvedValue(
        ok(fakeProposalWithSections({ status: 'VIEWED' })),
      )
      expectOk(await CrmProposalService.getPublicByShareToken('tok'))
      expect(mockedProposalRepo.setStatus).not.toHaveBeenCalled()
    })

    it('should propagate view recording errors', async () => {
      mockedProposalRepo.findByShareToken.mockResolvedValue(
        ok(fakeProposalWithSections()),
      )
      mockedViewRepo.record.mockResolvedValue(dbErr())
      expectErr(
        await CrmProposalService.recordView('tok', '1.1.1.1', view),
        'DATABASE_ERROR',
      )
    })
  })

  describe('send() branches', () => {
    it('should deny a VIEWER and propagate NOT_FOUND', async () => {
      mockRole('VIEWER')
      expectErr(await CrmProposalService.send('u1', 'ws1', 'p1'), 'FORBIDDEN')
      mockRole('MEMBER')
      mockedProposalRepo.findById.mockResolvedValue(nf())
      expectErr(
        await CrmProposalService.send('u1', 'ws1', 'p1'),
        'RESOURCE_NOT_FOUND',
      )
    })

    it('should refuse an EXPIRED proposal even without a date', async () => {
      mockRole('MEMBER')
      mockedProposalRepo.findById.mockResolvedValue(
        ok(fakeProposalWithSections({ status: 'EXPIRED', validUntil: null })),
      )
      expectErr(
        await CrmProposalService.send('u1', 'ws1', 'p1'),
        'CRM_PROPOSAL_EXPIRED',
      )
    })

    it('should propagate setStatus errors', async () => {
      mockRole('MEMBER')
      mockedProposalRepo.findById.mockResolvedValue(
        ok(fakeProposalWithSections({ status: 'DRAFT', validUntil: future() })),
      )
      mockedProposalRepo.setStatus.mockResolvedValue(dbErr())
      expectErr(
        await CrmProposalService.send('u1', 'ws1', 'p1'),
        'DATABASE_ERROR',
      )
      expect(mockedAudit).not.toHaveBeenCalled()
    })
  })

  describe('extendValidity() branches', () => {
    it('should propagate NOT_FOUND', async () => {
      mockRole('ADMIN')
      mockedProposalRepo.findById.mockResolvedValue(nf())
      expectErr(
        await CrmProposalService.extendValidity('u1', 'ws1', 'p1', {
          validUntil: future(),
        }),
        'RESOURCE_NOT_FOUND',
      )
    })

    it('should refuse a REJECTED proposal', async () => {
      mockRole('OWNER')
      mockedProposalRepo.findById.mockResolvedValue(
        ok(fakeProposalWithSections({ status: 'REJECTED' })),
      )
      expectErr(
        await CrmProposalService.extendValidity('u1', 'ws1', 'p1', {
          validUntil: future(),
        }),
        'CONFLICT',
      )
    })

    it('should propagate view count errors for an expired proposal', async () => {
      mockRole('OWNER')
      mockedProposalRepo.findById.mockResolvedValue(
        ok(fakeProposalWithSections({ status: 'EXPIRED', validUntil: PAST })),
      )
      mockedViewRepo.countByProposal.mockResolvedValue(dbErr())
      expectErr(
        await CrmProposalService.extendValidity('u1', 'ws1', 'p1', {
          validUntil: future(),
        }),
        'DATABASE_ERROR',
      )
    })

    it('should propagate update errors and audit a missing previous date as null', async () => {
      mockRole('OWNER')
      const existing = fakeProposalWithSections({
        status: 'DRAFT',
        validUntil: null,
      })
      mockedProposalRepo.findById.mockResolvedValue(ok(existing))
      mockedProposalRepo.update.mockResolvedValueOnce(dbErr())
      expectErr(
        await CrmProposalService.extendValidity('u1', 'ws1', 'p1', {
          validUntil: future(),
        }),
        'DATABASE_ERROR',
      )

      const next = future()
      mockedProposalRepo.update.mockResolvedValue(
        ok({ ...existing, validUntil: next }),
      )
      expectOk(
        await CrmProposalService.extendValidity('u1', 'ws1', 'p1', {
          validUntil: next,
        }),
      )
      expect(mockedAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          meta: expect.objectContaining({
            previousValidUntil: null,
            reopenedFromExpired: false,
          }),
        }),
      )
    })
  })

  describe('accept() branches', () => {
    it('should refuse a DRAFT with the default message', async () => {
      mockedProposalRepo.findByShareToken.mockResolvedValue(
        ok(fakeProposalWithSections({ status: 'DRAFT', validUntil: null })),
      )
      const error = expectErr(
        await CrmProposalService.accept('tok', '1.1.1.1', { name: 'M' }),
        'CRM_PROPOSAL_NOT_ACCEPTABLE',
      )
      expect(error.message).not.toBe('Esta proposta já foi aceita')
    })

    it('should block an EXPIRED proposal without a date', async () => {
      mockedProposalRepo.findByShareToken.mockResolvedValue(
        ok(fakeProposalWithSections({ status: 'EXPIRED', validUntil: null })),
      )
      expectErr(
        await CrmProposalService.accept('tok', '1.1.1.1', { name: 'M' }),
        'CRM_PROPOSAL_EXPIRED',
      )
    })

    it('should propagate accept errors', async () => {
      mockedProposalRepo.findByShareToken.mockResolvedValue(
        ok(fakeProposalWithSections({ status: 'SENT', validUntil: future() })),
      )
      mockedProposalRepo.accept.mockResolvedValue(dbErr())
      expectErr(
        await CrmProposalService.accept('tok', '1.1.1.1', { name: 'M' }),
        'DATABASE_ERROR',
      )
    })

    it('should propagate errors reloading the accepted proposal', async () => {
      mockedProposalRepo.findByShareToken
        .mockResolvedValueOnce(
          ok(
            fakeProposalWithSections({ status: 'SENT', validUntil: future() }),
          ),
        )
        .mockResolvedValueOnce(dbErr())
      mockedProposalRepo.accept.mockResolvedValue(ok(true))
      expectErr(
        await CrmProposalService.accept('tok', '1.1.1.1', { name: 'M' }),
        'DATABASE_ERROR',
      )
      expect(mockedAudit).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'accept', actorId: null }),
      )
    })
  })

  describe('expireDue() branches', () => {
    function candidate(id: string, workspaceId = 'ws1') {
      return {
        ...createFakeCrmProposal({
          id,
          status: 'SENT',
          validUntil: PAST,
          workspaceId,
        }),
        responsible: { id: 'u1', name: 'Ana', email: 'ana@acme.com' },
        workspace: { id: workspaceId, name: 'Acme', slug: 'acme' },
      }
    }

    it('should propagate candidate listing errors', async () => {
      mockedProposalRepo.listExpirationCandidates.mockResolvedValue(dbErr())
      expectErr(await CrmProposalService.expireDue(), 'DATABASE_ERROR')
    })

    it('should log and skip proposals that fail to be marked', async () => {
      mockedProposalRepo.listExpirationCandidates.mockResolvedValue(
        ok([candidate('p1')]),
      )
      mockedProposalRepo.markExpired.mockResolvedValue(dbErr())
      const result = expectOk(await CrmProposalService.expireDue())
      expect(result).toEqual({ candidates: 1, expired: 0, notified: 0 })
      expect(mockedLogger.error).toHaveBeenCalledWith(
        'crm.proposal.expire_failed',
        expect.objectContaining({ proposalId: 'p1' }),
      )
    })

    it('should resolve settings once per workspace and skip on settings errors', async () => {
      mockedProposalRepo.listExpirationCandidates.mockResolvedValue(
        ok([candidate('p1'), candidate('p2'), candidate('p3', 'ws2')]),
      )
      mockedProposalRepo.markExpired.mockResolvedValue(ok(true))
      mockedSettingsRepo.findByWorkspace.mockImplementation(async (ws) =>
        ws === 'ws2' ? dbErr() : ok(null),
      )
      mockedSendExpired.mockResolvedValue({ id: 'mail' } as never)

      const result = expectOk(await CrmProposalService.expireDue())
      expect(result).toEqual({ candidates: 3, expired: 3, notified: 2 })
      expect(mockedSettingsRepo.findByWorkspace).toHaveBeenCalledTimes(2)
    })

    it('should log non-Error e-mail failures', async () => {
      mockedProposalRepo.listExpirationCandidates.mockResolvedValue(
        ok([candidate('p1')]),
      )
      mockedProposalRepo.markExpired.mockResolvedValue(ok(true))
      mockedSendExpired.mockRejectedValueOnce('boom')
      const result = expectOk(await CrmProposalService.expireDue())
      expect(result.notified).toBe(0)
      expect(mockedLogger.warn).toHaveBeenCalledWith(
        'crm.proposal.expiry_email_failed',
        expect.objectContaining({ message: 'boom' }),
      )
    })
  })
})
