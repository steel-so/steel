import { afterEach, describe, expect, it, vi } from 'vitest'
import { seedCrmLead } from '@/src/__tests__/factories/crm-lead.factory'
import {
  seedCrmCadence,
  seedCrmCadenceEnrollment,
} from '@/src/__tests__/factories/nov-c1-sales-cadences.factory'
import { seedUser } from '@/src/__tests__/factories/user.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import type { CrmCadenceStepInput } from '@/src/schemas/crm-cadence.schema'
import {
  CrmCadenceEnrollmentRepository,
  CrmCadenceLookupRepository,
  CrmCadenceRepository,
} from '../crm-cadence.repository'

const fields = {
  name: 'Outbound',
  stopOnReply: true,
  stopOnClick: false,
  weekdaysOnly: true,
}
const step = (
  overrides: Partial<CrmCadenceStepInput> = {},
): CrmCadenceStepInput => ({
  type: 'TASK',
  delayValue: 1,
  delayUnit: 'DAYS',
  subject: 'Ligar',
  body: '',
  templateVariables: [],
  ...overrides,
})

async function setup() {
  const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
  return { workspace, user }
}

describe('CrmCadenceRepository', () => {
  it('should create a cadence with ordered steps and read it back', async () => {
    const { workspace, user } = await setup()
    const created = expectOk(
      await CrmCadenceRepository.create(
        workspace.id,
        user.id,
        {
          ...fields,
          description: 'Para leads frios',
          emailFrom: 'a@b.com',
          emailReplyTo: 'resp@b.com',
          whatsappConnectionId: 'conn1',
          windowStartHour: 9,
          windowEndHour: 18,
        },
        [
          step({ subject: 'Primeiro' }),
          step({ type: 'WHATSAPP', subject: null, body: 'Oi' }),
        ],
      ),
    )
    expect(created).toMatchObject({
      description: 'Para leads frios',
      emailReplyTo: 'resp@b.com',
      whatsappConnectionId: 'conn1',
    })
    expect(created.steps.map((s) => [s.position, s.subject])).toEqual([
      [0, 'Primeiro'],
      [1, null],
    ])

    const minimal = expectOk(
      await CrmCadenceRepository.create(workspace.id, user.id, fields, [
        step({ subject: undefined }),
      ]),
    )
    expect(minimal).toMatchObject({
      description: null,
      emailFrom: null,
      emailReplyTo: null,
      whatsappConnectionId: null,
      windowStartHour: null,
    })
    expect(minimal.steps[0].subject).toBeNull()

    const found = expectOk(
      await CrmCadenceRepository.findById(created.id, workspace.id),
    )
    expect(found.windowStartHour).toBe(9)
    expect(
      expectOk(await CrmCadenceRepository.list(workspace.id)),
    ).toHaveLength(2)
  })

  it('should not find a cadence of another workspace or an archived one', async () => {
    const { workspace, user } = await setup()
    const other = await seedWorkspace()
    const cadence = await seedCrmCadence(workspace.id, user.id)

    expectErr(
      await CrmCadenceRepository.findById(cadence.id, other.id),
      'CRM_CADENCE_NOT_FOUND',
    )
    expectOk(await CrmCadenceRepository.archive(cadence.id, user.id))
    expectErr(
      await CrmCadenceRepository.findById(cadence.id, workspace.id),
      'CRM_CADENCE_NOT_FOUND',
    )
    expect(expectOk(await CrmCadenceRepository.list(workspace.id))).toEqual([])
    const row = await prisma.crmCadence.findUniqueOrThrow({
      where: { id: cadence.id },
    })
    expect(row.status).toBe('ARCHIVED')
  })

  it('should update fields and replace the steps', async () => {
    const { workspace, user } = await setup()
    const cadence = await seedCrmCadence(workspace.id, user.id, undefined, [
      { type: 'TASK', subject: 'A' },
      { type: 'TASK', subject: 'B' },
    ])

    const updated = expectOk(
      await CrmCadenceRepository.update(
        cadence.id,
        workspace.id,
        user.id,
        { name: 'Novo', status: 'PAUSED' },
        [step({ subject: 'Só um' })],
      ),
    )
    expect(updated).toMatchObject({
      name: 'Novo',
      status: 'PAUSED',
      updatedById: user.id,
    })
    expect(updated.steps.map((s) => s.subject)).toEqual(['Só um'])

    const untouched = expectOk(
      await CrmCadenceRepository.update(cadence.id, workspace.id, user.id, {
        name: 'Outro',
      }),
    )
    expect(untouched.steps).toHaveLength(1)
  })

  it('should count enrollments by status and runs by step', async () => {
    const { workspace, user } = await setup()
    const cadence = await seedCrmCadence(workspace.id, user.id)
    const [leadA, leadB] = await Promise.all([
      seedCrmLead(workspace.id, user.id),
      seedCrmLead(workspace.id, user.id),
    ])
    const ids = {
      workspaceId: workspace.id,
      cadenceId: cadence.id,
      enrolledById: user.id,
    }
    const a = await seedCrmCadenceEnrollment({ ...ids, leadId: leadA.id })
    await seedCrmCadenceEnrollment({
      ...ids,
      leadId: leadB.id,
      overrides: { status: 'REPLIED' },
    })
    await CrmCadenceEnrollmentRepository.recordRun({
      ...ids,
      enrollmentId: a.id,
      stepId: cadence.steps[0].id,
      position: 0,
      type: 'TASK',
      status: 'SENT',
    })

    expect(expectOk(await CrmCadenceRepository.enrollmentCounts([]))).toEqual(
      [],
    )
    const counts = expectOk(
      await CrmCadenceRepository.enrollmentCounts([cadence.id]),
    )
    expect(counts.map((c) => [c.status, c.n]).sort()).toEqual([
      ['ACTIVE', 1],
      ['REPLIED', 1],
    ])
    expect(expectOk(await CrmCadenceRepository.runCounts([]))).toEqual([])
    expect(
      expectOk(await CrmCadenceRepository.runCounts([cadence.id])),
    ).toEqual([{ cadenceId: cadence.id, position: 0, status: 'SENT', n: 1 }])
  })

  it('should find open enrollments by e-mail and by phone, any format', async () => {
    const { workspace, user } = await setup()
    const cadence = await seedCrmCadence(workspace.id, user.id)
    const stays = await seedCrmCadence(workspace.id, user.id, {
      stopOnReply: false,
    })
    const lead = await seedCrmLead(workspace.id, user.id, {
      emails: ['Ana@Empresa.com.br'],
      phones: ['(11) 99999-0000'],
    })
    const ids = {
      workspaceId: workspace.id,
      enrolledById: user.id,
      leadId: lead.id,
    }
    const running = await seedCrmCadenceEnrollment({
      ...ids,
      cadenceId: cadence.id,
    })
    await seedCrmCadenceEnrollment({ ...ids, cadenceId: stays.id })

    expect(
      expectOk(
        await CrmCadenceRepository.stopOnReplyEnrollmentIdsByEmail(
          workspace.id,
          ['ana@empresa.com.br'],
        ),
      ),
    ).toEqual([running.id])
    expect(
      expectOk(
        await CrmCadenceRepository.stopOnReplyEnrollmentIdsByPhone(
          workspace.id,
          '5511999990000',
        ),
      ),
    ).toEqual([running.id])

    // Other workspace, other number, empty input, finished enrollment.
    const other = await seedWorkspace()
    expect(
      expectOk(
        await CrmCadenceRepository.stopOnReplyEnrollmentIdsByEmail(other.id, [
          'ana@empresa.com.br',
        ]),
      ),
    ).toEqual([])
    expect(
      expectOk(
        await CrmCadenceRepository.stopOnReplyEnrollmentIdsByPhone(
          workspace.id,
          '5511988880000',
        ),
      ),
    ).toEqual([])
    expect(
      expectOk(
        await CrmCadenceRepository.stopOnReplyEnrollmentIdsByEmail(
          workspace.id,
          [],
        ),
      ),
    ).toEqual([])
    expect(
      expectOk(
        await CrmCadenceRepository.stopOnReplyEnrollmentIdsByPhone(
          workspace.id,
          '123',
        ),
      ),
    ).toEqual([])
    await CrmCadenceEnrollmentRepository.finish(
      [running.id],
      'STOPPED',
      'MANUAL',
      null,
      new Date(),
    )
    expect(
      expectOk(
        await CrmCadenceRepository.stopOnReplyEnrollmentIdsByEmail(
          workspace.id,
          ['ana@empresa.com.br'],
        ),
      ),
    ).toEqual([])
  })
})

describe('CrmCadenceEnrollmentRepository', () => {
  async function scenario() {
    const { workspace, user } = await setup()
    const cadence = await seedCrmCadence(workspace.id, user.id, undefined, [
      { type: 'TASK', subject: 'A' },
      { type: 'TASK', subject: 'B' },
    ])
    const lead = await seedCrmLead(workspace.id, user.id, { name: 'Ana' })
    const ids = {
      workspaceId: workspace.id,
      cadenceId: cadence.id,
      leadId: lead.id,
      enrolledById: user.id,
    }
    return { workspace, user, cadence, lead, ids }
  }

  it('should enroll once, restart a finished enrollment and list with filters', async () => {
    const { workspace, cadence, lead, ids } = await scenario()
    const firstRunAt = new Date('2026-10-30T12:00:00Z')

    const first = expectOk(
      await CrmCadenceEnrollmentRepository.enroll({ ...ids, firstRunAt }),
    )
    expect(first.running).toBe(false)
    const again = expectOk(
      await CrmCadenceEnrollmentRepository.enroll({ ...ids, firstRunAt }),
    )
    expect(again).toEqual({ id: first.id, running: true })

    expectOk(
      await CrmCadenceEnrollmentRepository.finish(
        [first.id],
        'STOPPED',
        'MANUAL',
        null,
        new Date(),
      ),
    )
    const restarted = expectOk(
      await CrmCadenceEnrollmentRepository.enroll({ ...ids, firstRunAt }),
    )
    expect(restarted).toEqual({ id: first.id, running: false })
    const row = await prisma.crmCadenceEnrollment.findUniqueOrThrow({
      where: { id: first.id },
    })
    expect(row).toMatchObject({
      status: 'ACTIVE',
      stopReason: null,
      finishedAt: null,
      nextRunAt: firstRunAt,
    })

    const listed = expectOk(
      await CrmCadenceEnrollmentRepository.list(workspace.id, {
        cadenceId: cadence.id,
        leadId: lead.id,
        status: 'ACTIVE',
      }),
    )
    expect(listed).toHaveLength(1)
    expect(listed[0]).toMatchObject({
      lead: { name: 'Ana' },
      cadence: { _count: { steps: 2 } },
    })
    expect(
      expectOk(
        await CrmCadenceEnrollmentRepository.list(workspace.id, {
          status: 'REPLIED',
        }),
      ),
    ).toEqual([])
    expect(
      expectOk(
        await CrmCadenceEnrollmentRepository.findById(first.id, workspace.id),
      ),
    ).not.toBeNull()
    expect(
      expectOk(
        await CrmCadenceEnrollmentRepository.findById(first.id, 'other'),
      ),
    ).toBeNull()
  })

  it('should claim only due, active enrollments of active cadences, once', async () => {
    const { workspace, user, cadence, lead, ids } = await scenario()
    const now = new Date('2026-10-29T12:00:00Z')
    const due = await seedCrmCadenceEnrollment({
      ...ids,
      overrides: { nextRunAt: new Date(now.getTime() - 1000) },
    })
    const future = await seedCrmLead(workspace.id, user.id)
    const upcoming = await seedCrmCadenceEnrollment({
      ...ids,
      leadId: future.id,
      overrides: { nextRunAt: new Date(now.getTime() + 60_000) },
    })
    const paused = await seedCrmCadence(workspace.id, user.id, {
      status: 'PAUSED',
    })
    const pausedLead = await seedCrmLead(workspace.id, user.id)
    await seedCrmCadenceEnrollment({
      ...ids,
      cadenceId: paused.id,
      leadId: pausedLead.id,
    })
    const stale = new Date(now.getTime() - 10 * 60_000)

    const claimed = expectOk(
      await CrmCadenceEnrollmentRepository.claimDue(now, stale, 10),
    )
    expect(claimed.map((row) => row.id)).toEqual([due.id])
    expect(claimed[0].cadence.steps).toHaveLength(2)
    expect(claimed[0].lead.id).toBe(lead.id)
    expect(claimed[0].claimedAt).toEqual(now)

    // Claimed: not taken again until the claim goes stale.
    expect(
      expectOk(await CrmCadenceEnrollmentRepository.claimDue(now, stale, 10)),
    ).toEqual([])
    const later = new Date(now.getTime() + 11 * 60_000)
    const again = expectOk(
      await CrmCadenceEnrollmentRepository.claimDue(
        later,
        new Date(later.getTime() - 10 * 60_000),
        10,
      ),
    )
    expect(again.map((row) => row.id)).toEqual([due.id, upcoming.id])
    expect(cadence.id).toBeTruthy()
  })

  it('should complete a step: advance, record the run and finish on the last', async () => {
    const { workspace, cadence, ids } = await scenario()
    const enrollment = await seedCrmCadenceEnrollment(ids)
    const now = new Date('2026-10-29T12:00:00Z')
    const base = {
      enrollmentId: enrollment.id,
      workspaceId: workspace.id,
      cadenceId: cadence.id,
      type: 'TASK' as const,
      status: 'SENT' as const,
      now,
    }
    const nextRunAt = new Date('2026-10-30T12:00:00Z')

    expect(
      expectOk(
        await CrmCadenceEnrollmentRepository.completeStep({
          ...base,
          stepId: cadence.steps[0].id,
          position: 0,
          detail: 'ok',
          providerMessageId: 'pm1',
          next: { position: 1, runAt: nextRunAt },
        }),
      ),
    ).toBe(true)
    let row = await prisma.crmCadenceEnrollment.findUniqueOrThrow({
      where: { id: enrollment.id },
    })
    expect(row).toMatchObject({
      nextPosition: 1,
      nextRunAt,
      claimedAt: null,
      status: 'ACTIVE',
    })

    // Same position again: the enrollment already moved on, nothing is recorded.
    expect(
      expectOk(
        await CrmCadenceEnrollmentRepository.completeStep({
          ...base,
          stepId: cadence.steps[0].id,
          position: 0,
          next: null,
        }),
      ),
    ).toBe(false)

    expect(
      expectOk(
        await CrmCadenceEnrollmentRepository.completeStep({
          ...base,
          stepId: cadence.steps[1].id,
          position: 1,
          status: 'SKIPPED',
          next: null,
        }),
      ),
    ).toBe(true)
    row = await prisma.crmCadenceEnrollment.findUniqueOrThrow({
      where: { id: enrollment.id },
    })
    expect(row).toMatchObject({
      status: 'COMPLETED',
      nextRunAt: null,
      finishedAt: now,
    })
    expect(
      await prisma.crmCadenceRun.count({
        where: { enrollmentId: enrollment.id },
      }),
    ).toBe(2)
  })

  it('should not advance an enrollment that was stopped meanwhile', async () => {
    const { workspace, cadence, ids } = await scenario()
    const enrollment = await seedCrmCadenceEnrollment(ids)
    await CrmCadenceEnrollmentRepository.finish(
      [enrollment.id],
      'REPLIED',
      'REPLIED',
      'WHATSAPP',
      new Date(),
    )

    expect(
      expectOk(
        await CrmCadenceEnrollmentRepository.completeStep({
          enrollmentId: enrollment.id,
          workspaceId: workspace.id,
          cadenceId: cadence.id,
          stepId: cadence.steps[0].id,
          position: 0,
          type: 'TASK',
          status: 'SENT',
          next: { position: 1, runAt: new Date() },
          now: new Date(),
        }),
      ),
    ).toBe(false)
    const row = await prisma.crmCadenceEnrollment.findUniqueOrThrow({
      where: { id: enrollment.id },
    })
    expect(row).toMatchObject({
      status: 'REPLIED',
      repliedVia: 'WHATSAPP',
      stopReason: 'REPLIED',
    })
    expect(await prisma.crmCadenceRun.count()).toBe(0)
  })

  it('should pause, resume, reschedule, complete and list open ids', async () => {
    const { cadence, ids } = await scenario()
    const enrollment = await seedCrmCadenceEnrollment(ids)
    const R = CrmCadenceEnrollmentRepository
    const when = new Date('2026-11-01T12:00:00Z')

    expect(expectOk(await R.openIdsByCadence(cadence.id))).toEqual([
      enrollment.id,
    ])
    expect(expectOk(await R.pause(enrollment.id))).toBe(true)
    expect(expectOk(await R.pause(enrollment.id))).toBe(false)
    expect(expectOk(await R.resume(enrollment.id, when))).toBe(true)
    expect(expectOk(await R.resume(enrollment.id, when))).toBe(false)

    expectOk(
      await R.reschedule(enrollment.id, new Date('2026-11-02T12:00:00Z')),
    )
    let row = await prisma.crmCadenceEnrollment.findUniqueOrThrow({
      where: { id: enrollment.id },
    })
    expect(row.nextRunAt).toEqual(new Date('2026-11-02T12:00:00Z'))

    expect(expectOk(await R.finish([], 'STOPPED', 'MANUAL', null, when))).toBe(
      0,
    )
    expectOk(await R.complete(enrollment.id, when))
    row = await prisma.crmCadenceEnrollment.findUniqueOrThrow({
      where: { id: enrollment.id },
    })
    expect(row).toMatchObject({ status: 'COMPLETED', finishedAt: when })
    expect(expectOk(await R.openIdsByCadence(cadence.id))).toEqual([])
  })
})

describe('CrmCadenceLookupRepository', () => {
  it('should read the e-mail opt-out ignoring case', async () => {
    const { workspace } = await setup()
    await prisma.crmEmailOptOut.create({
      data: {
        workspaceId: workspace.id,
        email: 'ana@empresa.com.br',
        source: 'LINK',
      },
    })
    expect(
      expectOk(
        await CrmCadenceLookupRepository.emailOptedOut(
          workspace.id,
          ' Ana@Empresa.com.br ',
        ),
      ),
    ).toBe(true)
    expect(
      expectOk(
        await CrmCadenceLookupRepository.emailOptedOut(
          workspace.id,
          'outra@empresa.com.br',
        ),
      ),
    ).toBe(false)
  })

  it('should read the WhatsApp opt-out', async () => {
    const { workspace } = await setup()
    await prisma.whatsAppContact.create({
      data: {
        workspaceId: workspace.id,
        waId: '5511999990000',
        broadcastOptedOutAt: new Date(),
      },
    })
    await prisma.whatsAppContact.create({
      data: { workspaceId: workspace.id, waId: '5511988880000' },
    })
    const L = CrmCadenceLookupRepository
    expect(
      expectOk(await L.whatsappOptedOut(workspace.id, '5511999990000')),
    ).toBe(true)
    expect(
      expectOk(await L.whatsappOptedOut(workspace.id, '5511988880000')),
    ).toBe(false)
    expect(
      expectOk(await L.whatsappOptedOut(workspace.id, '5511977770000')),
    ).toBe(false)
  })

  it('should find only live leads of the workspace', async () => {
    const { workspace, user } = await setup()
    const other = await seedWorkspace()
    const live = await seedCrmLead(workspace.id, user.id, {
      emails: ['a@b.com'],
    })
    const gone = await seedCrmLead(workspace.id, user.id, {
      deletedAt: new Date(),
    })
    const foreign = await seedCrmLead(other.id, user.id)

    const found = expectOk(
      await CrmCadenceLookupRepository.findLeads(workspace.id, [
        live.id,
        gone.id,
        foreign.id,
      ]),
    )
    expect(found).toEqual([
      {
        id: live.id,
        name: 'Seed Lead',
        stage: 'RECEIVED',
        emails: ['a@b.com'],
        phones: [],
      },
    ])
  })
})

describe('database failures', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  const when = new Date('2026-10-29T12:00:00Z')
  const R = CrmCadenceEnrollmentRepository
  const C = CrmCadenceRepository
  const L = CrmCadenceLookupRepository

  // Loosely typed on purpose: spying on the generated Prisma delegates one by
  // one makes the whole-project typecheck much heavier.
  type Spyable = Record<string, (...args: unknown[]) => unknown>
  const spy = (target: object, method: string) =>
    vi.spyOn(target as Spyable, method)

  const cases: [string, () => unknown, () => Promise<{ ok: boolean }>][] = [
    ['list', () => spy(prisma.crmCadence, 'findMany'), () => C.list('w')],
    [
      'findById',
      () => spy(prisma.crmCadence, 'findFirst'),
      () => C.findById('c', 'w'),
    ],
    [
      'create',
      () => spy(prisma, '$transaction'),
      () => C.create('w', 'u', fields, [step()]),
    ],
    [
      'update',
      () => spy(prisma, '$transaction'),
      () => C.update('c', 'w', 'u', {}),
    ],
    [
      'archive',
      () => spy(prisma.crmCadence, 'update'),
      () => C.archive('c', 'u'),
    ],
    [
      'enrollmentCounts',
      () => spy(prisma.crmCadenceEnrollment, 'groupBy'),
      () => C.enrollmentCounts(['c']),
    ],
    [
      'runCounts',
      () => spy(prisma.crmCadenceRun, 'groupBy'),
      () => C.runCounts(['c']),
    ],
    [
      'byEmail',
      () => spy(prisma, '$queryRaw'),
      () => C.stopOnReplyEnrollmentIdsByEmail('w', ['a@b.com']),
    ],
    [
      'byPhone',
      () => spy(prisma, '$queryRaw'),
      () => C.stopOnReplyEnrollmentIdsByPhone('w', '5511999990000'),
    ],
    [
      'enrollment list',
      () => spy(prisma.crmCadenceEnrollment, 'findMany'),
      () => R.list('w', {}),
    ],
    [
      'enrollment findById',
      () => spy(prisma.crmCadenceEnrollment, 'findFirst'),
      () => R.findById('e', 'w'),
    ],
    [
      'enroll',
      () => spy(prisma.crmCadenceEnrollment, 'findUnique'),
      () =>
        R.enroll({
          workspaceId: 'w',
          cadenceId: 'c',
          leadId: 'l',
          enrolledById: 'u',
          firstRunAt: when,
        }),
    ],
    [
      'claimDue',
      () => spy(prisma, '$queryRaw'),
      () => R.claimDue(when, when, 1),
    ],
    [
      'reschedule',
      () => spy(prisma.crmCadenceEnrollment, 'updateMany'),
      () => R.reschedule('e', when),
    ],
    [
      'completeStep',
      () => spy(prisma, '$transaction'),
      () =>
        R.completeStep({
          enrollmentId: 'e',
          workspaceId: 'w',
          cadenceId: 'c',
          stepId: 's',
          position: 0,
          type: 'TASK',
          status: 'SENT',
          next: null,
          now: when,
        }),
    ],
    [
      'complete',
      () => spy(prisma.crmCadenceEnrollment, 'updateMany'),
      () => R.complete('e', when),
    ],
    [
      'finish',
      () => spy(prisma.crmCadenceEnrollment, 'updateMany'),
      () => R.finish(['e'], 'STOPPED', 'MANUAL', null, when),
    ],
    [
      'openIdsByCadence',
      () => spy(prisma.crmCadenceEnrollment, 'findMany'),
      () => R.openIdsByCadence('c'),
    ],
    [
      'pause',
      () => spy(prisma.crmCadenceEnrollment, 'updateMany'),
      () => R.pause('e'),
    ],
    [
      'resume',
      () => spy(prisma.crmCadenceEnrollment, 'updateMany'),
      () => R.resume('e', when),
    ],
    [
      'recordRun',
      () => spy(prisma.crmCadenceRun, 'create'),
      () =>
        R.recordRun({
          workspaceId: 'w',
          cadenceId: 'c',
          enrollmentId: 'e',
          position: 0,
          type: 'TASK',
          status: 'SENT',
        }),
    ],
    [
      'emailOptedOut',
      () => spy(prisma.crmEmailOptOut, 'findUnique'),
      () => L.emailOptedOut('w', 'a@b.com'),
    ],
    [
      'whatsappOptedOut',
      () => spy(prisma.whatsAppContact, 'findUnique'),
      () => L.whatsappOptedOut('w', '5511'),
    ],
    [
      'findLeads',
      () => spy(prisma.crmLead, 'findMany'),
      () => L.findLeads('w', ['l']),
    ],
  ]

  it.each(cases)(
    'should return DATABASE_ERROR from %s',
    async (_name, spy, call) => {
      ;(spy() as { mockRejectedValue: (e: Error) => void }).mockRejectedValue(
        new Error('db down'),
      )
      const result = await call()
      expect(result.ok).toBe(false)
      expect(
        (result as unknown as { error: { code: string } }).error.code,
      ).toBe('DATABASE_ERROR')
    },
  )
})
