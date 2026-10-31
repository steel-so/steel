import type { Role } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeCrmCompany } from '@/src/__tests__/factories/crm-company.factory'
import { createFakeCrmPerson } from '@/src/__tests__/factories/crm-person.factory'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import {
  createFakeDuplicateCandidate,
  createFakeMergeLog,
} from '@/src/__tests__/factories/nov-crm-ops.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/crm-duplicate.repository')
vi.mock('@/src/repositories/notification-audience.repository')
vi.mock('@/lib/axiom/audit')
vi.mock('../notification-emitter', () => ({ emitNotification: vi.fn() }))

import { CrmDuplicateRepository } from '@/src/repositories/crm-duplicate.repository'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { NotificationAudienceRepository } from '@/src/repositories/notification-audience.repository'
import { WorkspaceModuleAccessRepository } from '@/src/repositories/workspace-module-access.repository'
import { CrmDuplicateService } from '../crm-duplicate.service'
import { emitNotification } from '../notification-emitter'

const members = vi.mocked(MembershipRepository)
const repo = vi.mocked(CrmDuplicateRepository)
const audience = vi.mocked(NotificationAudienceRepository)
const moduleAccess = vi.mocked(WorkspaceModuleAccessRepository)
const emit = vi.mocked(emitNotification)

const asRole = (role: Role) =>
  members.findByUserAndWorkspace.mockResolvedValue(
    ok(createFakeMembership({ role })),
  )

beforeEach(() => {
  vi.resetAllMocks()
  moduleAccess.isEnabled.mockResolvedValue(ok(true))
})

const personRow = (id: string, over = {}) => ({
  ...createFakeCrmPerson({ id, name: `Pessoa ${id}`, ...over }),
  company: null,
})

describe('list()', () => {
  const filters = {
    entity: 'PERSON' as const,
    status: 'PENDING' as const,
    page: 2,
    pageSize: 10,
  }

  it('should return people pairs with history counts and the pending totals', async () => {
    asRole('VIEWER')
    const row = createFakeDuplicateCandidate({ leftId: 'p1', rightId: 'p2' })
    repo.list.mockResolvedValue(ok({ rows: [row], total: 11 }))
    repo.pendingCounts.mockResolvedValue(ok({ person: 11, company: 2 }))
    repo.footprint.mockResolvedValue(ok(new Map([['p1', 3]])))
    repo.peopleByIds.mockResolvedValue(ok([personRow('p1'), personRow('p2')]))

    const page = expectOk(await CrmDuplicateService.list('u1', 'ws1', filters))

    expect(repo.list).toHaveBeenCalledWith('ws1', {
      entity: 'PERSON',
      status: 'PENDING',
      take: 10,
      skip: 10,
    })
    expect(page.pending).toEqual({ person: 11, company: 2 })
    expect(page.items).toHaveLength(1)
    expect(page.items[0].left.historyCount).toBe(3)
    expect(page.items[0].right.historyCount).toBe(0)
  })

  it('should return company pairs', async () => {
    asRole('MEMBER')
    const row = createFakeDuplicateCandidate({
      entity: 'COMPANY',
      leftId: 'c1',
      rightId: 'c2',
      reasons: ['cnpj'],
    })
    repo.list.mockResolvedValue(ok({ rows: [row], total: 1 }))
    repo.pendingCounts.mockResolvedValue(ok({ person: 0, company: 1 }))
    repo.footprint.mockResolvedValue(ok(new Map()))
    repo.companiesByIds.mockResolvedValue(
      ok([
        createFakeCrmCompany({ id: 'c1' }),
        createFakeCrmCompany({ id: 'c2' }),
      ]),
    )
    const page = expectOk(
      await CrmDuplicateService.list('u1', 'ws1', {
        ...filters,
        entity: 'COMPANY',
      }),
    )
    expect(page.items[0].reasons).toEqual(['cnpj'])
  })

  it('should skip a pair whose record no longer exists', async () => {
    asRole('MEMBER')
    repo.list.mockResolvedValue(
      ok({
        rows: [createFakeDuplicateCandidate({ leftId: 'p1', rightId: 'gone' })],
        total: 1,
      }),
    )
    repo.pendingCounts.mockResolvedValue(ok({ person: 1, company: 0 }))
    repo.footprint.mockResolvedValue(ok(new Map()))
    repo.peopleByIds.mockResolvedValue(ok([personRow('p1')]))
    expect(
      expectOk(await CrmDuplicateService.list('u1', 'ws1', filters)).items,
    ).toEqual([])
  })

  it('should reject non-members', async () => {
    members.findByUserAndWorkspace.mockResolvedValueOnce(ok(null))
    expectErr(await CrmDuplicateService.list('u1', 'ws1', filters), 'FORBIDDEN')
  })

  it.each([
    ['list', () => repo.list.mockResolvedValue(err(databaseError()))],
    [
      'counts',
      () => {
        repo.list.mockResolvedValue(ok({ rows: [], total: 0 }))
        repo.pendingCounts.mockResolvedValue(err(databaseError()))
      },
    ],
    [
      'footprint',
      () => {
        repo.list.mockResolvedValue(ok({ rows: [], total: 0 }))
        repo.pendingCounts.mockResolvedValue(ok({ person: 0, company: 0 }))
        repo.footprint.mockResolvedValue(err(databaseError()))
      },
    ],
    [
      'people',
      () => {
        repo.list.mockResolvedValue(ok({ rows: [], total: 0 }))
        repo.pendingCounts.mockResolvedValue(ok({ person: 0, company: 0 }))
        repo.footprint.mockResolvedValue(ok(new Map()))
        repo.peopleByIds.mockResolvedValue(err(databaseError()))
      },
    ],
  ])('should propagate a %s failure', async (_name, arrange) => {
    asRole('MEMBER')
    arrange()
    expectErr(
      await CrmDuplicateService.list('u1', 'ws1', filters),
      'DATABASE_ERROR',
    )
  })

  it('should propagate a company lookup failure', async () => {
    asRole('MEMBER')
    repo.list.mockResolvedValue(ok({ rows: [], total: 0 }))
    repo.pendingCounts.mockResolvedValue(ok({ person: 0, company: 0 }))
    repo.footprint.mockResolvedValue(ok(new Map()))
    repo.companiesByIds.mockResolvedValue(err(databaseError()))
    expectErr(
      await CrmDuplicateService.list('u1', 'ws1', {
        ...filters,
        entity: 'COMPANY',
      }),
      'DATABASE_ERROR',
    )
  })
})

describe('scan()', () => {
  const found = { pairs: [], created: [], pending: 0 }

  it('should scan both entities and report the new pairs', async () => {
    asRole('ADMIN')
    repo.loadPeople.mockResolvedValue(
      ok([
        {
          id: 'a',
          name: 'Ana Souza',
          emails: ['a@x.com'],
          phones: [],
          companyId: null,
        },
        {
          id: 'b',
          name: 'Ana S',
          emails: ['a@x.com'],
          phones: [],
          companyId: null,
        },
      ]),
    )
    repo.loadCompanies.mockResolvedValue(ok([]))
    repo.saveScan.mockImplementation(async (_ws, _entity, pairs) =>
      ok({ created: pairs, pending: pairs.length }),
    )
    const result = expectOk(await CrmDuplicateService.scan('u1', 'ws1'))
    expect(result).toEqual({
      person: { pairs: 1, created: 1 },
      company: { pairs: 0, created: 0 },
    })
    expect(repo.saveScan).toHaveBeenCalledWith(
      'ws1',
      'PERSON',
      expect.any(Array),
      { prune: true },
    )
  })

  it('should scan one entity only', async () => {
    asRole('ADMIN')
    repo.loadCompanies.mockResolvedValue(ok([]))
    repo.saveScan.mockResolvedValue(ok(found))
    expectOk(await CrmDuplicateService.scan('u1', 'ws1', 'COMPANY'))
    expect(repo.loadPeople).not.toHaveBeenCalled()
  })

  it('should deny a viewer', async () => {
    asRole('VIEWER')
    expectErr(await CrmDuplicateService.scan('u1', 'ws1'), 'FORBIDDEN')
  })

  it('should propagate load and save failures', async () => {
    asRole('ADMIN')
    repo.loadPeople.mockResolvedValue(err(databaseError()))
    expectErr(
      await CrmDuplicateService.scan('u1', 'ws1', 'PERSON'),
      'DATABASE_ERROR',
    )

    repo.loadPeople.mockResolvedValue(ok([]))
    repo.saveScan.mockResolvedValue(err(databaseError()))
    expectErr(
      await CrmDuplicateService.scan('u1', 'ws1', 'PERSON'),
      'DATABASE_ERROR',
    )

    repo.loadCompanies.mockResolvedValue(err(databaseError()))
    expectErr(
      await CrmDuplicateService.scan('u1', 'ws1', 'COMPANY'),
      'DATABASE_ERROR',
    )
  })
})

describe('dismiss()', () => {
  it('should dismiss a pending pair', async () => {
    asRole('MEMBER')
    repo.findCandidate.mockResolvedValue(
      ok(createFakeDuplicateCandidate({ id: 'd1' })),
    )
    repo.dismiss.mockResolvedValue(
      ok(createFakeDuplicateCandidate({ id: 'd1', status: 'DISMISSED' })),
    )
    expect(expectOk(await CrmDuplicateService.dismiss('u1', 'ws1', 'd1'))).toBe(
      'DISMISSED',
    )
    expect(repo.dismiss).toHaveBeenCalledWith('d1', 'u1')
  })

  it('should fail for a missing pair, a viewer and a resolved pair', async () => {
    repo.findCandidate.mockResolvedValueOnce(ok(null))
    expectErr(
      await CrmDuplicateService.dismiss('u1', 'ws1', 'x'),
      'CRM_DUPLICATE_NOT_FOUND',
    )

    asRole('VIEWER')
    repo.findCandidate.mockResolvedValueOnce(ok(createFakeDuplicateCandidate()))
    expectErr(await CrmDuplicateService.dismiss('u1', 'ws1', 'd1'), 'FORBIDDEN')

    asRole('MEMBER')
    repo.findCandidate.mockResolvedValueOnce(
      ok(createFakeDuplicateCandidate({ status: 'MERGED' })),
    )
    expectErr(
      await CrmDuplicateService.dismiss('u1', 'ws1', 'd1'),
      'CRM_DUPLICATE_INVALID',
    )
  })

  it('should propagate repository errors', async () => {
    repo.findCandidate.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await CrmDuplicateService.dismiss('u1', 'ws1', 'd1'),
      'DATABASE_ERROR',
    )

    asRole('MEMBER')
    repo.findCandidate.mockResolvedValueOnce(ok(createFakeDuplicateCandidate()))
    repo.dismiss.mockResolvedValue(err(databaseError()))
    expectErr(
      await CrmDuplicateService.dismiss('u1', 'ws1', 'd1'),
      'DATABASE_ERROR',
    )
  })
})

describe('merge()', () => {
  const candidate = (over = {}) =>
    createFakeDuplicateCandidate({
      id: 'd1',
      leftId: 'p1',
      rightId: 'p2',
      ...over,
    })

  it('should merge people keeping the chosen survivor and plan the fields', async () => {
    asRole('ADMIN')
    repo.findCandidate.mockResolvedValue(ok(candidate()))
    repo.loadPair.mockResolvedValue(
      ok({
        survivor: createFakeCrmPerson({
          id: 'p2',
          name: 'Ana',
          emails: ['a@x.com'],
          city: null,
        }),
        merged: createFakeCrmPerson({
          id: 'p1',
          name: 'Ana S',
          emails: ['b@x.com'],
          city: 'Recife',
        }),
      } as never),
    )
    repo.executeMerge.mockResolvedValue(
      ok(createFakeMergeLog({ id: 'm1', survivorId: 'p2', mergedId: 'p1' })),
    )

    const result = expectOk(
      await CrmDuplicateService.merge('u1', 'ws1', 'd1', { survivorId: 'p2' }),
    )

    expect(result.id).toBe('m1')
    expect(repo.loadPair).toHaveBeenCalledWith('ws1', 'PERSON', 'p2', 'p1')
    const call = repo.executeMerge.mock.calls[0][0]
    expect(call).toMatchObject({
      survivorId: 'p2',
      mergedId: 'p1',
      candidateId: 'd1',
      performedById: 'u1',
    })
    expect(call.plan.after).toMatchObject({
      emails: ['a@x.com', 'b@x.com'],
      city: 'Recife',
    })
    expect(call.undoUntil.getTime()).toBeGreaterThan(Date.now())
  })

  it('should merge companies', async () => {
    asRole('ADMIN')
    repo.findCandidate.mockResolvedValue(
      ok(candidate({ entity: 'COMPANY', leftId: 'c1', rightId: 'c2' })),
    )
    repo.loadPair.mockResolvedValue(
      ok({
        survivor: createFakeCrmCompany({ id: 'c1', name: 'Acme' }),
        merged: createFakeCrmCompany({
          id: 'c2',
          name: 'Acme Ltda',
          cnpj: '12345678000195',
        }),
      } as never),
    )
    repo.executeMerge.mockResolvedValue(
      ok(createFakeMergeLog({ entity: 'COMPANY' })),
    )
    expectOk(
      await CrmDuplicateService.merge('u1', 'ws1', 'd1', { survivorId: 'c1' }),
    )
    expect(repo.executeMerge.mock.calls[0][0].plan.after).toMatchObject({
      cnpj: '12345678000195',
    })
  })

  it('should refuse a survivor outside the pair, a resolved pair and a vanished record', async () => {
    asRole('ADMIN')
    repo.findCandidate.mockResolvedValue(ok(candidate()))
    expectErr(
      await CrmDuplicateService.merge('u1', 'ws1', 'd1', {
        survivorId: 'other',
      }),
      'CRM_DUPLICATE_INVALID',
    )

    repo.findCandidate.mockResolvedValue(ok(candidate({ status: 'DISMISSED' })))
    expectErr(
      await CrmDuplicateService.merge('u1', 'ws1', 'd1', { survivorId: 'p1' }),
      'CRM_DUPLICATE_INVALID',
    )

    repo.findCandidate.mockResolvedValue(ok(candidate()))
    repo.loadPair.mockResolvedValue(
      ok({ survivor: createFakeCrmPerson(), merged: null } as never),
    )
    expectErr(
      await CrmDuplicateService.merge('u1', 'ws1', 'd1', { survivorId: 'p1' }),
      'CRM_DUPLICATE_INVALID',
    )
  })

  it('should fail for a missing pair and a viewer', async () => {
    repo.findCandidate.mockResolvedValueOnce(ok(null))
    expectErr(
      await CrmDuplicateService.merge('u1', 'ws1', 'x', { survivorId: 'p1' }),
      'CRM_DUPLICATE_NOT_FOUND',
    )
    asRole('VIEWER')
    repo.findCandidate.mockResolvedValueOnce(ok(candidate()))
    expectErr(
      await CrmDuplicateService.merge('u1', 'ws1', 'd1', { survivorId: 'p1' }),
      'FORBIDDEN',
    )
  })

  it('should propagate lookup and merge failures', async () => {
    repo.findCandidate.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await CrmDuplicateService.merge('u1', 'ws1', 'd1', { survivorId: 'p1' }),
      'DATABASE_ERROR',
    )

    asRole('ADMIN')
    repo.findCandidate.mockResolvedValue(ok(candidate()))
    repo.loadPair.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await CrmDuplicateService.merge('u1', 'ws1', 'd1', { survivorId: 'p1' }),
      'DATABASE_ERROR',
    )

    repo.loadPair.mockResolvedValue(
      ok({
        survivor: createFakeCrmPerson(),
        merged: createFakeCrmPerson(),
      } as never),
    )
    repo.executeMerge.mockResolvedValue(err(databaseError()))
    expectErr(
      await CrmDuplicateService.merge('u1', 'ws1', 'd1', { survivorId: 'p1' }),
      'DATABASE_ERROR',
    )
  })
})

describe('undo() and listMerges()', () => {
  it('should undo a merge', async () => {
    asRole('ADMIN')
    repo.findMerge.mockResolvedValue(ok(createFakeMergeLog({ id: 'm1' })))
    repo.undoMerge.mockResolvedValue(
      ok(createFakeMergeLog({ id: 'm1', undoneAt: new Date() })),
    )
    const result = expectOk(await CrmDuplicateService.undo('u1', 'ws1', 'm1'))
    expect(result.undoneAt).not.toBeNull()
    expect(repo.undoMerge).toHaveBeenCalledWith(
      expect.objectContaining({ mergeId: 'm1', undoneById: 'u1' }),
    )
  })

  it('should describe a merge without a name and propagate failures', async () => {
    asRole('ADMIN')
    repo.findMerge.mockResolvedValue(
      ok(createFakeMergeLog({ snapshot: null as never })),
    )
    repo.undoMerge.mockResolvedValue(err(databaseError()))
    expectErr(
      await CrmDuplicateService.undo('u1', 'ws1', 'm1'),
      'DATABASE_ERROR',
    )
    expect(repo.undoMerge).toHaveBeenCalledWith(
      expect.objectContaining({ summary: 'Desfez a mesclagem' }),
    )

    repo.findMerge.mockResolvedValue(err(databaseError()))
    expectErr(
      await CrmDuplicateService.undo('u1', 'ws1', 'm1'),
      'DATABASE_ERROR',
    )

    asRole('VIEWER')
    repo.findMerge.mockResolvedValue(ok(createFakeMergeLog()))
    expectErr(await CrmDuplicateService.undo('u1', 'ws1', 'm1'), 'FORBIDDEN')
  })

  it('should list recent merges', async () => {
    asRole('VIEWER')
    repo.listMerges.mockResolvedValue(ok([createFakeMergeLog()]))
    expect(
      expectOk(await CrmDuplicateService.listMerges('u1', 'ws1', 'PERSON')),
    ).toHaveLength(1)
    repo.listMerges.mockResolvedValue(err(databaseError()))
    expectErr(
      await CrmDuplicateService.listMerges('u1', 'ws1', 'PERSON'),
      'DATABASE_ERROR',
    )
    members.findByUserAndWorkspace.mockResolvedValueOnce(ok(null))
    expectErr(
      await CrmDuplicateService.listMerges('u1', 'ws1', 'PERSON'),
      'FORBIDDEN',
    )
  })
})

describe('flagOnArrival()', () => {
  it('should store the pairs of a new person', async () => {
    repo.personNeighbourhood.mockResolvedValue(
      ok({
        probe: {
          id: 'new',
          name: 'Ana Souza',
          emails: ['a@x.com'],
          phones: [],
          companyId: null,
        },
        others: [
          {
            id: 'old',
            name: 'Ana S',
            emails: ['a@x.com'],
            phones: [],
            companyId: null,
          },
        ],
      }),
    )
    repo.saveScan.mockImplementation(async (_w, _e, pairs) =>
      ok({ created: pairs, pending: 1 }),
    )
    expect(
      await CrmDuplicateService.flagOnArrival('ws1', 'PERSON', 'new'),
    ).toBe(1)
    expect(repo.saveScan).toHaveBeenCalledWith(
      'ws1',
      'PERSON',
      expect.any(Array),
      { prune: false },
    )
  })

  it('should store the pairs of a new company', async () => {
    repo.companyNeighbourhood.mockResolvedValue(
      ok({
        probe: {
          id: 'new',
          name: 'Acme',
          cnpj: '12345678000195',
          domain: null,
        },
        others: [
          {
            id: 'old',
            name: 'Acme SA',
            cnpj: '12.345.678/0001-95',
            domain: null,
          },
        ],
      }),
    )
    repo.saveScan.mockImplementation(async (_w, _e, pairs) =>
      ok({ created: pairs, pending: 1 }),
    )
    expect(
      await CrmDuplicateService.flagOnArrival('ws1', 'COMPANY', 'new'),
    ).toBe(1)
  })

  it('should do nothing when there is no match, no record or a failure', async () => {
    repo.personNeighbourhood.mockResolvedValueOnce(ok(null))
    expect(await CrmDuplicateService.flagOnArrival('ws1', 'PERSON', 'x')).toBe(
      0,
    )
    repo.personNeighbourhood.mockResolvedValueOnce(err(databaseError()))
    expect(await CrmDuplicateService.flagOnArrival('ws1', 'PERSON', 'x')).toBe(
      0,
    )
    repo.personNeighbourhood.mockResolvedValueOnce(
      ok({
        probe: {
          id: 'a',
          name: 'Zed',
          emails: [],
          phones: [],
          companyId: null,
        },
        others: [],
      }),
    )
    expect(await CrmDuplicateService.flagOnArrival('ws1', 'PERSON', 'a')).toBe(
      0,
    )
    expect(repo.saveScan).not.toHaveBeenCalled()
    repo.companyNeighbourhood.mockResolvedValueOnce(ok(null))
    expect(await CrmDuplicateService.flagOnArrival('ws1', 'COMPANY', 'x')).toBe(
      0,
    )
  })

  it('should never throw and report a failed save as zero', async () => {
    repo.personNeighbourhood.mockRejectedValueOnce(new Error('boom'))
    expect(await CrmDuplicateService.flagOnArrival('ws1', 'PERSON', 'x')).toBe(
      0,
    )

    repo.personNeighbourhood.mockResolvedValue(
      ok({
        probe: {
          id: 'new',
          name: 'Ana Souza',
          emails: ['a@x.com'],
          phones: [],
          companyId: null,
        },
        others: [
          {
            id: 'old',
            name: 'Ana S',
            emails: ['a@x.com'],
            phones: [],
            companyId: null,
          },
        ],
      }),
    )
    repo.saveScan.mockResolvedValue(err(databaseError()))
    expect(
      await CrmDuplicateService.flagOnArrival('ws1', 'PERSON', 'new'),
    ).toBe(0)
  })
})

describe('detectWorkspace() and runScheduled()', () => {
  it('should scan, then tell the admins once about the pending pairs', async () => {
    repo.loadPeople.mockResolvedValue(ok([]))
    repo.loadCompanies.mockResolvedValue(ok([]))
    repo.saveScan.mockResolvedValue(
      ok({
        created: [{ leftId: 'a', rightId: 'b', score: 95, reasons: ['email'] }],
        pending: 1,
      }),
    )
    repo.pendingCounts.mockResolvedValue(ok({ person: 2, company: 0 }))
    repo.markNotified.mockResolvedValueOnce(ok(2))
    audience.listPrivilegedUserIds.mockResolvedValue(ok(['admin1']))

    expect(expectOk(await CrmDuplicateService.detectWorkspace('ws1'))).toBe(2)
    expect(emit).toHaveBeenCalledTimes(1)
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'CRM_DUPLICATES_FOUND',
        recipients: ['admin1'],
        body: expect.stringContaining('2 pares de pessoas'),
      }),
    )
  })

  it('should word a single company pair in the singular', async () => {
    repo.loadPeople.mockResolvedValue(ok([]))
    repo.loadCompanies.mockResolvedValue(ok([]))
    repo.saveScan.mockResolvedValue(ok({ created: [], pending: 0 }))
    repo.pendingCounts.mockResolvedValue(ok({ person: 0, company: 1 }))
    repo.markNotified.mockResolvedValue(ok(1))
    audience.listPrivilegedUserIds.mockResolvedValue(ok(['admin1']))
    await CrmDuplicateService.detectWorkspace('ws1')
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.stringContaining('1 par de empresas'),
      }),
    )
  })

  it('should stay quiet when already notified, or nobody is an admin', async () => {
    repo.loadPeople.mockResolvedValue(ok([]))
    repo.loadCompanies.mockResolvedValue(ok([]))
    repo.saveScan.mockResolvedValue(ok({ created: [], pending: 0 }))
    repo.pendingCounts.mockResolvedValue(ok({ person: 1, company: 1 }))
    repo.markNotified.mockResolvedValueOnce(ok(0)).mockResolvedValueOnce(ok(1))
    audience.listPrivilegedUserIds.mockResolvedValue(err(databaseError()))
    await CrmDuplicateService.detectWorkspace('ws1')
    expect(emit).not.toHaveBeenCalled()

    repo.markNotified.mockResolvedValue(err(databaseError()))
    await CrmDuplicateService.detectWorkspace('ws1')
    expect(emit).not.toHaveBeenCalled()
  })

  it('should propagate a scan failure and skip counts that fail', async () => {
    repo.loadPeople.mockResolvedValue(err(databaseError()))
    expectErr(
      await CrmDuplicateService.detectWorkspace('ws1'),
      'DATABASE_ERROR',
    )

    repo.loadPeople.mockResolvedValue(ok([]))
    repo.loadCompanies.mockResolvedValue(ok([]))
    repo.saveScan.mockResolvedValue(ok({ created: [], pending: 0 }))
    repo.pendingCounts.mockResolvedValue(err(databaseError()))
    expectOk(await CrmDuplicateService.detectWorkspace('ws1'))
    expect(emit).not.toHaveBeenCalled()
  })

  it('should walk every CRM workspace and count the failures', async () => {
    repo.listCrmWorkspaceIds.mockResolvedValue(ok(['ws1', 'ws2']))
    repo.loadPeople
      .mockResolvedValueOnce(ok([]))
      .mockResolvedValueOnce(err(databaseError()))
    repo.loadCompanies.mockResolvedValue(ok([]))
    repo.saveScan.mockResolvedValue(
      ok({
        created: [{ leftId: 'a', rightId: 'b', score: 90, reasons: ['phone'] }],
        pending: 0,
      }),
    )
    repo.pendingCounts.mockResolvedValue(ok({ person: 0, company: 0 }))
    expect(expectOk(await CrmDuplicateService.runScheduled())).toEqual({
      workspaces: 2,
      created: 2,
      failed: 1,
    })

    repo.listCrmWorkspaceIds.mockResolvedValue(err(databaseError()))
    expectErr(await CrmDuplicateService.runScheduled(), 'DATABASE_ERROR')
  })
})
