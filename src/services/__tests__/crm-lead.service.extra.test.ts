import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createFakeCrmLead,
  createFakeCrmLeadContactAttempt,
  createFakeCrmLeadMeeting,
  createFakeCrmLeadProposalPresentation,
  createFakeCrmLeadQualification,
  type createFakeCrmLeadReopening,
  createFakeLostCrmLead,
} from '@/src/__tests__/factories/crm-lead.factory'
import { createFakeCrmSettings } from '@/src/__tests__/factories/crm-settings.factory'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { crmProposalNotFound, databaseError, notFound } from '@/src/errors'
import { err, ok, type Result } from '@/src/lib/result'

vi.mock('@/src/services/crm-notifications')
vi.mock('@/lib/axiom/audit')
vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/crm-lead.repository')
vi.mock('@/src/repositories/crm-lead-scoring-rule.repository')
vi.mock('@/src/repositories/crm-lead-routing-rule.repository')
vi.mock('@/src/repositories/crm-person.repository')
vi.mock('@/src/repositories/crm-proposal.repository')
vi.mock('@/src/repositories/crm-settings.repository')
vi.mock('@/src/services/crm-workflow-dispatcher')

import { auditMutation } from '@/lib/axiom/audit'
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
import { CrmLeadService } from '../crm-lead.service'
import {
  notifyCrmDealClosed,
  notifyCrmLeadAssigned,
} from '../crm-notifications'
import { dispatchCrmWorkflowRecordEvent } from '../crm-workflow-dispatcher'

const mockedMembershipRepo = vi.mocked(MembershipRepository)
const mockedLeadRepo = vi.mocked(CrmLeadRepository)
const mockedScoringRepo = vi.mocked(CrmLeadScoringRuleRepository)
const mockedRoutingRepo = vi.mocked(CrmLeadRoutingRuleRepository)
const mockedPersonRepo = vi.mocked(CrmPersonRepository)
const mockedProposalRepo = vi.mocked(CrmProposalRepository)
const mockedSettingsRepo = vi.mocked(CrmSettingsRepository)
const mockedDispatch = vi.mocked(dispatchCrmWorkflowRecordEvent)
const mockedAudit = vi.mocked(auditMutation)

const dbErr = () => err(databaseError())

const scoringRule = {
  id: 'r1',
  workspaceId: 'ws1',
  field: 'company' as const,
  operator: 'is_not_empty' as const,
  value: null,
  points: 7,
  active: true,
  includeWelcome: true,
  position: 0,
  createdAt: new Date(),
  updatedAt: new Date(),
}

const attemptDto = {
  contactedWith: 'Maria',
  channel: 'PHONE' as const,
  outcome: 'REACHED' as const,
  occurredAt: new Date(),
}

const meetingDto = {
  scheduledAt: new Date(),
  format: 'ONLINE' as const,
  interestDetails: 'x',
  identifiedNeed: 'y',
}

const presentationDto = {
  presentedAt: new Date(),
  format: 'ONLINE' as const,
  amount: 1500,
  interestLevel: 'HIGH' as const,
  interactionsCount: 2,
}

const wonDto = {
  contractSignedAt: new Date(),
  billingType: 'MONTHLY' as const,
  closedAmount: 1500,
  contractSignedConfirmed: true as const,
}

function mockRole(role: 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER' = 'MEMBER') {
  mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
    ok(createFakeMembership({ role })),
  )
}

function proposalWithSections(
  overrides?: Parameters<typeof createFakeCrmProposal>[0],
) {
  return { ...createFakeCrmProposal(overrides), sections: [] }
}

beforeEach(() => {
  mockedSettingsRepo.findByWorkspace.mockResolvedValue(ok(null))
})

describe('CrmLeadService — authorization gates', () => {
  // Cada operação passa pela checagem de membro + módulo + permissão antes de
  // tocar em qualquer repositório.
  const calls: [string, () => Promise<Result<unknown>>][] = [
    ['list', () => CrmLeadService.list('u1', 'ws1', {})],
    ['getById', () => CrmLeadService.getById('u1', 'ws1', 'l1')],
    [
      'create',
      () =>
        CrmLeadService.create('u1', 'ws1', {
          name: 'Jane',
          emails: ['a@b.com'],
          source: 'ads',
        }),
    ],
    ['update', () => CrmLeadService.update('u1', 'ws1', 'l1', { name: 'X' })],
    ['remove', () => CrmLeadService.remove('u1', 'ws1', 'l1')],
    ['reorder', () => CrmLeadService.reorder('u1', 'ws1', ['l1'])],
    ['convert', () => CrmLeadService.convert('u1', 'ws1', 'l1')],
    [
      'getActiveProposal',
      () => CrmLeadService.getActiveProposal('u1', 'ws1', 'l1'),
    ],
    [
      'registerContactAttempt',
      () =>
        CrmLeadService.registerContactAttempt('u1', 'ws1', 'l1', attemptDto),
    ],
    [
      'listContactAttempts',
      () => CrmLeadService.listContactAttempts('u1', 'ws1', 'l1'),
    ],
    [
      'setInterestProducts',
      () => CrmLeadService.setInterestProducts('u1', 'ws1', 'l1', ['p1']),
    ],
    [
      'upsertQualification',
      () =>
        CrmLeadService.upsertQualification('u1', 'ws1', 'l1', {
          decisionMakerName: 'C',
          decisionMakerRole: 'CTO',
        }),
    ],
    [
      'getQualification',
      () => CrmLeadService.getQualification('u1', 'ws1', 'l1'),
    ],
    [
      'registerMeeting',
      () => CrmLeadService.registerMeeting('u1', 'ws1', 'l1', meetingDto),
    ],
    ['listMeetings', () => CrmLeadService.listMeetings('u1', 'ws1', 'l1')],
    [
      'createProposal',
      () => CrmLeadService.createProposal('u1', 'ws1', 'l1', { name: 'P' }),
    ],
    [
      'registerProposalPresentation',
      () =>
        CrmLeadService.registerProposalPresentation(
          'u1',
          'ws1',
          'l1',
          'p1',
          presentationDto,
        ),
    ],
    [
      'listProposalPresentations',
      () => CrmLeadService.listProposalPresentations('u1', 'ws1', 'l1', 'p1'),
    ],
    ['closeWon', () => CrmLeadService.closeWon('u1', 'ws1', 'l1', wonDto)],
    [
      'closeLost',
      () => CrmLeadService.closeLost('u1', 'ws1', 'l1', { lostReason: 'x' }),
    ],
    ['reopen', () => CrmLeadService.reopen('u1', 'ws1', 'l1', { reason: 'x' })],
    ['listReopenings', () => CrmLeadService.listReopenings('u1', 'ws1', 'l1')],
  ]

  it.each(calls)(
    '%s: should return FORBIDDEN for a non-member',
    async (_, call) => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(ok(null))
      expectErr(await call(), 'FORBIDDEN')
      expect(mockedLeadRepo.findById).not.toHaveBeenCalled()
      expect(mockedLeadRepo.create).not.toHaveBeenCalled()
    },
  )

  it.each(calls)(
    '%s: should return MODULE_DISABLED when the CRM is off',
    async (_, call) => {
      mockRole('OWNER')
      vi.mocked(
        WorkspaceModuleAccessRepository.isEnabled,
      ).mockResolvedValueOnce(ok(false))
      expectErr(await call(), 'MODULE_DISABLED')
      expect(mockedLeadRepo.findById).not.toHaveBeenCalled()
    },
  )

  const writes = calls.filter(
    ([name]) =>
      ![
        'list',
        'getById',
        'getActiveProposal',
        'listContactAttempts',
        'getQualification',
        'listMeetings',
        'listProposalPresentations',
        'listReopenings',
      ].includes(name),
  )

  it.each(writes)(
    '%s: should return FORBIDDEN for a VIEWER',
    async (_, call) => {
      mockRole('VIEWER')
      expectErr(await call(), 'FORBIDDEN')
      expect(mockedLeadRepo.update).not.toHaveBeenCalled()
    },
  )

  // Leituras passam por findById; o NOT_FOUND do repositório propaga.
  const byId = calls.filter(
    ([name]) => !['list', 'create', 'reorder'].includes(name),
  )

  it.each(byId)(
    '%s: should propagate a missing lead as RESOURCE_NOT_FOUND',
    async (_, call) => {
      mockRole('OWNER')
      mockedLeadRepo.findById.mockResolvedValue(err(notFound('CrmLead')))
      expectErr(await call(), 'RESOURCE_NOT_FOUND')
    },
  )
})

describe('CrmLeadService — reads', () => {
  it('list() should filter by stage and map the leads', async () => {
    mockRole()
    mockedLeadRepo.listByWorkspace.mockResolvedValue(
      ok([createFakeCrmLead({ id: 'l1' }), createFakeCrmLead({ id: 'l2' })]),
    )

    const list = expectOk(
      await CrmLeadService.list('u1', 'ws1', { stage: 'QUALIFIED' }),
    )
    expect(list.map((l) => l.id)).toEqual(['l1', 'l2'])
    expect(mockedLeadRepo.listByWorkspace).toHaveBeenCalledWith('ws1', {
      stage: 'QUALIFIED',
    })
  })

  it('list() should propagate repository errors', async () => {
    mockRole()
    mockedLeadRepo.listByWorkspace.mockResolvedValue(dbErr())
    expectErr(await CrmLeadService.list('u1', 'ws1', {}), 'DATABASE_ERROR')
  })

  it('getById() should return the lead DTO', async () => {
    mockRole('VIEWER')
    mockedLeadRepo.findById.mockResolvedValue(
      ok(createFakeCrmLead({ id: 'l1', name: 'Jane' })),
    )
    const dto = expectOk(await CrmLeadService.getById('u1', 'ws1', 'l1'))
    expect(dto).toMatchObject({ id: 'l1', name: 'Jane' })
    expect(mockedLeadRepo.findById).toHaveBeenCalledWith('l1', 'ws1')
  })

  it('getActiveProposal() should return null when the lead has no proposal', async () => {
    mockRole()
    mockedLeadRepo.findById.mockResolvedValue(ok(createFakeCrmLead()))
    mockedProposalRepo.findLatestByLeadId.mockResolvedValue(ok(null))
    expect(
      expectOk(await CrmLeadService.getActiveProposal('u1', 'ws1', 'l1')),
    ).toBeNull()
  })

  it('getActiveProposal() should return the latest proposal of the lead', async () => {
    mockRole()
    mockedLeadRepo.findById.mockResolvedValue(ok(createFakeCrmLead()))
    mockedProposalRepo.findLatestByLeadId.mockResolvedValue(
      ok(proposalWithSections({ id: 'p1', leadId: 'l1' })),
    )
    const dto = expectOk(
      await CrmLeadService.getActiveProposal('u1', 'ws1', 'l1'),
    )
    expect(dto?.id).toBe('p1')
    expect(mockedProposalRepo.findLatestByLeadId).toHaveBeenCalledWith(
      'l1',
      'ws1',
    )
  })

  it('getActiveProposal() should propagate repository errors', async () => {
    mockRole()
    mockedLeadRepo.findById.mockResolvedValue(ok(createFakeCrmLead()))
    mockedProposalRepo.findLatestByLeadId.mockResolvedValue(dbErr())
    expectErr(
      await CrmLeadService.getActiveProposal('u1', 'ws1', 'l1'),
      'DATABASE_ERROR',
    )
  })

  it('listContactAttempts() should map the attempts', async () => {
    mockRole()
    mockedLeadRepo.findById.mockResolvedValue(ok(createFakeCrmLead()))
    mockedLeadRepo.listContactAttempts.mockResolvedValue(
      ok([createFakeCrmLeadContactAttempt({ leadId: 'l1' })]),
    )
    const list = expectOk(
      await CrmLeadService.listContactAttempts('u1', 'ws1', 'l1'),
    )
    expect(list).toHaveLength(1)
    expect(list[0]?.leadId).toBe('l1')
  })

  it('listContactAttempts() should propagate repository errors', async () => {
    mockRole()
    mockedLeadRepo.findById.mockResolvedValue(ok(createFakeCrmLead()))
    mockedLeadRepo.listContactAttempts.mockResolvedValue(dbErr())
    expectErr(
      await CrmLeadService.listContactAttempts('u1', 'ws1', 'l1'),
      'DATABASE_ERROR',
    )
  })

  it('getQualification() should return null when there is none', async () => {
    mockRole()
    mockedLeadRepo.findById.mockResolvedValue(ok(createFakeCrmLead()))
    mockedLeadRepo.findQualification.mockResolvedValue(ok(null))
    expect(
      expectOk(await CrmLeadService.getQualification('u1', 'ws1', 'l1')),
    ).toBeNull()
  })

  it('getQualification() should return the saved qualification', async () => {
    mockRole()
    mockedLeadRepo.findById.mockResolvedValue(ok(createFakeCrmLead()))
    mockedLeadRepo.findQualification.mockResolvedValue(
      ok(
        createFakeCrmLeadQualification({
          leadId: 'l1',
          decisionMakerName: 'Carlos',
        }),
      ),
    )
    const dto = expectOk(
      await CrmLeadService.getQualification('u1', 'ws1', 'l1'),
    )
    expect(dto?.decisionMakerName).toBe('Carlos')
  })

  it('getQualification() should propagate repository errors', async () => {
    mockRole()
    mockedLeadRepo.findById.mockResolvedValue(ok(createFakeCrmLead()))
    mockedLeadRepo.findQualification.mockResolvedValue(dbErr())
    expectErr(
      await CrmLeadService.getQualification('u1', 'ws1', 'l1'),
      'DATABASE_ERROR',
    )
  })

  it('listMeetings() should map the meetings', async () => {
    mockRole()
    mockedLeadRepo.findById.mockResolvedValue(ok(createFakeCrmLead()))
    mockedLeadRepo.listMeetings.mockResolvedValue(
      ok([createFakeCrmLeadMeeting({ leadId: 'l1' })]),
    )
    const list = expectOk(await CrmLeadService.listMeetings('u1', 'ws1', 'l1'))
    expect(list).toHaveLength(1)
  })

  it('listMeetings() should propagate repository errors', async () => {
    mockRole()
    mockedLeadRepo.findById.mockResolvedValue(ok(createFakeCrmLead()))
    mockedLeadRepo.listMeetings.mockResolvedValue(dbErr())
    expectErr(
      await CrmLeadService.listMeetings('u1', 'ws1', 'l1'),
      'DATABASE_ERROR',
    )
  })

  it('listProposalPresentations() should map only the proposal presentations', async () => {
    mockRole()
    mockedLeadRepo.findById.mockResolvedValue(ok(createFakeCrmLead()))
    mockedProposalRepo.findById.mockResolvedValue(
      ok(proposalWithSections({ id: 'p1', leadId: 'l1' })),
    )
    mockedLeadRepo.listProposalPresentations.mockResolvedValue(
      ok([
        createFakeCrmLeadProposalPresentation({
          leadId: 'l1',
          proposalId: 'p1',
        }),
      ]),
    )
    const list = expectOk(
      await CrmLeadService.listProposalPresentations('u1', 'ws1', 'l1', 'p1'),
    )
    expect(list[0]?.leadId).toBe('l1')
    expect(mockedProposalRepo.findById).toHaveBeenCalledWith('p1', 'ws1')
    expect(mockedLeadRepo.listProposalPresentations).toHaveBeenCalledWith(
      'l1',
      'p1',
    )
  })

  it('listProposalPresentations() should return CRM_LEAD_PROPOSAL_NOT_FOUND for a proposal of another lead', async () => {
    mockRole()
    mockedLeadRepo.findById.mockResolvedValue(ok(createFakeCrmLead()))
    mockedProposalRepo.findById.mockResolvedValue(
      ok(proposalWithSections({ id: 'p1', leadId: 'other-lead' })),
    )
    expectErr(
      await CrmLeadService.listProposalPresentations('u1', 'ws1', 'l1', 'p1'),
      'CRM_LEAD_PROPOSAL_NOT_FOUND',
    )
    expect(mockedLeadRepo.listProposalPresentations).not.toHaveBeenCalled()
  })

  it('listProposalPresentations() should propagate a missing proposal', async () => {
    mockRole()
    mockedLeadRepo.findById.mockResolvedValue(ok(createFakeCrmLead()))
    mockedProposalRepo.findById.mockResolvedValue(err(crmProposalNotFound()))
    expectErr(
      await CrmLeadService.listProposalPresentations('u1', 'ws1', 'l1', 'p1'),
      'CRM_PROPOSAL_NOT_FOUND',
    )
    expect(mockedLeadRepo.listProposalPresentations).not.toHaveBeenCalled()
  })

  it('listProposalPresentations() should propagate repository errors', async () => {
    mockRole()
    mockedLeadRepo.findById.mockResolvedValue(ok(createFakeCrmLead()))
    mockedProposalRepo.findById.mockResolvedValue(
      ok(proposalWithSections({ id: 'p1', leadId: 'l1' })),
    )
    mockedLeadRepo.listProposalPresentations.mockResolvedValue(dbErr())
    expectErr(
      await CrmLeadService.listProposalPresentations('u1', 'ws1', 'l1', 'p1'),
      'DATABASE_ERROR',
    )
  })

  it('listReopenings() should propagate repository errors', async () => {
    mockRole()
    mockedLeadRepo.findById.mockResolvedValue(ok(createFakeCrmLead()))
    mockedLeadRepo.listReopenings.mockResolvedValue(dbErr())
    expectErr(
      await CrmLeadService.listReopenings('u1', 'ws1', 'l1'),
      'DATABASE_ERROR',
    )
  })

  it('listReopenings() should return an empty history', async () => {
    mockRole()
    mockedLeadRepo.findById.mockResolvedValue(ok(createFakeCrmLead()))
    mockedLeadRepo.listReopenings.mockResolvedValue(
      ok([] as ReturnType<typeof createFakeCrmLeadReopening>[]),
    )
    expect(
      expectOk(await CrmLeadService.listReopenings('u1', 'ws1', 'l1')),
    ).toEqual([])
  })
})

describe('CrmLeadService.intake() — channels and failures', () => {
  const integration = {
    kind: 'system' as const,
    createdById: 'owner1',
    via: 'integration_api_key' as const,
    refId: 'key1',
  }

  function mockNoRules() {
    mockedScoringRepo.listActiveByWorkspace.mockResolvedValue(ok([]))
    mockedRoutingRepo.listActiveByWorkspace.mockResolvedValue(ok([]))
  }

  it('should dedupe an integration intake and audit it as a system action', async () => {
    mockedLeadRepo.findOpenByContacts.mockResolvedValue(
      ok(createFakeCrmLead({ id: 'l0' })),
    )

    const result = expectOk(
      await CrmLeadService.intake('ws1', integration, {
        name: 'Jane',
        emails: ['JANE@acme.com', 'jane@acme.com'],
        phones: ['(81) 9999-0000', '81 9999 0000'],
        source: 'api',
      }),
    )
    expect(result).toMatchObject({ created: false, lead: { id: 'l0' } })
    // e-mails normalizados e telefones só com dígitos, sem repetição.
    expect(mockedLeadRepo.findOpenByContacts).toHaveBeenCalledWith('ws1', {
      emails: ['jane@acme.com'],
      phones: ['8199990000'],
    })
    expect(mockedAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: null,
        targetId: 'l0',
        meta: {
          actor: 'system',
          via: 'integration_api_key',
          refId: 'key1',
          deduplicated: true,
        },
      }),
    )
  })

  it('should dedupe a manual intake and audit the user as the actor', async () => {
    mockedLeadRepo.findOpenByContacts.mockResolvedValue(
      ok(createFakeCrmLead({ id: 'l0' })),
    )

    const result = expectOk(
      await CrmLeadService.intake(
        'ws1',
        { kind: 'user', userId: 'u1' },
        { name: 'Jane', emails: ['jane@acme.com'], source: 'ads' },
      ),
    )
    expect(result.created).toBe(false)
    expect(mockedAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'u1',
        meta: { deduplicated: true },
      }),
    )
  })

  it('should propagate a dedupe lookup failure', async () => {
    mockedLeadRepo.findOpenByContacts.mockResolvedValue(dbErr())
    expectErr(
      await CrmLeadService.intake('ws1', integration, {
        name: 'Jane',
        emails: ['a@b.com'],
        source: 'api',
      }),
      'DATABASE_ERROR',
    )
    expect(mockedLeadRepo.create).not.toHaveBeenCalled()
  })

  it('should propagate a module-access lookup failure', async () => {
    vi.mocked(WorkspaceModuleAccessRepository.isEnabled).mockResolvedValueOnce(
      dbErr(),
    )
    expectErr(
      await CrmLeadService.intake('ws1', integration, {
        name: 'Jane',
        emails: ['a@b.com'],
        source: 'api',
      }),
      'DATABASE_ERROR',
    )
  })

  it('should propagate a scoring-rules failure', async () => {
    mockedLeadRepo.findOpenByContacts.mockResolvedValue(ok(null))
    mockedScoringRepo.listActiveByWorkspace.mockResolvedValue(dbErr())
    mockedRoutingRepo.listActiveByWorkspace.mockResolvedValue(ok([]))
    expectErr(
      await CrmLeadService.intake('ws1', integration, {
        name: 'Jane',
        emails: ['a@b.com'],
        source: 'api',
      }),
      'DATABASE_ERROR',
    )
    expect(mockedLeadRepo.create).not.toHaveBeenCalled()
  })

  it('should propagate a routing-rules failure', async () => {
    mockedLeadRepo.findOpenByContacts.mockResolvedValue(ok(null))
    mockedScoringRepo.listActiveByWorkspace.mockResolvedValue(ok([]))
    mockedRoutingRepo.listActiveByWorkspace.mockResolvedValue(dbErr())
    expectErr(
      await CrmLeadService.intake('ws1', integration, {
        name: 'Jane',
        emails: ['a@b.com'],
        source: 'api',
      }),
      'DATABASE_ERROR',
    )
    expect(mockedLeadRepo.create).not.toHaveBeenCalled()
  })

  it('should audit a failed creation with the channel metadata', async () => {
    mockedLeadRepo.findOpenByContacts.mockResolvedValue(ok(null))
    mockNoRules()
    mockedLeadRepo.create.mockResolvedValue(dbErr())

    expectErr(
      await CrmLeadService.intake('ws1', integration, {
        name: 'Jane',
        emails: ['a@b.com'],
        source: 'api',
      }),
      'DATABASE_ERROR',
    )
    expect(mockedAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'failure',
        reason: 'DATABASE_ERROR',
        actorId: null,
        meta: { actor: 'system', via: 'integration_api_key', refId: 'key1' },
      }),
    )
    expect(mockedDispatch).not.toHaveBeenCalled()
  })

  it('should create an integration lead attributed to the key owner', async () => {
    mockedLeadRepo.findOpenByContacts.mockResolvedValue(ok(null))
    mockNoRules()
    mockedLeadRepo.create.mockResolvedValue(
      ok(createFakeCrmLead({ id: 'l9', workspaceId: 'ws1' })),
    )

    const result = expectOk(
      await CrmLeadService.intake('ws1', integration, {
        name: 'Jane',
        emails: ['a@b.com'],
        source: 'api',
        company: 'Acme',
        jobTitle: 'CTO',
        city: 'Recife',
      }),
    )
    expect(result).toMatchObject({ created: true, lead: { id: 'l9' } })
    expect(mockedLeadRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        createdById: 'owner1',
        company: 'Acme',
        jobTitle: 'CTO',
        city: 'Recife',
        score: 0,
        ownerId: null,
      }),
    )
    expect(mockedDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ actorUserId: 'owner1', event: 'created' }),
    )
  })

  it('create() should propagate an intake failure', async () => {
    mockRole()
    mockedLeadRepo.findOpenByContacts.mockResolvedValue(dbErr())
    expectErr(
      await CrmLeadService.create('u1', 'ws1', {
        name: 'Jane',
        emails: ['a@b.com'],
        source: 'ads',
      }),
      'DATABASE_ERROR',
    )
  })
})

describe('CrmLeadService.update()', () => {
  it('should recompute the score from the merged fields when a relevant field changes', async () => {
    mockRole()
    const before = createFakeCrmLead({
      id: 'l1',
      stage: 'RECEIVED',
      company: null,
    })
    mockedLeadRepo.findById.mockResolvedValue(ok(before))
    mockedScoringRepo.listActiveByWorkspace.mockResolvedValue(ok([scoringRule]))
    mockedLeadRepo.update.mockResolvedValue(
      ok({ ...before, company: 'Acme', score: 7 }),
    )

    const dto = expectOk(
      await CrmLeadService.update('u1', 'ws1', 'l1', { company: 'Acme' }),
    )
    expect(dto.score).toBe(7)
    expect(mockedLeadRepo.update).toHaveBeenCalledWith(
      'l1',
      expect.objectContaining({
        company: 'Acme',
        score: 7,
        updatedById: 'u1',
      }),
    )
    expect(mockedAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'update',
        meta: { fields: ['company'] },
      }),
    )
    // Sem mudança de etapa/resultado: só o evento "updated", sem leadEvents.
    expect(mockedDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'updated',
        changedFields: ['company'],
        leadEvents: [],
      }),
    )
  })

  it('should keep the score untouched when only non-scoring fields change', async () => {
    mockRole()
    const before = createFakeCrmLead({ id: 'l1' })
    mockedLeadRepo.findById.mockResolvedValue(ok(before))
    mockedLeadRepo.update.mockResolvedValue(
      ok({ ...before, linkedin: 'in/jane' }),
    )

    expectOk(
      await CrmLeadService.update('u1', 'ws1', 'l1', {
        linkedin: 'in/jane',
        ownerId: 'u2',
      }),
    )
    expect(mockedScoringRepo.listActiveByWorkspace).not.toHaveBeenCalled()
    expect(mockedLeadRepo.update).toHaveBeenCalledWith(
      'l1',
      expect.objectContaining({ score: undefined, ownerId: 'u2' }),
    )
  })

  it.each([
    ['name', { name: 'X' }],
    ['emails', { emails: ['x@y.com'] }],
    ['phones', { phones: ['1234'] }],
    ['jobTitle', { jobTitle: 'CEO' }],
    ['source', { source: 'ads' }],
    ['city', { city: 'Olinda' }],
  ])('should rescore when %s changes', async (_, dto) => {
    mockRole()
    mockedLeadRepo.findById.mockResolvedValue(ok(createFakeCrmLead()))
    mockedScoringRepo.listActiveByWorkspace.mockResolvedValue(ok([]))
    mockedLeadRepo.update.mockResolvedValue(ok(createFakeCrmLead()))

    expectOk(await CrmLeadService.update('u1', 'ws1', 'l1', dto))
    expect(mockedScoringRepo.listActiveByWorkspace).toHaveBeenCalledWith('ws1')
    expect(mockedLeadRepo.update).toHaveBeenCalledWith(
      'l1',
      expect.objectContaining({ score: 0 }),
    )
  })

  it('should propagate a scoring-rules failure', async () => {
    mockRole()
    mockedLeadRepo.findById.mockResolvedValue(ok(createFakeCrmLead()))
    mockedScoringRepo.listActiveByWorkspace.mockResolvedValue(dbErr())
    expectErr(
      await CrmLeadService.update('u1', 'ws1', 'l1', { name: 'X' }),
      'DATABASE_ERROR',
    )
    expect(mockedLeadRepo.update).not.toHaveBeenCalled()
  })

  it('should propagate an update failure without auditing or dispatching', async () => {
    mockRole()
    mockedLeadRepo.findById.mockResolvedValue(ok(createFakeCrmLead()))
    mockedLeadRepo.update.mockResolvedValue(dbErr())
    expectErr(
      await CrmLeadService.update('u1', 'ws1', 'l1', { linkedin: 'x' }),
      'DATABASE_ERROR',
    )
    expect(mockedAudit).not.toHaveBeenCalled()
    expect(mockedDispatch).not.toHaveBeenCalled()
  })
})

describe('CrmLeadService.remove() / reorder() / setInterestProducts()', () => {
  it('remove() should soft delete, audit and fire the "deleted" trigger', async () => {
    mockRole('ADMIN')
    mockedLeadRepo.findById.mockResolvedValue(
      ok(createFakeCrmLead({ id: 'l1' })),
    )
    mockedLeadRepo.softDelete.mockResolvedValue(ok(undefined))

    expectOk(await CrmLeadService.remove('u1', 'ws1', 'l1'))
    expect(mockedLeadRepo.softDelete).toHaveBeenCalledWith('l1')
    expect(mockedAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'delete', targetId: 'l1' }),
    )
    expect(mockedDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'deleted',
        record: expect.objectContaining({ id: 'l1' }),
      }),
    )
  })

  it('remove() should propagate a soft-delete failure', async () => {
    mockRole('ADMIN')
    mockedLeadRepo.findById.mockResolvedValue(ok(createFakeCrmLead()))
    mockedLeadRepo.softDelete.mockResolvedValue(dbErr())
    expectErr(await CrmLeadService.remove('u1', 'ws1', 'l1'), 'DATABASE_ERROR')
    expect(mockedDispatch).not.toHaveBeenCalled()
  })

  it('reorder() should delegate to the repository', async () => {
    mockRole()
    mockedLeadRepo.reorder.mockResolvedValue(ok(undefined))
    expectOk(await CrmLeadService.reorder('u1', 'ws1', ['l2', 'l1']))
    expect(mockedLeadRepo.reorder).toHaveBeenCalledWith('ws1', ['l2', 'l1'])
  })

  it('setInterestProducts() should save the products and audit the count', async () => {
    mockRole()
    mockedLeadRepo.findById.mockResolvedValue(
      ok(createFakeCrmLead({ id: 'l1' })),
    )
    mockedLeadRepo.setInterestProducts.mockResolvedValue(ok(undefined))

    const dto = expectOk(
      await CrmLeadService.setInterestProducts('u1', 'ws1', 'l1', ['p1', 'p2']),
    )
    expect(dto.id).toBe('l1')
    expect(mockedLeadRepo.setInterestProducts).toHaveBeenCalledWith('l1', [
      'p1',
      'p2',
    ])
    expect(mockedAudit).toHaveBeenCalledWith(
      expect.objectContaining({ meta: { interestProducts: 2 } }),
    )
  })

  it('setInterestProducts() should propagate repository errors', async () => {
    mockRole()
    mockedLeadRepo.findById.mockResolvedValue(ok(createFakeCrmLead()))
    mockedLeadRepo.setInterestProducts.mockResolvedValue(dbErr())
    expectErr(
      await CrmLeadService.setInterestProducts('u1', 'ws1', 'l1', []),
      'DATABASE_ERROR',
    )
  })
})

describe('CrmLeadService.convert() (legacy route)', () => {
  const wonLead = (overrides?: Parameters<typeof createFakeCrmLead>[0]) =>
    createFakeCrmLead({
      id: 'l1',
      stage: 'CLOSED',
      closeResult: 'WON',
      convertedPersonId: null,
      ...overrides,
    })

  it('should fall back to dedupe/creation when the linked person was deleted', async () => {
    mockRole()
    mockedLeadRepo.findById.mockResolvedValue(
      ok(wonLead({ convertedPersonId: 'gone', city: 'Recife' })),
    )
    mockedPersonRepo.findById.mockResolvedValue(err(notFound('CrmPerson')))
    mockedPersonRepo.findFirstByContacts.mockResolvedValue(ok(null))
    mockedPersonRepo.create.mockResolvedValue(
      ok(createFakeCrmPerson({ id: 'p2' })),
    )
    mockedLeadRepo.update.mockResolvedValue(ok(wonLead()))

    const dto = expectOk(await CrmLeadService.convert('u1', 'ws1', 'l1'))
    expect(dto.id).toBe('p2')
    expect(mockedPersonRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ createdById: 'u1', city: 'Recife' }),
    )
    expect(mockedLeadRepo.update).toHaveBeenCalledWith('l1', {
      convertedPersonId: 'p2',
      updatedById: 'u1',
    })
    expect(mockedAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        meta: { converted: true, personId: 'p2', personCreated: true },
      }),
    )
  })

  it('should propagate a non-NOT_FOUND failure loading the linked person', async () => {
    mockRole()
    mockedLeadRepo.findById.mockResolvedValue(
      ok(wonLead({ convertedPersonId: 'p1' })),
    )
    mockedPersonRepo.findById.mockResolvedValue(dbErr())
    expectErr(await CrmLeadService.convert('u1', 'ws1', 'l1'), 'DATABASE_ERROR')
    expect(mockedPersonRepo.findFirstByContacts).not.toHaveBeenCalled()
  })

  it('should link an existing person matched by contact', async () => {
    mockRole()
    mockedLeadRepo.findById.mockResolvedValue(ok(wonLead()))
    mockedPersonRepo.findFirstByContacts.mockResolvedValue(
      ok(createFakeCrmPerson({ id: 'p9' })),
    )
    mockedLeadRepo.update.mockResolvedValue(ok(wonLead()))

    const dto = expectOk(await CrmLeadService.convert('u1', 'ws1', 'l1'))
    expect(dto.id).toBe('p9')
    expect(mockedPersonRepo.create).not.toHaveBeenCalled()
    expect(mockedAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        meta: { converted: true, personId: 'p9', personCreated: false },
      }),
    )
  })

  it('should propagate a contact-lookup failure', async () => {
    mockRole()
    mockedLeadRepo.findById.mockResolvedValue(ok(wonLead()))
    mockedPersonRepo.findFirstByContacts.mockResolvedValue(dbErr())
    expectErr(await CrmLeadService.convert('u1', 'ws1', 'l1'), 'DATABASE_ERROR')
  })

  it('should propagate a person-creation failure', async () => {
    mockRole()
    mockedLeadRepo.findById.mockResolvedValue(ok(wonLead()))
    mockedPersonRepo.findFirstByContacts.mockResolvedValue(ok(null))
    mockedPersonRepo.create.mockResolvedValue(dbErr())
    expectErr(await CrmLeadService.convert('u1', 'ws1', 'l1'), 'DATABASE_ERROR')
    expect(mockedLeadRepo.update).not.toHaveBeenCalled()
  })

  it('should propagate a failure linking the person to the lead', async () => {
    mockRole()
    mockedLeadRepo.findById.mockResolvedValue(ok(wonLead()))
    mockedPersonRepo.findFirstByContacts.mockResolvedValue(
      ok(createFakeCrmPerson({ id: 'p9' })),
    )
    mockedLeadRepo.update.mockResolvedValue(dbErr())
    expectErr(await CrmLeadService.convert('u1', 'ws1', 'l1'), 'DATABASE_ERROR')
    expect(mockedAudit).not.toHaveBeenCalled()
  })
})

describe('CrmLeadService — pipeline stage gating', () => {
  describe('registerContactAttempt()', () => {
    it('should advance IN_CONTACT -> QUALIFIED on a REACHED outcome', async () => {
      mockRole()
      const before = createFakeCrmLead({ id: 'l1', stage: 'IN_CONTACT' })
      mockedLeadRepo.findById.mockResolvedValue(ok(before))
      mockedLeadRepo.createContactAttempt.mockResolvedValue(
        ok(createFakeCrmLeadContactAttempt({ leadId: 'l1' })),
      )
      mockedLeadRepo.update.mockResolvedValue(
        ok({ ...before, stage: 'QUALIFIED' }),
      )

      const result = expectOk(
        await CrmLeadService.registerContactAttempt(
          'u1',
          'ws1',
          'l1',
          attemptDto,
        ),
      )
      expect(result.lead.stage).toBe('QUALIFIED')
      expect(mockedDispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          leadEvents: ['stage-changed'],
          changedFields: ['stage'],
        }),
      )
    })

    it('should not move a lead already past IN_CONTACT', async () => {
      mockRole()
      mockedLeadRepo.findById.mockResolvedValue(
        ok(createFakeCrmLead({ id: 'l1', stage: 'OPPORTUNITY' })),
      )
      mockedLeadRepo.createContactAttempt.mockResolvedValue(
        ok(createFakeCrmLeadContactAttempt({ leadId: 'l1' })),
      )

      const result = expectOk(
        await CrmLeadService.registerContactAttempt(
          'u1',
          'ws1',
          'l1',
          attemptDto,
        ),
      )
      expect(result.lead.stage).toBe('OPPORTUNITY')
      expect(mockedLeadRepo.update).not.toHaveBeenCalled()
      expect(mockedDispatch).not.toHaveBeenCalled()
      expect(mockedAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          meta: { contactAttempt: 'REACHED', stage: 'OPPORTUNITY' },
        }),
      )
    })

    it('should propagate a failure creating the attempt', async () => {
      mockRole()
      mockedLeadRepo.findById.mockResolvedValue(
        ok(createFakeCrmLead({ stage: 'RECEIVED' })),
      )
      mockedLeadRepo.createContactAttempt.mockResolvedValue(dbErr())
      expectErr(
        await CrmLeadService.registerContactAttempt(
          'u1',
          'ws1',
          'l1',
          attemptDto,
        ),
        'DATABASE_ERROR',
      )
      expect(mockedLeadRepo.update).not.toHaveBeenCalled()
    })

    it('should propagate a failure advancing the stage', async () => {
      mockRole()
      mockedLeadRepo.findById.mockResolvedValue(
        ok(createFakeCrmLead({ stage: 'RECEIVED' })),
      )
      mockedLeadRepo.createContactAttempt.mockResolvedValue(
        ok(createFakeCrmLeadContactAttempt()),
      )
      mockedLeadRepo.update.mockResolvedValue(dbErr())
      expectErr(
        await CrmLeadService.registerContactAttempt(
          'u1',
          'ws1',
          'l1',
          attemptDto,
        ),
        'DATABASE_ERROR',
      )
      expect(mockedDispatch).not.toHaveBeenCalled()
    })
  })

  describe('upsertQualification()', () => {
    const dto = { decisionMakerName: 'Carlos', decisionMakerRole: 'CTO' }

    it('should edit an existing qualification without moving the stage', async () => {
      mockRole()
      mockedLeadRepo.findById.mockResolvedValue(
        ok(createFakeCrmLead({ id: 'l1', stage: 'PROPOSAL' })),
      )
      mockedLeadRepo.findQualification.mockResolvedValue(
        ok(createFakeCrmLeadQualification({ leadId: 'l1' })),
      )
      mockedLeadRepo.upsertQualification.mockResolvedValue(
        ok(
          createFakeCrmLeadQualification({
            leadId: 'l1',
            decisionMakerName: 'Carlos',
          }),
        ),
      )

      const result = expectOk(
        await CrmLeadService.upsertQualification('u1', 'ws1', 'l1', dto),
      )
      expect(result.lead.stage).toBe('PROPOSAL')
      expect(result.qualification.decisionMakerName).toBe('Carlos')
      expect(mockedLeadRepo.update).not.toHaveBeenCalled()
      expect(mockedDispatch).not.toHaveBeenCalled()
    })

    it('should reject qualifying a closed lead', async () => {
      mockRole()
      mockedLeadRepo.findById.mockResolvedValue(
        ok(createFakeCrmLead({ stage: 'CLOSED' })),
      )
      expectErr(
        await CrmLeadService.upsertQualification('u1', 'ws1', 'l1', dto),
        'CRM_LEAD_ALREADY_CLOSED',
      )
      expect(mockedLeadRepo.findQualification).not.toHaveBeenCalled()
    })

    it('should propagate a qualification lookup failure', async () => {
      mockRole()
      mockedLeadRepo.findById.mockResolvedValue(
        ok(createFakeCrmLead({ stage: 'QUALIFIED' })),
      )
      mockedLeadRepo.findQualification.mockResolvedValue(dbErr())
      expectErr(
        await CrmLeadService.upsertQualification('u1', 'ws1', 'l1', dto),
        'DATABASE_ERROR',
      )
    })

    it('should propagate an upsert failure', async () => {
      mockRole()
      mockedLeadRepo.findById.mockResolvedValue(
        ok(createFakeCrmLead({ stage: 'QUALIFIED' })),
      )
      mockedLeadRepo.findQualification.mockResolvedValue(ok(null))
      mockedLeadRepo.upsertQualification.mockResolvedValue(dbErr())
      expectErr(
        await CrmLeadService.upsertQualification('u1', 'ws1', 'l1', dto),
        'DATABASE_ERROR',
      )
      expect(mockedLeadRepo.update).not.toHaveBeenCalled()
    })

    it('should propagate a failure advancing to OPPORTUNITY', async () => {
      mockRole()
      mockedLeadRepo.findById.mockResolvedValue(
        ok(createFakeCrmLead({ stage: 'QUALIFIED' })),
      )
      mockedLeadRepo.findQualification.mockResolvedValue(ok(null))
      mockedLeadRepo.upsertQualification.mockResolvedValue(
        ok(createFakeCrmLeadQualification()),
      )
      mockedLeadRepo.update.mockResolvedValue(dbErr())
      expectErr(
        await CrmLeadService.upsertQualification('u1', 'ws1', 'l1', dto),
        'DATABASE_ERROR',
      )
    })
  })

  describe('registerMeeting()', () => {
    it('should propagate a failure creating the meeting', async () => {
      mockRole()
      mockedLeadRepo.findById.mockResolvedValue(
        ok(createFakeCrmLead({ stage: 'OPPORTUNITY' })),
      )
      mockedLeadRepo.createMeeting.mockResolvedValue(dbErr())
      expectErr(
        await CrmLeadService.registerMeeting('u1', 'ws1', 'l1', meetingDto),
        'DATABASE_ERROR',
      )
      expect(mockedAudit).not.toHaveBeenCalled()
    })
  })

  describe('createProposal()', () => {
    function mockOpportunityWithMeeting() {
      mockRole()
      mockedLeadRepo.findById.mockResolvedValue(
        ok(createFakeCrmLead({ id: 'l1', stage: 'OPPORTUNITY' })),
      )
      mockedLeadRepo.listMeetings.mockResolvedValue(
        ok([createFakeCrmLeadMeeting({ leadId: 'l1' })]),
      )
    }

    it('should reject creating a proposal outside OPPORTUNITY', async () => {
      mockRole()
      mockedLeadRepo.findById.mockResolvedValue(
        ok(createFakeCrmLead({ stage: 'QUALIFIED' })),
      )
      expectErr(
        await CrmLeadService.createProposal('u1', 'ws1', 'l1', { name: 'P' }),
        'CRM_LEAD_STAGE_TRANSITION_INVALID',
      )
      expect(mockedLeadRepo.listMeetings).not.toHaveBeenCalled()
    })

    it('should propagate a meetings lookup failure', async () => {
      mockRole()
      mockedLeadRepo.findById.mockResolvedValue(
        ok(createFakeCrmLead({ stage: 'OPPORTUNITY' })),
      )
      mockedLeadRepo.listMeetings.mockResolvedValue(dbErr())
      expectErr(
        await CrmLeadService.createProposal('u1', 'ws1', 'l1', { name: 'P' }),
        'DATABASE_ERROR',
      )
    })

    it('should honour an explicit validity date', async () => {
      mockOpportunityWithMeeting()
      const validUntil = new Date('2030-01-01T00:00:00Z')
      mockedProposalRepo.create.mockResolvedValue(
        ok(proposalWithSections({ id: 'p1', leadId: 'l1' })),
      )
      mockedLeadRepo.update.mockResolvedValue(
        ok(createFakeCrmLead({ id: 'l1', stage: 'PROPOSAL' })),
      )

      expectOk(
        await CrmLeadService.createProposal('u1', 'ws1', 'l1', {
          name: 'P',
          validUntil,
        }),
      )
      expect(mockedSettingsRepo.findByWorkspace).not.toHaveBeenCalled()
      expect(mockedProposalRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          validUntil,
          leadId: 'l1',
          responsibleId: 'u1',
          sections: [],
        }),
      )
    })

    it('should propagate a settings failure when resolving the default validity', async () => {
      mockOpportunityWithMeeting()
      mockedSettingsRepo.findByWorkspace.mockResolvedValue(dbErr())
      expectErr(
        await CrmLeadService.createProposal('u1', 'ws1', 'l1', { name: 'P' }),
        'DATABASE_ERROR',
      )
      expect(mockedProposalRepo.create).not.toHaveBeenCalled()
    })

    it('should propagate a proposal creation failure', async () => {
      mockOpportunityWithMeeting()
      mockedProposalRepo.create.mockResolvedValue(dbErr())
      expectErr(
        await CrmLeadService.createProposal('u1', 'ws1', 'l1', { name: 'P' }),
        'DATABASE_ERROR',
      )
      expect(mockedLeadRepo.update).not.toHaveBeenCalled()
    })

    it('should propagate a failure advancing to PROPOSAL', async () => {
      mockOpportunityWithMeeting()
      mockedProposalRepo.create.mockResolvedValue(
        ok(proposalWithSections({ id: 'p1' })),
      )
      mockedLeadRepo.update.mockResolvedValue(dbErr())
      expectErr(
        await CrmLeadService.createProposal('u1', 'ws1', 'l1', { name: 'P' }),
        'DATABASE_ERROR',
      )
      expect(mockedDispatch).not.toHaveBeenCalled()
    })

    it('should require CREATE on documents (VIEWER denied)', async () => {
      mockRole('VIEWER')
      expectErr(
        await CrmLeadService.createProposal('u1', 'ws1', 'l1', { name: 'P' }),
        'FORBIDDEN',
      )
    })
  })

  describe('registerProposalPresentation()', () => {
    it('should reject a presentation outside PROPOSAL', async () => {
      mockRole()
      mockedLeadRepo.findById.mockResolvedValue(
        ok(createFakeCrmLead({ stage: 'OPPORTUNITY' })),
      )
      expectErr(
        await CrmLeadService.registerProposalPresentation(
          'u1',
          'ws1',
          'l1',
          'p1',
          presentationDto,
        ),
        'CRM_LEAD_STAGE_TRANSITION_INVALID',
      )
      expect(mockedProposalRepo.findById).not.toHaveBeenCalled()
    })

    it('should propagate a proposal lookup failure', async () => {
      mockRole()
      mockedLeadRepo.findById.mockResolvedValue(
        ok(createFakeCrmLead({ stage: 'PROPOSAL' })),
      )
      mockedProposalRepo.findById.mockResolvedValue(err(notFound('Proposal')))
      expectErr(
        await CrmLeadService.registerProposalPresentation(
          'u1',
          'ws1',
          'l1',
          'p1',
          presentationDto,
        ),
        'RESOURCE_NOT_FOUND',
      )
    })

    it('should propagate a failure saving the presentation', async () => {
      mockRole()
      mockedLeadRepo.findById.mockResolvedValue(
        ok(createFakeCrmLead({ id: 'l1', stage: 'PROPOSAL' })),
      )
      mockedProposalRepo.findById.mockResolvedValue(
        ok(proposalWithSections({ id: 'p1', leadId: 'l1' })),
      )
      mockedLeadRepo.createProposalPresentation.mockResolvedValue(dbErr())
      expectErr(
        await CrmLeadService.registerProposalPresentation(
          'u1',
          'ws1',
          'l1',
          'p1',
          presentationDto,
        ),
        'DATABASE_ERROR',
      )
      expect(mockedAudit).not.toHaveBeenCalled()
    })
  })

  describe('closeWon()', () => {
    function mockProposalWithPresentation() {
      mockRole()
      mockedLeadRepo.findById.mockResolvedValue(
        ok(createFakeCrmLead({ id: 'l1', stage: 'PROPOSAL' })),
      )
      mockedLeadRepo.listProposalPresentations.mockResolvedValue(
        ok([createFakeCrmLeadProposalPresentation({ leadId: 'l1' })]),
      )
    }

    it('should reject closing an already closed lead', async () => {
      mockRole()
      mockedLeadRepo.findById.mockResolvedValue(
        ok(createFakeCrmLead({ stage: 'CLOSED' })),
      )
      expectErr(
        await CrmLeadService.closeWon('u1', 'ws1', 'l1', wonDto),
        'CRM_LEAD_ALREADY_CLOSED',
      )
    })

    it('should propagate a presentations lookup failure', async () => {
      mockRole()
      mockedLeadRepo.findById.mockResolvedValue(
        ok(createFakeCrmLead({ stage: 'PROPOSAL' })),
      )
      mockedLeadRepo.listProposalPresentations.mockResolvedValue(dbErr())
      expectErr(
        await CrmLeadService.closeWon('u1', 'ws1', 'l1', wonDto),
        'DATABASE_ERROR',
      )
    })

    it('should propagate a person-resolution failure', async () => {
      mockProposalWithPresentation()
      mockedPersonRepo.findFirstByContacts.mockResolvedValue(dbErr())
      expectErr(
        await CrmLeadService.closeWon('u1', 'ws1', 'l1', wonDto),
        'DATABASE_ERROR',
      )
      expect(mockedLeadRepo.update).not.toHaveBeenCalled()
    })

    it('should propagate a failure closing the lead', async () => {
      mockProposalWithPresentation()
      mockedPersonRepo.findFirstByContacts.mockResolvedValue(
        ok(createFakeCrmPerson({ id: 'p1' })),
      )
      mockedLeadRepo.update.mockResolvedValue(dbErr())
      expectErr(
        await CrmLeadService.closeWon('u1', 'ws1', 'l1', wonDto),
        'DATABASE_ERROR',
      )
      expect(mockedDispatch).not.toHaveBeenCalled()
    })
  })

  describe('closeLost()', () => {
    it('should close a PROPOSAL lead as lost once the proposal was presented', async () => {
      mockRole()
      mockedLeadRepo.findById.mockResolvedValue(
        ok(createFakeCrmLead({ id: 'l1', stage: 'PROPOSAL' })),
      )
      mockedLeadRepo.listProposalPresentations.mockResolvedValue(
        ok([createFakeCrmLeadProposalPresentation({ leadId: 'l1' })]),
      )
      mockedLeadRepo.update.mockResolvedValue(
        ok(createFakeLostCrmLead({ id: 'l1' })),
      )

      const retryAt = new Date('2030-01-01T00:00:00Z')
      const dto = expectOk(
        await CrmLeadService.closeLost('u1', 'ws1', 'l1', {
          lostReason: 'Preço',
          lostNote: 'Caro',
          retryAt,
        }),
      )
      expect(dto.closeResult).toBe('LOST')
      expect(mockedLeadRepo.update).toHaveBeenCalledWith(
        'l1',
        expect.objectContaining({
          stage: 'CLOSED',
          closeResult: 'LOST',
          lostReason: 'Preço',
          lostNote: 'Caro',
          retryAt,
        }),
      )
      expect(mockedAudit).toHaveBeenCalledWith(
        expect.objectContaining({ meta: { closed: 'LOST', reason: 'Preço' } }),
      )
    })

    it('should reject closing a PROPOSAL lead as lost without a presentation', async () => {
      mockRole()
      mockedLeadRepo.findById.mockResolvedValue(
        ok(createFakeCrmLead({ stage: 'PROPOSAL' })),
      )
      mockedLeadRepo.listProposalPresentations.mockResolvedValue(ok([]))
      expectErr(
        await CrmLeadService.closeLost('u1', 'ws1', 'l1', { lostReason: 'x' }),
        'CRM_LEAD_STAGE_REQUIREMENTS_NOT_MET',
      )
      expect(mockedLeadRepo.update).not.toHaveBeenCalled()
    })

    it('should propagate a presentations lookup failure', async () => {
      mockRole()
      mockedLeadRepo.findById.mockResolvedValue(
        ok(createFakeCrmLead({ stage: 'PROPOSAL' })),
      )
      mockedLeadRepo.listProposalPresentations.mockResolvedValue(dbErr())
      expectErr(
        await CrmLeadService.closeLost('u1', 'ws1', 'l1', { lostReason: 'x' }),
        'DATABASE_ERROR',
      )
    })

    it('should propagate a failure closing the lead', async () => {
      mockRole()
      mockedLeadRepo.findById.mockResolvedValue(
        ok(createFakeCrmLead({ stage: 'RECEIVED' })),
      )
      mockedLeadRepo.update.mockResolvedValue(dbErr())
      expectErr(
        await CrmLeadService.closeLost('u1', 'ws1', 'l1', { lostReason: 'x' }),
        'DATABASE_ERROR',
      )
      expect(mockedDispatch).not.toHaveBeenCalled()
    })
  })
})

describe('CrmLeadService.reopen() — gates and failures', () => {
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
      ok(records.proposal ? proposalWithSections({ leadId: 'l1' }) : null),
    )
  }

  function mockLost(reopenStage?: 'PROPOSAL' | 'QUALIFIED' | 'OPPORTUNITY') {
    mockRole()
    if (reopenStage) {
      mockedSettingsRepo.findByWorkspace.mockResolvedValue(
        ok(createFakeCrmSettings({ leadReopenStage: reopenStage })),
      )
    }
    mockedLeadRepo.findById.mockResolvedValue(
      ok(createFakeLostCrmLead({ id: 'l1', lostReason: 'Preço' })),
    )
  }

  it('should reopen at PROPOSAL when the lead has qualification and a proposal', async () => {
    mockLost('PROPOSAL')
    mockGateRecords({ attempts: ['REACHED'], qualified: true, proposal: true })
    mockedLeadRepo.reopen.mockResolvedValue(
      ok(createFakeCrmLead({ id: 'l1', stage: 'PROPOSAL' })),
    )

    expectOk(await CrmLeadService.reopen('u1', 'ws1', 'l1', { reason: 'r' }))
    expect(mockedLeadRepo.reopen).toHaveBeenCalledWith(
      'l1',
      expect.objectContaining({ toStage: 'PROPOSAL' }),
    )
    expect(mockedAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        meta: {
          reopened: true,
          toStage: 'PROPOSAL',
          configuredStage: 'PROPOSAL',
          previousLostReason: 'Preço',
        },
      }),
    )
  })

  it('should clamp to QUALIFIED when only an effective contact exists', async () => {
    mockLost('PROPOSAL')
    mockGateRecords({ attempts: ['ATTEMPTED', 'REACHED'] })
    mockedLeadRepo.reopen.mockResolvedValue(
      ok(createFakeCrmLead({ id: 'l1', stage: 'QUALIFIED' })),
    )

    expectOk(await CrmLeadService.reopen('u1', 'ws1', 'l1', { reason: 'r' }))
    expect(mockedLeadRepo.reopen).toHaveBeenCalledWith(
      'l1',
      expect.objectContaining({ toStage: 'QUALIFIED' }),
    )
  })

  it('should not treat a proposal without qualification as reaching PROPOSAL', async () => {
    mockLost('PROPOSAL')
    mockGateRecords({ proposal: true })
    mockedLeadRepo.reopen.mockResolvedValue(
      ok(createFakeCrmLead({ id: 'l1', stage: 'RECEIVED' })),
    )

    expectOk(await CrmLeadService.reopen('u1', 'ws1', 'l1', { reason: 'r' }))
    expect(mockedLeadRepo.reopen).toHaveBeenCalledWith(
      'l1',
      expect.objectContaining({ toStage: 'RECEIVED' }),
    )
  })

  it('should keep the configured stage when records go further', async () => {
    mockLost('QUALIFIED')
    mockGateRecords({ attempts: ['REACHED'], qualified: true, proposal: true })
    mockedLeadRepo.reopen.mockResolvedValue(
      ok(createFakeCrmLead({ id: 'l1', stage: 'QUALIFIED' })),
    )

    expectOk(await CrmLeadService.reopen('u1', 'ws1', 'l1', { reason: 'r' }))
    expect(mockedLeadRepo.reopen).toHaveBeenCalledWith(
      'l1',
      expect.objectContaining({ toStage: 'QUALIFIED' }),
    )
  })

  it('should propagate a settings failure', async () => {
    mockLost()
    mockedSettingsRepo.findByWorkspace.mockResolvedValue(dbErr())
    expectErr(
      await CrmLeadService.reopen('u1', 'ws1', 'l1', { reason: 'r' }),
      'DATABASE_ERROR',
    )
    expect(mockedLeadRepo.reopen).not.toHaveBeenCalled()
  })

  it.each([
    ['contact attempts', 'attempts'],
    ['qualification', 'qualification'],
    ['proposal', 'proposal'],
  ] as const)(
    'should propagate a %s lookup failure while computing the gate',
    async (_, which) => {
      mockLost()
      mockGateRecords({})
      if (which === 'attempts') {
        mockedLeadRepo.listContactAttempts.mockResolvedValue(dbErr())
      } else if (which === 'qualification') {
        mockedLeadRepo.findQualification.mockResolvedValue(dbErr())
      } else {
        mockedProposalRepo.findLatestByLeadId.mockResolvedValue(dbErr())
      }

      expectErr(
        await CrmLeadService.reopen('u1', 'ws1', 'l1', { reason: 'r' }),
        'DATABASE_ERROR',
      )
      expect(mockedLeadRepo.reopen).not.toHaveBeenCalled()
    },
  )

  it('should audit a failed reopen and not fire workflows', async () => {
    mockLost()
    mockGateRecords({})
    mockedLeadRepo.reopen.mockResolvedValue(dbErr())

    expectErr(
      await CrmLeadService.reopen('u1', 'ws1', 'l1', { reason: 'r' }),
      'DATABASE_ERROR',
    )
    expect(mockedAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'failure',
        reason: 'DATABASE_ERROR',
        targetId: 'l1',
        meta: { reopened: true },
      }),
    )
    expect(mockedDispatch).not.toHaveBeenCalled()
  })
})

describe('CrmLeadService notifications', () => {
  const mockedLeadAssigned = vi.mocked(notifyCrmLeadAssigned)
  const mockedDealClosed = vi.mocked(notifyCrmDealClosed)
  const routingRule = {
    id: 'rr1',
    workspaceId: 'ws1',
    field: 'source' as const,
    operator: 'equals' as const,
    value: 'form',
    ownerId: 'seller1',
    active: true,
    position: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockedSettingsRepo.findByWorkspace.mockResolvedValue(ok(null))
  })

  it('should notify the routed owner on a system intake (no actor)', async () => {
    mockedLeadRepo.findOpenByContacts.mockResolvedValue(ok(null))
    mockedScoringRepo.listActiveByWorkspace.mockResolvedValue(ok([]))
    mockedRoutingRepo.listActiveByWorkspace.mockResolvedValue(ok([routingRule]))
    const lead = createFakeCrmLead({ id: 'l1', ownerId: 'seller1' })
    mockedLeadRepo.create.mockResolvedValue(ok(lead))

    expectOk(
      await CrmLeadService.intake(
        'ws1',
        { kind: 'system', createdById: 'owner1', via: 'form', refId: 'f1' },
        { name: 'Jane', phones: ['81 99999-0000'], source: 'form' },
      ),
    )

    expect(mockedLeadAssigned).toHaveBeenCalledWith({
      workspaceId: 'ws1',
      lead,
      ownerId: 'seller1',
      actorId: null,
      routed: true,
    })
  })

  it('should pass the human creator as actor so self-routing is not notified', async () => {
    mockRole()
    mockedLeadRepo.findOpenByContacts.mockResolvedValue(ok(null))
    mockedScoringRepo.listActiveByWorkspace.mockResolvedValue(ok([]))
    mockedRoutingRepo.listActiveByWorkspace.mockResolvedValue(ok([routingRule]))
    mockedLeadRepo.create.mockResolvedValue(
      ok(createFakeCrmLead({ id: 'l1', ownerId: 'seller1' })),
    )

    expectOk(
      await CrmLeadService.create('u1', 'ws1', {
        name: 'Jane',
        phones: ['81 99999-0000'],
        source: 'form',
      }),
    )

    expect(mockedLeadAssigned).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: 'u1', ownerId: 'seller1' }),
    )
  })

  it('should not notify when intake routes to nobody', async () => {
    mockedLeadRepo.findOpenByContacts.mockResolvedValue(ok(null))
    mockedScoringRepo.listActiveByWorkspace.mockResolvedValue(ok([]))
    mockedRoutingRepo.listActiveByWorkspace.mockResolvedValue(ok([]))
    mockedLeadRepo.create.mockResolvedValue(ok(createFakeCrmLead()))

    expectOk(
      await CrmLeadService.intake(
        'ws1',
        { kind: 'system', createdById: 'owner1', via: 'form', refId: 'f1' },
        { name: 'Jane', phones: ['81 99999-0000'], source: 'site' },
      ),
    )

    expect(mockedLeadAssigned).not.toHaveBeenCalled()
  })

  it('should notify the new owner when the owner changes on update', async () => {
    mockRole()
    mockedLeadRepo.findById.mockResolvedValue(
      ok(createFakeCrmLead({ id: 'l1', ownerId: 'old' })),
    )
    const updated = createFakeCrmLead({ id: 'l1', ownerId: 'u2' })
    mockedLeadRepo.update.mockResolvedValue(ok(updated))

    expectOk(await CrmLeadService.update('u1', 'ws1', 'l1', { ownerId: 'u2' }))

    expect(mockedLeadAssigned).toHaveBeenCalledWith({
      workspaceId: 'ws1',
      lead: updated,
      ownerId: 'u2',
      actorId: 'u1',
    })
  })

  it('should not notify when the owner did not change', async () => {
    mockRole()
    const lead = createFakeCrmLead({ id: 'l1', ownerId: 'u2' })
    mockedLeadRepo.findById.mockResolvedValue(ok(lead))
    mockedLeadRepo.update.mockResolvedValue(ok(lead))

    expectOk(await CrmLeadService.update('u1', 'ws1', 'l1', { linkedin: 'x' }))

    expect(mockedLeadAssigned).not.toHaveBeenCalled()
  })

  it('should notify the owner when the lead is closed as lost', async () => {
    mockRole()
    mockedLeadRepo.findById.mockResolvedValue(
      ok(createFakeCrmLead({ id: 'l1', stage: 'IN_CONTACT' })),
    )
    const closed = createFakeCrmLead({
      id: 'l1',
      stage: 'CLOSED',
      closeResult: 'LOST',
      ownerId: 'seller1',
    })
    mockedLeadRepo.update.mockResolvedValue(ok(closed))

    expectOk(
      await CrmLeadService.closeLost('u1', 'ws1', 'l1', {
        lostReason: 'Preço',
      }),
    )

    expect(mockedDealClosed).toHaveBeenCalledWith({
      workspaceId: 'ws1',
      lead: closed,
      result: 'LOST',
      actorId: 'u1',
    })
  })

  it('should notify the owner when the lead is closed as won', async () => {
    mockRole()
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
    const closed = createFakeCrmLead({
      id: 'l1',
      stage: 'CLOSED',
      closeResult: 'WON',
      ownerId: 'seller1',
    })
    mockedLeadRepo.update.mockResolvedValue(ok(closed))

    expectOk(
      await CrmLeadService.closeWon('u1', 'ws1', 'l1', {
        contractSignedAt: new Date(),
        billingType: 'MONTHLY',
        closedAmount: 1500,
        contractSignedConfirmed: true,
      }),
    )

    expect(mockedDealClosed).toHaveBeenCalledWith(
      expect.objectContaining({ result: 'WON', actorId: 'u1', lead: closed }),
    )
  })
})
