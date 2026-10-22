import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import { createFakeWhatsAppSlaPolicy } from '@/src/__tests__/factories/whatsapp-sla.factory'
import { createFakeWhatsAppTeam } from '@/src/__tests__/factories/whatsapp-team.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/whatsapp-sla-policy.repository')
vi.mock('@/lib/axiom/audit', () => ({ auditMutation: vi.fn() }))

import { auditMutation } from '@/lib/axiom/audit'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { WhatsAppSlaPolicyRepository } from '@/src/repositories/whatsapp-sla-policy.repository'
import { WhatsAppTeamRepository } from '@/src/repositories/whatsapp-team.repository'
import { WhatsAppSlaPolicyService } from '../whatsapp-sla-policy.service'

const membershipRepo = vi.mocked(MembershipRepository)
const policyRepo = vi.mocked(WhatsAppSlaPolicyRepository)
const teamRepo = vi.mocked(WhatsAppTeamRepository)

function asRole(role: 'OWNER' | 'ADMIN' | 'MEMBER') {
  membershipRepo.findByUserAndWorkspace.mockResolvedValue(
    ok(createFakeMembership({ role })),
  )
}

const created = createFakeWhatsAppSlaPolicy({ id: 'p1', workspaceId: 'ws1' })

beforeEach(() => {
  asRole('ADMIN')
  policyRepo.findByScope.mockResolvedValue(ok(null))
  policyRepo.create.mockResolvedValue(ok(created))
  policyRepo.update.mockResolvedValue(ok(created))
  policyRepo.delete.mockResolvedValue(ok(undefined))
  policyRepo.findById.mockResolvedValue(ok(created))
  membershipRepo.listWithUserByWorkspace.mockResolvedValue(
    ok([
      {
        ...createFakeMembership({ userId: 'u1', workspaceId: 'ws1' }),
        user: { id: 'u1', name: 'Ana', email: 'a@x.com', image: null },
      },
    ]),
  )
})

describe('WhatsAppSlaPolicyService.list()', () => {
  it('should list the policies for a member with conversation access', async () => {
    asRole('OWNER')
    policyRepo.listByWorkspace.mockResolvedValue(ok([created]))

    const list = expectOk(await WhatsAppSlaPolicyService.list('u1', 'ws1'))

    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ id: 'p1', teamId: null })
  })

  it('should refuse a non-member', async () => {
    membershipRepo.findByUserAndWorkspace.mockResolvedValue(ok(null))
    expectErr(await WhatsAppSlaPolicyService.list('u1', 'ws1'), 'FORBIDDEN')
  })

  it('should propagate a database error', async () => {
    policyRepo.listByWorkspace.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await WhatsAppSlaPolicyService.list('u1', 'ws1'),
      'DATABASE_ERROR',
    )
  })
})

describe('WhatsAppSlaPolicyService.create()', () => {
  it('should create the default policy disabled-by-default values and audit it', async () => {
    expectOk(await WhatsAppSlaPolicyService.create('u1', 'ws1', {}))

    expect(policyRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'ws1',
        teamId: null,
        enabled: false,
        firstResponseMinutes: 15,
        resolutionMinutes: null,
        businessHoursOnly: true,
        warnAtPercent: 80,
        countAiAsResponse: false,
        supervisorIds: [],
      }),
    )
    expect(auditMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'whatsapp_sla_policy',
        action: 'create',
        actorId: 'u1',
      }),
    )
  })

  it('should create a team override with the given values and de-duplicate supervisors', async () => {
    teamRepo.findById.mockResolvedValue(
      ok(createFakeWhatsAppTeam({ id: 't1', workspaceId: 'ws1' })),
    )

    expectOk(
      await WhatsAppSlaPolicyService.create('u1', 'ws1', {
        teamId: 't1',
        enabled: true,
        firstResponseMinutes: 5,
        resolutionMinutes: 60,
        supervisorIds: ['u1', 'u1'],
      }),
    )

    expect(policyRepo.findByScope).toHaveBeenCalledWith('ws1', 't1')
    expect(policyRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        teamId: 't1',
        enabled: true,
        firstResponseMinutes: 5,
        resolutionMinutes: 60,
        supervisorIds: ['u1'],
      }),
    )
  })

  it('should refuse a non-admin', async () => {
    asRole('MEMBER')
    expectErr(
      await WhatsAppSlaPolicyService.create('u1', 'ws1', {}),
      'FORBIDDEN',
    )
    expect(policyRepo.create).not.toHaveBeenCalled()
  })

  it('should refuse a team of another workspace', async () => {
    teamRepo.findById.mockResolvedValue(ok(null))
    expectErr(
      await WhatsAppSlaPolicyService.create('u1', 'ws1', { teamId: 'foreign' }),
      'VALIDATION_ERROR',
    )
  })

  it('should propagate a team lookup error', async () => {
    teamRepo.findById.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await WhatsAppSlaPolicyService.create('u1', 'ws1', { teamId: 't1' }),
      'DATABASE_ERROR',
    )
  })

  it('should answer a conflict when the scope already has a policy', async () => {
    policyRepo.findByScope.mockResolvedValue(ok(created))
    const error = expectErr(
      await WhatsAppSlaPolicyService.create('u1', 'ws1', {}),
      'CONFLICT',
    )
    expect(error.message).toContain('padrão')

    teamRepo.findById.mockResolvedValue(
      ok(createFakeWhatsAppTeam({ id: 't1', workspaceId: 'ws1' })),
    )
    const teamError = expectErr(
      await WhatsAppSlaPolicyService.create('u1', 'ws1', { teamId: 't1' }),
      'CONFLICT',
    )
    expect(teamError.message).toContain('equipe')
  })

  it('should propagate a scope lookup error', async () => {
    policyRepo.findByScope.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await WhatsAppSlaPolicyService.create('u1', 'ws1', {}),
      'DATABASE_ERROR',
    )
  })

  it('should refuse a resolution target shorter than the first response', async () => {
    expectErr(
      await WhatsAppSlaPolicyService.create('u1', 'ws1', {
        firstResponseMinutes: 30,
        resolutionMinutes: 10,
      }),
      'VALIDATION_ERROR',
    )
  })

  it('should refuse supervisors outside the workspace', async () => {
    expectErr(
      await WhatsAppSlaPolicyService.create('u1', 'ws1', {
        supervisorIds: ['stranger'],
      }),
      'VALIDATION_ERROR',
    )
  })

  it('should propagate member and write errors', async () => {
    membershipRepo.listWithUserByWorkspace.mockResolvedValue(
      err(databaseError('x')),
    )
    expectErr(
      await WhatsAppSlaPolicyService.create('u1', 'ws1', {
        supervisorIds: ['u1'],
      }),
      'DATABASE_ERROR',
    )

    policyRepo.create.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await WhatsAppSlaPolicyService.create('u1', 'ws1', {}),
      'DATABASE_ERROR',
    )
  })
})

describe('WhatsAppSlaPolicyService.update()', () => {
  it('should apply only the given fields and audit them', async () => {
    expectOk(
      await WhatsAppSlaPolicyService.update('u1', 'ws1', 'p1', {
        enabled: true,
        warnAtPercent: 70,
      }),
    )

    expect(policyRepo.update).toHaveBeenCalledWith('p1', {
      enabled: true,
      warnAtPercent: 70,
    })
    expect(auditMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'update',
        meta: { workspaceId: 'ws1', fields: ['enabled', 'warnAtPercent'] },
      }),
    )
  })

  it('should validate the targets against the stored policy', async () => {
    // stored: first response 15 min, resolution 240 min
    expectErr(
      await WhatsAppSlaPolicyService.update('u1', 'ws1', 'p1', {
        firstResponseMinutes: 300,
      }),
      'VALIDATION_ERROR',
    )
    expectOk(
      await WhatsAppSlaPolicyService.update('u1', 'ws1', 'p1', {
        resolutionMinutes: null,
      }),
    )
  })

  it('should de-duplicate supervisors and check they are members', async () => {
    expectOk(
      await WhatsAppSlaPolicyService.update('u1', 'ws1', 'p1', {
        supervisorIds: ['u1', 'u1'],
      }),
    )
    expect(policyRepo.update).toHaveBeenCalledWith('p1', {
      supervisorIds: ['u1'],
    })
    expectErr(
      await WhatsAppSlaPolicyService.update('u1', 'ws1', 'p1', {
        supervisorIds: ['stranger'],
      }),
      'VALIDATION_ERROR',
    )
  })

  it('should answer not found for a missing or foreign policy', async () => {
    policyRepo.findById.mockResolvedValue(ok(null))
    expectErr(
      await WhatsAppSlaPolicyService.update('u1', 'ws1', 'p1', {
        enabled: true,
      }),
      'WHATSAPP_SLA_POLICY_NOT_FOUND',
    )
    expect(policyRepo.findById).toHaveBeenCalledWith('p1', 'ws1')
  })

  it('should refuse a non-admin and propagate database errors', async () => {
    asRole('MEMBER')
    expectErr(
      await WhatsAppSlaPolicyService.update('u1', 'ws1', 'p1', {
        enabled: true,
      }),
      'FORBIDDEN',
    )

    asRole('ADMIN')
    policyRepo.findById.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await WhatsAppSlaPolicyService.update('u1', 'ws1', 'p1', {
        enabled: true,
      }),
      'DATABASE_ERROR',
    )

    policyRepo.findById.mockResolvedValue(ok(created))
    policyRepo.update.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await WhatsAppSlaPolicyService.update('u1', 'ws1', 'p1', {
        enabled: true,
      }),
      'DATABASE_ERROR',
    )
  })
})

describe('WhatsAppSlaPolicyService.remove()', () => {
  it('should delete the policy and audit it', async () => {
    expect(
      expectOk(await WhatsAppSlaPolicyService.remove('u1', 'ws1', 'p1')),
    ).toEqual({
      id: 'p1',
    })
    expect(policyRepo.delete).toHaveBeenCalledWith('p1')
    expect(auditMutation).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'delete', targetId: 'p1' }),
    )
  })

  it('should answer not found, refuse non-admins and propagate errors', async () => {
    policyRepo.findById.mockResolvedValue(ok(null))
    expectErr(
      await WhatsAppSlaPolicyService.remove('u1', 'ws1', 'p1'),
      'WHATSAPP_SLA_POLICY_NOT_FOUND',
    )

    policyRepo.findById.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await WhatsAppSlaPolicyService.remove('u1', 'ws1', 'p1'),
      'DATABASE_ERROR',
    )

    policyRepo.findById.mockResolvedValue(ok(created))
    policyRepo.delete.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await WhatsAppSlaPolicyService.remove('u1', 'ws1', 'p1'),
      'DATABASE_ERROR',
    )

    asRole('MEMBER')
    expectErr(
      await WhatsAppSlaPolicyService.remove('u1', 'ws1', 'p1'),
      'FORBIDDEN',
    )
  })
})
