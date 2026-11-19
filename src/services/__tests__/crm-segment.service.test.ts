import type { CrmSegment } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { crmSegmentNameTaken, forbidden } from '@/src/errors'
import { err, ok } from '@/src/lib/result'
import { CRM_SEGMENTS_PER_WORKSPACE } from '@/src/schemas/crm-segment.schema'

vi.mock('@/src/services/authz', () => ({ assertModuleMember: vi.fn() }))
vi.mock('@/lib/axiom/audit', () => ({ auditMutation: vi.fn() }))
vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('@/src/repositories/crm-segment.repository', () => ({
  CrmSegmentRepository: {
    list: vi.fn(),
    count: vi.fn(),
    findById: vi.fn(),
    findManyByIds: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    contacts: vi.fn(),
    candidates: vi.fn(),
    options: vi.fn(),
  },
}))

import { CrmSegmentRepository } from '@/src/repositories/crm-segment.repository'
import { assertModuleMember } from '../authz'
import { CrmSegmentService as Service } from '../crm-segment.service'

const repo = vi.mocked(CrmSegmentRepository)
const authz = vi.mocked(assertModuleMember)

const DEFINITION = {
  match: 'ALL',
  conditions: [{ type: 'leadStage', stages: ['QUALIFIED'] }],
  groups: [],
}

function row(overrides: Partial<CrmSegment> = {}): CrmSegment {
  return {
    id: 's1',
    workspaceId: 'ws1',
    name: 'Leads quentes',
    description: null,
    target: 'LEAD',
    definition: DEFINITION,
    createdById: 'u1',
    updatedById: null,
    createdAt: new Date('2026-11-19T10:00:00Z'),
    updatedAt: new Date('2026-11-19T10:00:00Z'),
    ...overrides,
  }
}

const CREATE = {
  name: 'Leads quentes',
  description: null,
  target: 'LEAD' as const,
  definition: {
    match: 'ALL' as const,
    conditions: [
      { type: 'leadStage' as const, stages: ['QUALIFIED' as const] },
    ],
    groups: [],
  },
}

describe('CrmSegmentService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authz.mockResolvedValue(
      ok({ role: 'OWNER', isPrivileged: true, permissions: null }),
    )
    repo.count.mockResolvedValue(ok(0))
  })

  it('refuses everything without module permission', async () => {
    authz.mockResolvedValue(err(forbidden()))
    expectErr(await Service.list('u1', 'ws1'), 'FORBIDDEN')
    expectErr(await Service.create('u1', 'ws1', CREATE), 'FORBIDDEN')
    expectErr(await Service.remove('u1', 'ws1', 's1'), 'FORBIDDEN')
    expect(repo.create).not.toHaveBeenCalled()
  })

  it('creates a segment under the email permission', async () => {
    repo.create.mockResolvedValue(ok(row()))
    const dto = expectOk(await Service.create('u1', 'ws1', CREATE))
    expect(dto.name).toBe('Leads quentes')
    expect(dto.valid).toBe(true)
    expect(authz).toHaveBeenCalledWith('u1', 'ws1', 'CRM', {
      resource: 'email',
      action: 'CREATE',
    })
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'ws1', createdById: 'u1' }),
    )
  })

  it('stops at the segment limit', async () => {
    repo.count.mockResolvedValue(ok(CRM_SEGMENTS_PER_WORKSPACE))
    expectErr(
      await Service.create('u1', 'ws1', CREATE),
      'CRM_SEGMENT_LIMIT_REACHED',
    )
    expect(repo.create).not.toHaveBeenCalled()
  })

  it('refuses to change the target when the rules no longer fit', async () => {
    repo.findById.mockResolvedValue(ok(row()))
    expectErr(
      await Service.update('u1', 'ws1', 's1', { target: 'PERSON' }),
      'CRM_SEGMENT_INVALID',
    )
    expect(repo.update).not.toHaveBeenCalled()
  })

  it('answers not found for a segment of another workspace', async () => {
    repo.findById.mockResolvedValue(ok(null))
    expectErr(await Service.get('u1', 'ws1', 'x'), 'CRM_SEGMENT_NOT_FOUND')
    expectErr(await Service.remove('u1', 'ws1', 'x'), 'CRM_SEGMENT_NOT_FOUND')
  })

  it('duplicates with a numbered name when "(cópia)" is taken', async () => {
    repo.findById.mockResolvedValue(ok(row()))
    repo.create
      .mockResolvedValueOnce(err(crmSegmentNameTaken()))
      .mockResolvedValueOnce(
        ok(row({ id: 's2', name: 'Leads quentes (cópia) 2' })),
      )
    const dto = expectOk(await Service.duplicate('u1', 'ws1', 's1'))
    expect(dto.id).toBe('s2')
    expect(repo.create.mock.calls[0][0].name).toBe('Leads quentes (cópia)')
    expect(repo.create.mock.calls[1][0].name).toBe('Leads quentes (cópia) 2')
  })

  describe('resolveCandidates', () => {
    it('is empty without segments and does not touch the database', async () => {
      expect(expectOk(await Service.resolveCandidates('ws1', []))).toEqual([])
      expect(repo.findManyByIds).not.toHaveBeenCalled()
    })

    it('resolves the members of every segment at the moment of use', async () => {
      repo.findManyByIds.mockResolvedValue(
        ok([row(), row({ id: 's2', name: 'Outro' })]),
      )
      repo.candidates
        .mockResolvedValueOnce(
          ok([{ leadId: 'l1', name: 'Ada', email: 'a@a.com' }]),
        )
        .mockResolvedValueOnce(
          ok([{ leadId: 'l2', name: 'Bob', email: 'b@b.com' }]),
        )
      const members = expectOk(
        await Service.resolveCandidates('ws1', ['s1', 's2']),
      )
      expect(members.map((m) => m.leadId)).toEqual(['l1', 'l2'])
      expect(repo.candidates).toHaveBeenCalledTimes(2)
    })

    it('refuses to send to a segment whose rules are no longer valid', async () => {
      repo.findManyByIds.mockResolvedValue(
        ok([row({ definition: { conditions: [{ type: 'removed' }] } })]),
      )
      expectErr(
        await Service.resolveCandidates('ws1', ['s1']),
        'CRM_SEGMENT_INVALID',
      )
      expect(repo.candidates).not.toHaveBeenCalled()
    })
  })

  it('allExist compares against the distinct ids', async () => {
    repo.findManyByIds.mockResolvedValue(ok([row()]))
    expect(expectOk(await Service.allExist('ws1', ['s1', 's1']))).toBe(true)
    expect(expectOk(await Service.allExist('ws1', ['s1', 's2']))).toBe(false)
    expect(expectOk(await Service.allExist('ws1', []))).toBe(true)
  })
})
