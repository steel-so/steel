import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createFakeCrmLead,
  createFakeCrmLeadContactAttempt,
  createFakeCrmLeadMeeting,
  createFakeCrmLeadProposalPresentation,
  createFakeCrmLeadQualification,
  createFakeCrmLeadReopening,
  createFakeLostCrmLead,
} from '@/src/__tests__/factories/crm-lead.factory'
import { createFakeCrmSettings } from '@/src/__tests__/factories/crm-settings.factory'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { ok } from '@/src/lib/result'

vi.mock('@/src/services/crm-notifications')
vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/crm-lead.repository')
vi.mock('@/src/repositories/crm-lead-scoring-rule.repository')
vi.mock('@/src/repositories/crm-lead-routing-rule.repository')
vi.mock('@/src/repositories/crm-person.repository')
vi.mock('@/src/repositories/crm-proposal.repository')
vi.mock('@/src/repositories/crm-settings.repository')
vi.mock('@/src/services/crm-workflow-dispatcher')

import { createFakeCrmPerson } from '@/src/__tests__/factories/crm-person.factory'
import { createFakeCrmProposal } from '@/src/__tests__/factories/crm-proposal.factory'
import { CrmLeadRepository } from '@/src/repositories/crm-lead.repository'
import { CrmLeadRoutingRuleRepository } from '@/src/repositories/crm-lead-routing-rule.repository'
import { CrmLeadScoringRuleRepository } from '@/src/repositories/crm-lead-scoring-rule.repository'
import { CrmPersonRepository } from '@/src/repositories/crm-person.repository'
import { CrmProposalRepository } from '@/src/repositories/crm-proposal.repository'
import { CrmSettingsRepository } from '@/src/repositories/crm-settings.repository'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { WorkspaceModuleAccessRepository } from '@/src/repositories/workspace-module-access.repository'
import { notifyCrmLeadCreated } from '@/src/services/crm-notifications'
import { CrmLeadService } from '../crm-lead.service'
import { dispatchCrmWorkflowRecordEvent } from '../crm-workflow-dispatcher'

const mockedMembershipRepo = vi.mocked(MembershipRepository)
const mockedLeadRepo = vi.mocked(CrmLeadRepository)
const mockedScoringRepo = vi.mocked(CrmLeadScoringRuleRepository)
const mockedRoutingRepo = vi.mocked(CrmLeadRoutingRuleRepository)
const mockedPersonRepo = vi.mocked(CrmPersonRepository)
const mockedProposalRepo = vi.mocked(CrmProposalRepository)
const mockedDispatch = vi.mocked(dispatchCrmWorkflowRecordEvent)
const mockedSettingsRepo = vi.mocked(CrmSettingsRepository)

beforeEach(() => {
  // Sem configurações salvas -> valores padrão (reabre em RECEIVED, 15 dias).
  mockedSettingsRepo.findByWorkspace.mockResolvedValue(ok(null))
})

function mockNoRules() {
  mockedScoringRepo.listActiveByWorkspace.mockResolvedValue(ok([]))
  mockedRoutingRepo.listActiveByWorkspace.mockResolvedValue(ok([]))
}

const wonDto = {
  contractSignedAt: new Date(),
  billingType: 'MONTHLY' as const,
  closedAmount: 1500,
  contractSignedConfirmed: true as const,
}

function mockMember() {
  mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
    ok(createFakeMembership({ role: 'MEMBER' })),
  )
}

describe('CrmLeadService', () => {
  describe('create()', () => {
    it('should compute score and owner from active rules', async () => {
      mockMember()
      mockedLeadRepo.findOpenByContacts.mockResolvedValue(ok(null))
      mockedScoringRepo.listActiveByWorkspace.mockResolvedValue(
        ok([
          {
            id: 'r1',
            workspaceId: 'ws1',
            field: 'email',
            operator: 'is_not_empty',
            value: null,
            points: 10,
            active: true,
            position: 0,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ]),
      )
      mockedRoutingRepo.listActiveByWorkspace.mockResolvedValue(ok([]))
      mockedLeadRepo.create.mockResolvedValue(
        ok(createFakeCrmLead({ score: 10, emails: ['a@b.com'] })),
      )

      const dto = expectOk(
        await CrmLeadService.create('u1', 'ws1', {
          name: 'Jane',
          emails: ['a@b.com'],
          phones: [],
          source: 'WhatsApp',
        }),
      )
      expect(dto.score).toBe(10)
      expect(mockedLeadRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ score: 10, createdById: 'u1' }),
      )
    })

    it('should reject a duplicate of an open lead with CRM_LEAD_DUPLICATE', async () => {
      mockMember()
      mockedLeadRepo.findOpenByContacts.mockResolvedValue(
        ok(createFakeCrmLead({ id: 'l0', emails: ['jane@acme.com'] })),
      )

      expectErr(
        await CrmLeadService.create('u1', 'ws1', {
          name: 'Jane',
          emails: ['Jane@Acme.com'],
          phones: [],
          source: 'ads',
        }),
        'CRM_LEAD_DUPLICATE',
      )
      expect(mockedLeadRepo.findOpenByContacts).toHaveBeenCalledWith('ws1', {
        emails: ['jane@acme.com'],
        phones: [],
      })
      expect(mockedLeadRepo.create).not.toHaveBeenCalled()
    })

    it('should return FORBIDDEN for a non-member', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(ok(null))
      expectErr(
        await CrmLeadService.create('u1', 'ws1', {
          name: 'Jane',
          emails: ['a@b.com'],
          source: 'ads',
        }),
        'FORBIDDEN',
      )
    })

    it('should fire the lead "created" workflow trigger', async () => {
      mockMember()
      mockNoRules()
      mockedLeadRepo.findOpenByContacts.mockResolvedValue(ok(null))
      mockedLeadRepo.create.mockResolvedValue(
        ok(createFakeCrmLead({ id: 'l1', workspaceId: 'ws1' })),
      )

      expectOk(
        await CrmLeadService.create('u1', 'ws1', {
          name: 'Jane',
          emails: ['a@b.com'],
          source: 'ads',
        }),
      )
      expect(mockedDispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: 'ws1',
          actorUserId: 'u1',
          entity: 'lead',
          event: 'created',
        }),
      )
    })
  })

  describe('intake()', () => {
    const system = {
      kind: 'system' as const,
      createdById: 'owner1',
      via: 'form' as const,
      refId: 'f1',
    }

    it('should refuse any intake channel when the CRM is disabled', async () => {
      vi.mocked(
        WorkspaceModuleAccessRepository.isEnabled,
      ).mockResolvedValueOnce(ok(false))

      expectErr(
        await CrmLeadService.intake('ws1', system, {
          name: 'Jane',
          phones: ['81 99999-0000'],
          source: 'form',
        }),
        'MODULE_DISABLED',
      )
      expect(mockedLeadRepo.findOpenByContacts).not.toHaveBeenCalled()
      expect(mockedLeadRepo.create).not.toHaveBeenCalled()
    })

    it('should score, route and attribute a system intake to the channel owner', async () => {
      mockedLeadRepo.findOpenByContacts.mockResolvedValue(ok(null))
      mockedScoringRepo.listActiveByWorkspace.mockResolvedValue(ok([]))
      mockedRoutingRepo.listActiveByWorkspace.mockResolvedValue(
        ok([
          {
            id: 'rr1',
            workspaceId: 'ws1',
            field: 'source',
            operator: 'equals',
            value: 'form',
            ownerId: 'seller1',
            active: true,
            position: 0,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ]),
      )
      mockedLeadRepo.create.mockResolvedValue(
        ok(createFakeCrmLead({ id: 'l1', ownerId: 'seller1' })),
      )

      const result = expectOk(
        await CrmLeadService.intake('ws1', system, {
          name: 'Jane',
          phones: ['81 99999-0000'],
          source: 'form',
        }),
      )
      expect(result.created).toBe(true)
      expect(mockedLeadRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ createdById: 'owner1', ownerId: 'seller1' }),
      )
      expect(mockedLeadRepo.findOpenByContacts).toHaveBeenCalledWith('ws1', {
        emails: [],
        phones: ['81999990000'],
      })
      expect(mockedMembershipRepo.findByUserAndWorkspace).not.toHaveBeenCalled()
    })

    it('should record the external key and stay quiet in bulk mode', async () => {
      mockedLeadRepo.findOpenByContacts.mockResolvedValue(ok(null))
      mockedScoringRepo.listActiveByWorkspace.mockResolvedValue(ok([]))
      mockedRoutingRepo.listActiveByWorkspace.mockResolvedValue(ok([]))
      mockedLeadRepo.create.mockResolvedValue(
        ok(createFakeCrmLead({ id: 'l9' })),
      )
      vi.mocked(notifyCrmLeadCreated).mockClear()

      expectOk(
        await CrmLeadService.intake(
          'ws1',
          { ...system, via: 'apollo' },
          { name: 'Ana', emails: ['ana@acme.com'], source: 'Apollo' },
          { quiet: true, external: { source: 'apollo', id: 'p1' } },
        ),
      )
      expect(mockedLeadRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ externalSource: 'apollo', externalId: 'p1' }),
      )
      expect(notifyCrmLeadCreated).not.toHaveBeenCalled()
    })

    it('should return the existing open lead instead of duplicating', async () => {
      mockedLeadRepo.findOpenByContacts.mockResolvedValue(
        ok(createFakeCrmLead({ id: 'l0' })),
      )

      const result = expectOk(
        await CrmLeadService.intake('ws1', system, {
          name: 'Jane',
          emails: ['jane@acme.com'],
          source: 'form',
        }),
      )
      expect(result).toMatchObject({ created: false, lead: { id: 'l0' } })
      expect(mockedLeadRepo.create).not.toHaveBeenCalled()
      expect(mockedDispatch).not.toHaveBeenCalled()
    })

    it('should apply the manual-creation validation (e-mail or phone required)', async () => {
      expectErr(
        await CrmLeadService.intake('ws1', system, {
          name: 'Jane',
          source: 'form',
        }),
        'VALIDATION_ERROR',
      )
      expect(mockedLeadRepo.create).not.toHaveBeenCalled()
    })
  })

  describe('convert() (legacy route)', () => {
    it('should reject converting a lead that was not closed as won', async () => {
      mockMember()
      mockedLeadRepo.findById.mockResolvedValue(
        ok(createFakeCrmLead({ id: 'l1', stage: 'QUALIFIED' })),
      )

      expectErr(
        await CrmLeadService.convert('u1', 'ws1', 'l1'),
        'CRM_LEAD_STAGE_TRANSITION_INVALID',
      )
      expect(mockedPersonRepo.create).not.toHaveBeenCalled()
    })

    it('should idempotently return the person linked to a won lead', async () => {
      mockMember()
      mockedLeadRepo.findById.mockResolvedValue(
        ok(
          createFakeCrmLead({
            id: 'l1',
            stage: 'CLOSED',
            closeResult: 'WON',
            convertedPersonId: 'p1',
          }),
        ),
      )
      mockedPersonRepo.findById.mockResolvedValue(
        ok(createFakeCrmPerson({ id: 'p1' })),
      )

      const dto = expectOk(await CrmLeadService.convert('u1', 'ws1', 'l1'))
      expect(dto.id).toBe('p1')
      expect(mockedPersonRepo.create).not.toHaveBeenCalled()
      expect(mockedLeadRepo.update).not.toHaveBeenCalled()
    })
  })

  describe('registerContactAttempt()', () => {
    it('should advance RECEIVED -> IN_CONTACT on the first attempt', async () => {
      mockMember()
      mockedLeadRepo.findById.mockResolvedValue(
        ok(createFakeCrmLead({ id: 'l1', stage: 'RECEIVED' })),
      )
      mockedLeadRepo.createContactAttempt.mockResolvedValue(
        ok(createFakeCrmLeadContactAttempt({ leadId: 'l1' })),
      )
      mockedLeadRepo.update.mockResolvedValue(
        ok(createFakeCrmLead({ id: 'l1', stage: 'IN_CONTACT' })),
      )

      const result = expectOk(
        await CrmLeadService.registerContactAttempt('u1', 'ws1', 'l1', {
          contactedWith: 'Maria',
          channel: 'PHONE',
          outcome: 'ATTEMPTED',
          occurredAt: new Date(),
        }),
      )
      expect(result.lead.stage).toBe('IN_CONTACT')
      expect(mockedLeadRepo.update).toHaveBeenCalledWith(
        'l1',
        expect.objectContaining({ stage: 'IN_CONTACT' }),
      )
    })

    it('should advance IN_CONTACT -> QUALIFIED only when outcome is REACHED', async () => {
      mockMember()
      mockedLeadRepo.findById.mockResolvedValue(
        ok(createFakeCrmLead({ id: 'l1', stage: 'IN_CONTACT' })),
      )
      mockedLeadRepo.createContactAttempt.mockResolvedValue(
        ok(
          createFakeCrmLeadContactAttempt({
            leadId: 'l1',
            outcome: 'ATTEMPTED',
          }),
        ),
      )

      const result = expectOk(
        await CrmLeadService.registerContactAttempt('u1', 'ws1', 'l1', {
          contactedWith: 'Maria',
          channel: 'PHONE',
          outcome: 'ATTEMPTED',
          occurredAt: new Date(),
        }),
      )
      expect(result.lead.stage).toBe('IN_CONTACT')
      expect(mockedLeadRepo.update).not.toHaveBeenCalled()
    })

    it('should reject registering an attempt on a closed lead', async () => {
      mockMember()
      mockedLeadRepo.findById.mockResolvedValue(
        ok(createFakeCrmLead({ id: 'l1', stage: 'CLOSED' })),
      )

      expectErr(
        await CrmLeadService.registerContactAttempt('u1', 'ws1', 'l1', {
          contactedWith: 'Maria',
          channel: 'PHONE',
          outcome: 'ATTEMPTED',
          occurredAt: new Date(),
        }),
        'CRM_LEAD_ALREADY_CLOSED',
      )
    })
  })

  describe('upsertQualification()', () => {
    it('should advance QUALIFIED -> OPPORTUNITY on first save', async () => {
      mockMember()
      mockedLeadRepo.findById.mockResolvedValue(
        ok(createFakeCrmLead({ id: 'l1', stage: 'QUALIFIED' })),
      )
      mockedLeadRepo.findQualification.mockResolvedValue(ok(null))
      mockedLeadRepo.upsertQualification.mockResolvedValue(
        ok(createFakeCrmLeadQualification({ leadId: 'l1' })),
      )
      mockedLeadRepo.update.mockResolvedValue(
        ok(createFakeCrmLead({ id: 'l1', stage: 'OPPORTUNITY' })),
      )

      const result = expectOk(
        await CrmLeadService.upsertQualification('u1', 'ws1', 'l1', {
          decisionMakerName: 'Carlos',
          decisionMakerRole: 'CTO',
        }),
      )
      expect(result.lead.stage).toBe('OPPORTUNITY')
    })

    it('should reject qualifying a lead still in IN_CONTACT', async () => {
      mockMember()
      mockedLeadRepo.findById.mockResolvedValue(
        ok(createFakeCrmLead({ id: 'l1', stage: 'IN_CONTACT' })),
      )
      mockedLeadRepo.findQualification.mockResolvedValue(ok(null))

      expectErr(
        await CrmLeadService.upsertQualification('u1', 'ws1', 'l1', {
          decisionMakerName: 'Carlos',
          decisionMakerRole: 'CTO',
        }),
        'CRM_LEAD_STAGE_TRANSITION_INVALID',
      )
    })
  })

  describe('registerMeeting()', () => {
    it('should reject registering a meeting outside OPPORTUNITY', async () => {
      mockMember()
      mockedLeadRepo.findById.mockResolvedValue(
        ok(createFakeCrmLead({ id: 'l1', stage: 'QUALIFIED' })),
      )

      expectErr(
        await CrmLeadService.registerMeeting('u1', 'ws1', 'l1', {
          scheduledAt: new Date(),
          format: 'ONLINE',
          interestDetails: 'x',
          identifiedNeed: 'y',
        }),
        'CRM_LEAD_STAGE_TRANSITION_INVALID',
      )
    })

    it('should register a meeting without changing the stage', async () => {
      mockMember()
      mockedLeadRepo.findById.mockResolvedValue(
        ok(createFakeCrmLead({ id: 'l1', stage: 'OPPORTUNITY' })),
      )
      mockedLeadRepo.createMeeting.mockResolvedValue(
        ok(createFakeCrmLeadMeeting({ leadId: 'l1' })),
      )

      const result = expectOk(
        await CrmLeadService.registerMeeting('u1', 'ws1', 'l1', {
          scheduledAt: new Date(),
          format: 'ONLINE',
          interestDetails: 'x',
          identifiedNeed: 'y',
        }),
      )
      expect(result.lead.stage).toBe('OPPORTUNITY')
      expect(mockedLeadRepo.update).not.toHaveBeenCalled()
    })
  })

  describe('createProposal()', () => {
    it('should advance OPPORTUNITY -> PROPOSAL when a meeting exists', async () => {
      mockMember()
      mockedLeadRepo.findById.mockResolvedValue(
        ok(createFakeCrmLead({ id: 'l1', stage: 'OPPORTUNITY' })),
      )
      mockedLeadRepo.listMeetings.mockResolvedValue(
        ok([createFakeCrmLeadMeeting({ leadId: 'l1' })]),
      )
      mockedProposalRepo.create.mockResolvedValue(
        ok({
          ...createFakeCrmProposal({ id: 'p1', leadId: 'l1' }),
          sections: [],
        }),
      )
      mockedLeadRepo.update.mockResolvedValue(
        ok(createFakeCrmLead({ id: 'l1', stage: 'PROPOSAL' })),
      )

      const result = expectOk(
        await CrmLeadService.createProposal('u1', 'ws1', 'l1', {
          name: 'Proposta X',
        }),
      )
      expect(result.lead.stage).toBe('PROPOSAL')
      expect(result.proposal.id).toBe('p1')
    })

    it('should default the validity to the workspace setting', async () => {
      mockMember()
      mockedSettingsRepo.findByWorkspace.mockResolvedValue(
        ok(createFakeCrmSettings({ proposalValidityDays: 30 })),
      )
      mockedLeadRepo.findById.mockResolvedValue(
        ok(createFakeCrmLead({ id: 'l1', stage: 'OPPORTUNITY' })),
      )
      mockedLeadRepo.listMeetings.mockResolvedValue(
        ok([createFakeCrmLeadMeeting({ leadId: 'l1' })]),
      )
      mockedProposalRepo.create.mockResolvedValue(
        ok({ ...createFakeCrmProposal({ id: 'p1' }), sections: [] }),
      )
      mockedLeadRepo.update.mockResolvedValue(
        ok(createFakeCrmLead({ id: 'l1', stage: 'PROPOSAL' })),
      )

      expectOk(
        await CrmLeadService.createProposal('u1', 'ws1', 'l1', {
          name: 'Proposta X',
        }),
      )

      const validUntil = mockedProposalRepo.create.mock.calls[0]?.[0]
        .validUntil as Date
      const days = (validUntil.getTime() - Date.now()) / 86_400_000
      expect(days).toBeGreaterThan(29)
      expect(days).toBeLessThanOrEqual(31)
    })

    it('should reject creating a proposal with no meeting registered', async () => {
      mockMember()
      mockedLeadRepo.findById.mockResolvedValue(
        ok(createFakeCrmLead({ id: 'l1', stage: 'OPPORTUNITY' })),
      )
      mockedLeadRepo.listMeetings.mockResolvedValue(ok([]))

      expectErr(
        await CrmLeadService.createProposal('u1', 'ws1', 'l1', {
          name: 'Proposta X',
        }),
        'CRM_LEAD_STAGE_REQUIREMENTS_NOT_MET',
      )
    })
  })

  describe('registerProposalPresentation()', () => {
    it('should register a presentation for the lead proposal', async () => {
      mockMember()
      mockedLeadRepo.findById.mockResolvedValue(
        ok(createFakeCrmLead({ id: 'l1', stage: 'PROPOSAL' })),
      )
      mockedProposalRepo.findById.mockResolvedValue(
        ok({
          ...createFakeCrmProposal({ id: 'p1', leadId: 'l1' }),
          sections: [],
        }),
      )
      mockedLeadRepo.createProposalPresentation.mockResolvedValue(
        ok(
          createFakeCrmLeadProposalPresentation({
            leadId: 'l1',
            proposalId: 'p1',
          }),
        ),
      )

      const result = expectOk(
        await CrmLeadService.registerProposalPresentation(
          'u1',
          'ws1',
          'l1',
          'p1',
          {
            presentedAt: new Date(),
            format: 'ONLINE',
            amount: 1500,
            interestLevel: 'HIGH',
            interactionsCount: 2,
          },
        ),
      )
      expect(result.presentation.leadId).toBe('l1')
    })

    it('should reject a proposal that belongs to another lead', async () => {
      mockMember()
      mockedLeadRepo.findById.mockResolvedValue(
        ok(createFakeCrmLead({ id: 'l1', stage: 'PROPOSAL' })),
      )
      mockedProposalRepo.findById.mockResolvedValue(
        ok({
          ...createFakeCrmProposal({ id: 'p1', leadId: 'other-lead' }),
          sections: [],
        }),
      )

      expectErr(
        await CrmLeadService.registerProposalPresentation(
          'u1',
          'ws1',
          'l1',
          'p1',
          {
            presentedAt: new Date(),
            format: 'ONLINE',
            amount: 1500,
            interestLevel: 'HIGH',
            interactionsCount: 2,
          },
        ),
        'CRM_LEAD_PROPOSAL_NOT_FOUND',
      )
    })
  })

  describe('closeWon()', () => {
    it('should convert the lead to a person when a presentation exists', async () => {
      mockMember()
      mockedLeadRepo.findById.mockResolvedValue(
        ok(createFakeCrmLead({ id: 'l1', stage: 'PROPOSAL' })),
      )
      mockedLeadRepo.listProposalPresentations.mockResolvedValue(
        ok([createFakeCrmLeadProposalPresentation({ leadId: 'l1' })]),
      )
      mockedPersonRepo.findFirstByContacts.mockResolvedValue(ok(null))
      mockedPersonRepo.create.mockResolvedValue(
        ok(createFakeCrmPerson({ id: 'p1' })),
      )
      mockedLeadRepo.update.mockResolvedValue(
        ok(createFakeCrmLead({ id: 'l1', stage: 'CLOSED' })),
      )

      const dto = expectOk(
        await CrmLeadService.closeWon('u1', 'ws1', 'l1', {
          contractSignedAt: new Date(),
          billingType: 'MONTHLY',
          closedAmount: 1500,
          contractSignedConfirmed: true,
        }),
      )
      expect(dto.id).toBe('p1')
      expect(mockedLeadRepo.update).toHaveBeenCalledWith(
        'l1',
        expect.objectContaining({ stage: 'CLOSED', closeResult: 'WON' }),
      )
    })

    it('should reuse the person already linked to the lead (no duplicate)', async () => {
      mockMember()
      mockedLeadRepo.findById.mockResolvedValue(
        ok(
          createFakeCrmLead({
            id: 'l1',
            stage: 'PROPOSAL',
            convertedPersonId: 'p1',
          }),
        ),
      )
      mockedLeadRepo.listProposalPresentations.mockResolvedValue(
        ok([createFakeCrmLeadProposalPresentation({ leadId: 'l1' })]),
      )
      mockedPersonRepo.findById.mockResolvedValue(
        ok(createFakeCrmPerson({ id: 'p1' })),
      )
      mockedLeadRepo.update.mockResolvedValue(
        ok(
          createFakeCrmLead({ id: 'l1', stage: 'CLOSED', closeResult: 'WON' }),
        ),
      )

      const dto = expectOk(
        await CrmLeadService.closeWon('u1', 'ws1', 'l1', wonDto),
      )
      expect(dto.id).toBe('p1')
      expect(mockedPersonRepo.create).not.toHaveBeenCalled()
      expect(mockedLeadRepo.update).toHaveBeenCalledWith(
        'l1',
        expect.objectContaining({ convertedPersonId: 'p1' }),
      )
    })

    it('should link an existing workspace person with the same e-mail', async () => {
      mockMember()
      mockedLeadRepo.findById.mockResolvedValue(
        ok(
          createFakeCrmLead({
            id: 'l1',
            stage: 'PROPOSAL',
            emails: ['Jane@Acme.com'],
          }),
        ),
      )
      mockedLeadRepo.listProposalPresentations.mockResolvedValue(
        ok([createFakeCrmLeadProposalPresentation({ leadId: 'l1' })]),
      )
      mockedPersonRepo.findFirstByContacts.mockResolvedValue(
        ok(createFakeCrmPerson({ id: 'p9' })),
      )
      mockedLeadRepo.update.mockResolvedValue(
        ok(
          createFakeCrmLead({ id: 'l1', stage: 'CLOSED', closeResult: 'WON' }),
        ),
      )

      const dto = expectOk(
        await CrmLeadService.closeWon('u1', 'ws1', 'l1', wonDto),
      )
      expect(dto.id).toBe('p9')
      expect(mockedPersonRepo.findFirstByContacts).toHaveBeenCalledWith('ws1', {
        emails: ['jane@acme.com'],
        phones: [],
      })
      expect(mockedPersonRepo.create).not.toHaveBeenCalled()
    })

    it('should fire stage-changed and won lead workflow events', async () => {
      mockMember()
      mockedLeadRepo.findById.mockResolvedValue(
        ok(createFakeCrmLead({ id: 'l1', stage: 'PROPOSAL' })),
      )
      mockedLeadRepo.listProposalPresentations.mockResolvedValue(
        ok([createFakeCrmLeadProposalPresentation({ leadId: 'l1' })]),
      )
      mockedPersonRepo.findFirstByContacts.mockResolvedValue(ok(null))
      mockedPersonRepo.create.mockResolvedValue(
        ok(createFakeCrmPerson({ id: 'p1' })),
      )
      mockedLeadRepo.update.mockResolvedValue(
        ok(
          createFakeCrmLead({ id: 'l1', stage: 'CLOSED', closeResult: 'WON' }),
        ),
      )

      expectOk(await CrmLeadService.closeWon('u1', 'ws1', 'l1', wonDto))
      expect(mockedDispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          entity: 'lead',
          event: 'updated',
          leadEvents: ['stage-changed', 'won'],
        }),
      )
    })

    it('should reject closing won without a proposal presentation', async () => {
      mockMember()
      mockedLeadRepo.findById.mockResolvedValue(
        ok(createFakeCrmLead({ id: 'l1', stage: 'PROPOSAL' })),
      )
      mockedLeadRepo.listProposalPresentations.mockResolvedValue(ok([]))

      expectErr(
        await CrmLeadService.closeWon('u1', 'ws1', 'l1', {
          contractSignedAt: new Date(),
          billingType: 'MONTHLY',
          closedAmount: 1500,
          contractSignedConfirmed: true,
        }),
        'CRM_LEAD_STAGE_REQUIREMENTS_NOT_MET',
      )
    })

    it('should reject closing won from a stage before PROPOSAL', async () => {
      mockMember()
      mockedLeadRepo.findById.mockResolvedValue(
        ok(createFakeCrmLead({ id: 'l1', stage: 'OPPORTUNITY' })),
      )

      expectErr(
        await CrmLeadService.closeWon('u1', 'ws1', 'l1', {
          contractSignedAt: new Date(),
          billingType: 'MONTHLY',
          closedAmount: 1500,
          contractSignedConfirmed: true,
        }),
        'CRM_LEAD_STAGE_TRANSITION_INVALID',
      )
    })
  })

  describe('closeLost()', () => {
    it('should close an early-stage lead as lost without a presentation', async () => {
      mockMember()
      mockedLeadRepo.findById.mockResolvedValue(
        ok(createFakeCrmLead({ id: 'l1', stage: 'IN_CONTACT' })),
      )
      mockedLeadRepo.update.mockResolvedValue(
        ok(
          createFakeCrmLead({
            id: 'l1',
            stage: 'CLOSED',
            closeResult: 'LOST',
          }),
        ),
      )

      const dto = expectOk(
        await CrmLeadService.closeLost('u1', 'ws1', 'l1', {
          lostReason: 'Sem resposta',
        }),
      )
      expect(dto.closeResult).toBe('LOST')
    })

    it('should fire stage-changed and lost lead workflow events', async () => {
      mockMember()
      mockedLeadRepo.findById.mockResolvedValue(
        ok(createFakeCrmLead({ id: 'l1', stage: 'IN_CONTACT' })),
      )
      mockedLeadRepo.update.mockResolvedValue(
        ok(
          createFakeCrmLead({ id: 'l1', stage: 'CLOSED', closeResult: 'LOST' }),
        ),
      )

      expectOk(
        await CrmLeadService.closeLost('u1', 'ws1', 'l1', {
          lostReason: 'Preço',
        }),
      )
      expect(mockedDispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          entity: 'lead',
          event: 'updated',
          leadEvents: ['stage-changed', 'lost'],
        }),
      )
    })

    it('should reject closing an already closed lead', async () => {
      mockMember()
      mockedLeadRepo.findById.mockResolvedValue(
        ok(createFakeCrmLead({ id: 'l1', stage: 'CLOSED' })),
      )

      expectErr(
        await CrmLeadService.closeLost('u1', 'ws1', 'l1', {
          lostReason: 'Sem resposta',
        }),
        'CRM_LEAD_ALREADY_CLOSED',
      )
    })
  })

  describe('reopen()', () => {
    function mockGateRecords(records: {
      attempts?: ('ATTEMPTED' | 'REACHED')[]
      qualified?: boolean
      proposal?: boolean
    }) {
      mockedLeadRepo.listContactAttempts.mockResolvedValue(
        ok(
          (records.attempts ?? []).map((outcome) =>
            createFakeCrmLeadContactAttempt({ leadId: 'l1', outcome }),
          ),
        ),
      )
      mockedLeadRepo.findQualification.mockResolvedValue(
        ok(
          records.qualified
            ? createFakeCrmLeadQualification({ leadId: 'l1' })
            : null,
        ),
      )
      mockedProposalRepo.findLatestByLeadId.mockResolvedValue(
        ok(
          records.proposal
            ? { ...createFakeCrmProposal({ leadId: 'l1' }), sections: [] }
            : null,
        ),
      )
    }

    it('should move a lost lead back to the first stage by default', async () => {
      mockMember()
      const lost = createFakeLostCrmLead({ id: 'l1' })
      mockedLeadRepo.findById.mockResolvedValue(ok(lost))
      mockGateRecords({})
      mockedLeadRepo.reopen.mockResolvedValue(
        ok(createFakeCrmLead({ id: 'l1', stage: 'RECEIVED' })),
      )

      const dto = expectOk(
        await CrmLeadService.reopen('u1', 'ws1', 'l1', {
          reason: 'Cliente voltou a responder',
        }),
      )

      expect(dto.stage).toBe('RECEIVED')
      expect(dto.closeResult).toBeNull()
      expect(mockedLeadRepo.reopen).toHaveBeenCalledWith('l1', {
        workspaceId: 'ws1',
        toStage: 'RECEIVED',
        reason: 'Cliente voltou a responder',
        reopenedById: 'u1',
      })
    })

    it('should use the configured reopen stage when the lead has its gate records', async () => {
      mockMember()
      mockedSettingsRepo.findByWorkspace.mockResolvedValue(
        ok(createFakeCrmSettings({ leadReopenStage: 'OPPORTUNITY' })),
      )
      mockedLeadRepo.findById.mockResolvedValue(
        ok(createFakeLostCrmLead({ id: 'l1' })),
      )
      mockGateRecords({ attempts: ['REACHED'], qualified: true })
      mockedLeadRepo.reopen.mockResolvedValue(
        ok(createFakeCrmLead({ id: 'l1', stage: 'OPPORTUNITY' })),
      )

      expectOk(
        await CrmLeadService.reopen('u1', 'ws1', 'l1', { reason: 'Retomou' }),
      )
      expect(mockedLeadRepo.reopen).toHaveBeenCalledWith(
        'l1',
        expect.objectContaining({ toStage: 'OPPORTUNITY' }),
      )
    })

    it('should never skip a stage gate: clamps to the furthest stage the records allow', async () => {
      mockMember()
      mockedSettingsRepo.findByWorkspace.mockResolvedValue(
        ok(createFakeCrmSettings({ leadReopenStage: 'PROPOSAL' })),
      )
      mockedLeadRepo.findById.mockResolvedValue(
        ok(createFakeLostCrmLead({ id: 'l1' })),
      )
      // Só houve tentativa de contato (sem conversa efetiva).
      mockGateRecords({ attempts: ['ATTEMPTED'] })
      mockedLeadRepo.reopen.mockResolvedValue(
        ok(createFakeCrmLead({ id: 'l1', stage: 'IN_CONTACT' })),
      )

      expectOk(
        await CrmLeadService.reopen('u1', 'ws1', 'l1', { reason: 'Retomou' }),
      )
      expect(mockedLeadRepo.reopen).toHaveBeenCalledWith(
        'l1',
        expect.objectContaining({ toStage: 'IN_CONTACT' }),
      )
    })

    it('should fire the stage-changed lead workflow trigger', async () => {
      mockMember()
      mockedLeadRepo.findById.mockResolvedValue(
        ok(createFakeLostCrmLead({ id: 'l1' })),
      )
      mockGateRecords({})
      mockedLeadRepo.reopen.mockResolvedValue(
        ok(createFakeCrmLead({ id: 'l1', stage: 'RECEIVED' })),
      )

      expectOk(
        await CrmLeadService.reopen('u1', 'ws1', 'l1', { reason: 'Retomou' }),
      )
      expect(mockedDispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          entity: 'lead',
          event: 'updated',
          leadEvents: ['stage-changed'],
        }),
      )
    })

    it('should refuse to reopen a won lead', async () => {
      mockMember()
      mockedLeadRepo.findById.mockResolvedValue(
        ok(
          createFakeCrmLead({ id: 'l1', stage: 'CLOSED', closeResult: 'WON' }),
        ),
      )

      expectErr(
        await CrmLeadService.reopen('u1', 'ws1', 'l1', { reason: 'x' }),
        'CRM_LEAD_REOPEN_NOT_ALLOWED',
      )
      expect(mockedLeadRepo.reopen).not.toHaveBeenCalled()
    })

    it('should refuse to reopen a lead that is still open', async () => {
      mockMember()
      mockedLeadRepo.findById.mockResolvedValue(
        ok(createFakeCrmLead({ id: 'l1', stage: 'QUALIFIED' })),
      )

      expectErr(
        await CrmLeadService.reopen('u1', 'ws1', 'l1', { reason: 'x' }),
        'CRM_LEAD_REOPEN_NOT_ALLOWED',
      )
    })

    it('should require EDIT on leads', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
        ok(createFakeMembership({ role: 'VIEWER' })),
      )

      expectErr(
        await CrmLeadService.reopen('u1', 'ws1', 'l1', { reason: 'x' }),
        'FORBIDDEN',
      )
      expect(mockedLeadRepo.findById).not.toHaveBeenCalled()
    })
  })

  describe('listReopenings()', () => {
    it('should list the reopening history of a lead', async () => {
      mockMember()
      mockedLeadRepo.findById.mockResolvedValue(
        ok(createFakeCrmLead({ id: 'l1' })),
      )
      mockedLeadRepo.listReopenings.mockResolvedValue(
        ok([createFakeCrmLeadReopening({ leadId: 'l1', reason: 'Retomou' })]),
      )

      const list = expectOk(
        await CrmLeadService.listReopenings('u1', 'ws1', 'l1'),
      )
      expect(list).toHaveLength(1)
      expect(list[0]?.reason).toBe('Retomou')
      expect(typeof list[0]?.createdAt).toBe('string')
    })
  })
})
