import type { Role } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import {
  createFakeCrmCadence,
  createFakeCrmCadenceEnrollment,
  createFakeCrmCadenceStep,
} from '@/src/__tests__/factories/nov-c1-sales-cadences.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/crm-cadence.repository')
vi.mock('@/lib/axiom/audit')

import {
  CrmCadenceEnrollmentRepository,
  type CrmCadenceEnrollmentView,
  CrmCadenceLookupRepository,
  CrmCadenceRepository,
} from '@/src/repositories/crm-cadence.repository'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { WorkspaceModuleAccessRepository } from '@/src/repositories/workspace-module-access.repository'
import { CrmCadenceEnrollmentService } from '../crm-cadence-enrollment.service'

const members = vi.mocked(MembershipRepository)
const cadences = vi.mocked(CrmCadenceRepository)
const enrollments = vi.mocked(CrmCadenceEnrollmentRepository)
const lookup = vi.mocked(CrmCadenceLookupRepository)
const moduleAccess = vi.mocked(WorkspaceModuleAccessRepository)

const now = new Date('2026-10-29T12:00:00Z')

const asRole = (role: Role) =>
  members.findByUserAndWorkspace.mockResolvedValue(
    ok(createFakeMembership({ role })),
  )

const view = (overrides = {}): CrmCadenceEnrollmentView => ({
  ...createFakeCrmCadenceEnrollment({ id: 'e1' }),
  cadence: { name: 'Outbound', _count: { steps: 2 } },
  lead: { name: 'Ana' },
  runs: [],
  ...overrides,
})

const lead = (overrides = {}) => ({
  id: 'l1',
  name: 'Ana',
  stage: 'RECEIVED',
  emails: ['ana@empresa.com.br'],
  phones: [],
  ...overrides,
})

beforeEach(() => {
  vi.resetAllMocks()
  moduleAccess.isEnabled.mockResolvedValue(ok(true))
})

describe('list()', () => {
  it('should list for a viewer and map the rows', async () => {
    asRole('VIEWER')
    enrollments.list.mockResolvedValue(ok([view()]))
    const rows = expectOk(
      await CrmCadenceEnrollmentService.list('u1', 'ws1', { leadId: 'l1' }),
    )
    expect(rows[0]).toMatchObject({ cadenceName: 'Outbound', totalSteps: 2 })
    expect(enrollments.list).toHaveBeenCalledWith('ws1', { leadId: 'l1' })
  })

  it('should reject non-members and propagate errors', async () => {
    members.findByUserAndWorkspace.mockResolvedValueOnce(ok(null))
    expectErr(
      await CrmCadenceEnrollmentService.list('u1', 'ws1', {}),
      'FORBIDDEN',
    )

    asRole('MEMBER')
    enrollments.list.mockResolvedValue(err(databaseError()))
    expectErr(
      await CrmCadenceEnrollmentService.list('u1', 'ws1', {}),
      'DATABASE_ERROR',
    )
  })
})

describe('enroll()', () => {
  const dto = { cadenceId: 'c1', leadIds: ['l1'] }
  const cadence = (overrides = {}) =>
    createFakeCrmCadence({
      id: 'c1',
      steps: [
        createFakeCrmCadenceStep({
          position: 0,
          delayValue: 2,
          delayUnit: 'HOURS',
        }),
      ],
      ...overrides,
    })

  it('should deny a viewer', async () => {
    asRole('VIEWER')
    expectErr(
      await CrmCadenceEnrollmentService.enroll('u1', 'ws1', dto, now),
      'FORBIDDEN',
    )
  })

  it('should enroll the lead with the first step delay', async () => {
    asRole('MEMBER')
    cadences.findById.mockResolvedValue(ok(cadence()))
    lookup.findLeads.mockResolvedValue(ok([lead()]))
    enrollments.enroll.mockResolvedValue(ok({ id: 'e1', running: false }))
    enrollments.findById.mockResolvedValue(ok(view()))

    const result = expectOk(
      await CrmCadenceEnrollmentService.enroll('u1', 'ws1', dto, now),
    )
    expect(result.enrolled).toHaveLength(1)
    expect(result.skipped).toEqual([])
    expect(enrollments.enroll).toHaveBeenCalledWith({
      workspaceId: 'ws1',
      cadenceId: 'c1',
      leadId: 'l1',
      enrolledById: 'u1',
      firstRunAt: new Date(now.getTime() + 2 * 3600 * 1000),
    })
  })

  it('should explain why each lead was skipped', async () => {
    asRole('MEMBER')
    cadences.findById.mockResolvedValue(ok(cadence()))
    lookup.findLeads.mockResolvedValue(
      ok([
        lead({ id: 'closed', stage: 'CLOSED' }),
        lead({ id: 'nocontact', emails: [], phones: [] }),
        lead({ id: 'running' }),
      ]),
    )
    enrollments.enroll.mockResolvedValue(ok({ id: 'e9', running: true }))

    const result = expectOk(
      await CrmCadenceEnrollmentService.enroll(
        'u1',
        'ws1',
        {
          cadenceId: 'c1',
          leadIds: ['missing', 'closed', 'nocontact', 'running', 'running'],
        },
        now,
      ),
    )
    expect(result.enrolled).toEqual([])
    expect(result.skipped).toEqual([
      { leadId: 'missing', reason: 'Lead não encontrado' },
      { leadId: 'closed', reason: 'O lead já foi fechado' },
      { leadId: 'nocontact', reason: 'O lead não tem e-mail nem telefone' },
      { leadId: 'running', reason: 'O lead já está nesta cadência' },
    ])
  })

  it('should refuse a paused cadence or one without steps', async () => {
    asRole('MEMBER')
    cadences.findById.mockResolvedValueOnce(ok(cadence({ status: 'PAUSED' })))
    expectErr(
      await CrmCadenceEnrollmentService.enroll('u1', 'ws1', dto, now),
      'CRM_CADENCE_STATE_CONFLICT',
    )
    cadences.findById.mockResolvedValueOnce(ok(cadence({ steps: [] })))
    expectErr(
      await CrmCadenceEnrollmentService.enroll('u1', 'ws1', dto, now),
      'CRM_CADENCE_STATE_CONFLICT',
    )
  })

  it('should propagate lookup and write failures', async () => {
    asRole('MEMBER')
    cadences.findById.mockResolvedValueOnce(
      err({ code: 'CRM_CADENCE_NOT_FOUND', message: 'x' } as never),
    )
    expectErr(
      await CrmCadenceEnrollmentService.enroll('u1', 'ws1', dto, now),
      'CRM_CADENCE_NOT_FOUND',
    )

    cadences.findById.mockResolvedValue(ok(cadence()))
    lookup.findLeads.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await CrmCadenceEnrollmentService.enroll('u1', 'ws1', dto, now),
      'DATABASE_ERROR',
    )

    lookup.findLeads.mockResolvedValue(ok([lead()]))
    enrollments.enroll.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await CrmCadenceEnrollmentService.enroll('u1', 'ws1', dto, now),
      'DATABASE_ERROR',
    )

    enrollments.enroll.mockResolvedValue(ok({ id: 'e1', running: false }))
    enrollments.findById.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await CrmCadenceEnrollmentService.enroll('u1', 'ws1', dto, now),
      'DATABASE_ERROR',
    )
  })

  it('should tolerate an enrollment that vanished before the readback', async () => {
    asRole('MEMBER')
    cadences.findById.mockResolvedValue(ok(cadence()))
    lookup.findLeads.mockResolvedValue(ok([lead()]))
    enrollments.enroll.mockResolvedValue(ok({ id: 'e1', running: false }))
    enrollments.findById.mockResolvedValue(ok(null))
    expect(
      expectOk(await CrmCadenceEnrollmentService.enroll('u1', 'ws1', dto, now))
        .enrolled,
    ).toEqual([])
  })
})

describe('act()', () => {
  beforeEach(() => {
    asRole('MEMBER')
    enrollments.findById.mockResolvedValue(ok(view()))
  })

  it.each([
    ['pause', 'pause', []],
    ['resume', 'resume', ['e1', now]],
  ] as const)('should %s', async (action, method, args) => {
    ;(enrollments[method] as ReturnType<typeof vi.fn>).mockResolvedValue(
      ok(true),
    )
    expectOk(
      await CrmCadenceEnrollmentService.act('u1', 'ws1', 'e1', { action }, now),
    )
    expect(enrollments[method]).toHaveBeenCalledWith(
      ...(args.length ? args : ['e1']),
    )
  })

  it('should stop manually', async () => {
    enrollments.finish.mockResolvedValue(ok(1))
    expectOk(
      await CrmCadenceEnrollmentService.act(
        'u1',
        'ws1',
        'e1',
        { action: 'stop' },
        now,
      ),
    )
    expect(enrollments.finish).toHaveBeenCalledWith(
      ['e1'],
      'STOPPED',
      'MANUAL',
      null,
      now,
    )
  })

  it('should register a manual reply', async () => {
    enrollments.finish.mockResolvedValue(ok(1))
    expectOk(
      await CrmCadenceEnrollmentService.act(
        'u1',
        'ws1',
        'e1',
        { action: 'replied' },
        now,
      ),
    )
    expect(enrollments.finish).toHaveBeenCalledWith(
      ['e1'],
      'REPLIED',
      'REPLIED',
      'MANUAL',
      now,
    )
  })

  it('should conflict when nothing changed', async () => {
    enrollments.pause.mockResolvedValue(ok(false))
    expectErr(
      await CrmCadenceEnrollmentService.act(
        'u1',
        'ws1',
        'e1',
        { action: 'pause' },
        now,
      ),
      'CRM_CADENCE_STATE_CONFLICT',
    )
  })

  it('should deny a viewer and report a missing enrollment', async () => {
    asRole('VIEWER')
    expectErr(
      await CrmCadenceEnrollmentService.act(
        'u1',
        'ws1',
        'e1',
        { action: 'stop' },
        now,
      ),
      'FORBIDDEN',
    )

    asRole('MEMBER')
    enrollments.findById.mockResolvedValueOnce(ok(null))
    expectErr(
      await CrmCadenceEnrollmentService.act(
        'u1',
        'ws1',
        'zz',
        { action: 'stop' },
        now,
      ),
      'CRM_CADENCE_ENROLLMENT_NOT_FOUND',
    )

    enrollments.findById.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await CrmCadenceEnrollmentService.act(
        'u1',
        'ws1',
        'zz',
        { action: 'stop' },
        now,
      ),
      'DATABASE_ERROR',
    )
  })

  it('should propagate write and readback errors', async () => {
    enrollments.finish.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await CrmCadenceEnrollmentService.act(
        'u1',
        'ws1',
        'e1',
        { action: 'stop' },
        now,
      ),
      'DATABASE_ERROR',
    )

    enrollments.finish.mockResolvedValue(ok(1))
    enrollments.findById
      .mockResolvedValueOnce(ok(view()))
      .mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await CrmCadenceEnrollmentService.act(
        'u1',
        'ws1',
        'e1',
        { action: 'stop' },
        now,
      ),
      'DATABASE_ERROR',
    )

    enrollments.findById
      .mockResolvedValueOnce(ok(view()))
      .mockResolvedValueOnce(ok(null))
    expectErr(
      await CrmCadenceEnrollmentService.act(
        'u1',
        'ws1',
        'e1',
        { action: 'stop' },
        now,
      ),
      'CRM_CADENCE_ENROLLMENT_NOT_FOUND',
    )
  })
})
