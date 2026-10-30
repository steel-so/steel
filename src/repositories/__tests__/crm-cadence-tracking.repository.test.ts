import { afterEach, describe, expect, it, vi } from 'vitest'
import { seedCrmLead } from '@/src/__tests__/factories/crm-lead.factory'
import {
  seedCrmCadence,
  seedCrmCadenceEnrollment,
} from '@/src/__tests__/factories/nov-c1-sales-cadences.factory'
import { seedCrmCadenceRun } from '@/src/__tests__/factories/nov-cadence-followups.factory'
import { seedUser } from '@/src/__tests__/factories/user.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import {
  CrmCadenceEnrollmentRepository,
  CrmCadenceRepository,
  CrmCadenceRunRepository,
} from '../crm-cadence.repository'

const R = CrmCadenceEnrollmentRepository
const T = CrmCadenceRunRepository
const when = new Date('2026-10-29T12:00:00Z')

async function scenario() {
  const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
  const cadence = await seedCrmCadence(workspace.id, user.id, undefined, [
    { type: 'EMAIL', subject: 'A', body: 'a' },
    { type: 'EMAIL', subject: 'B', body: 'b' },
  ])
  const lead = await seedCrmLead(workspace.id, user.id)
  const enrollment = await seedCrmCadenceEnrollment({
    workspaceId: workspace.id,
    cadenceId: cadence.id,
    leadId: lead.id,
    enrolledById: user.id,
  })
  const intent = (position = 0) => ({
    workspaceId: workspace.id,
    cadenceId: cadence.id,
    enrollmentId: enrollment.id,
    stepId: cadence.steps[position].id,
    position,
    type: 'EMAIL' as const,
    idempotencyKey: `${enrollment.id}:${position}`,
  })
  return { workspace, user, cadence, lead, enrollment, intent }
}

describe('step intent', () => {
  it('should create one PENDING row per key, however many times it is asked', async () => {
    const { intent } = await scenario()
    const first = expectOk(await R.beginRun(intent()))
    expect(first.existed).toBe(false)
    expect(first.run).toMatchObject({ status: 'PENDING', position: 0 })

    const again = expectOk(await R.beginRun(intent()))
    expect(again.existed).toBe(true)
    expect(again.run.id).toBe(first.run.id)

    const other = expectOk(await R.beginRun(intent(1)))
    expect(other.existed).toBe(false)
    expect(await prisma.crmCadenceRun.count()).toBe(2)
  })

  it('should survive two writers racing for the same key', async () => {
    const { intent } = await scenario()
    const results = await Promise.all([
      R.beginRun(intent()),
      R.beginRun(intent()),
      R.beginRun(intent()),
    ])
    const runs = results.map((result) => expectOk(result))
    expect(new Set(runs.map((item) => item.run.id)).size).toBe(1)
    expect(runs.filter((item) => !item.existed).length).toBeGreaterThanOrEqual(
      1,
    )
    expect(await prisma.crmCadenceRun.count()).toBe(1)
  })

  it('should store the provider id only while the row is PENDING', async () => {
    const { intent } = await scenario()
    const { run } = expectOk(await R.beginRun(intent()))
    expectOk(await R.markRunSent(run.id, 'mail1'))
    expect(
      (await prisma.crmCadenceRun.findUniqueOrThrow({ where: { id: run.id } }))
        .providerMessageId,
    ).toBe('mail1')

    await prisma.crmCadenceRun.update({
      where: { id: run.id },
      data: { status: 'SENT' },
    })
    expectOk(await R.markRunSent(run.id, 'mail2'))
    expect(
      (await prisma.crmCadenceRun.findUniqueOrThrow({ where: { id: run.id } }))
        .providerMessageId,
    ).toBe('mail1')
  })

  it('should discard an intent only when nothing was sent', async () => {
    const { intent } = await scenario()
    const unsent = expectOk(await R.beginRun(intent(0))).run
    const sent = expectOk(await R.beginRun(intent(1))).run
    await R.markRunSent(sent.id, 'mail1')

    expectOk(await R.discardRun(unsent.id))
    expectOk(await R.discardRun(sent.id))
    const left = await prisma.crmCadenceRun.findMany()
    expect(left.map((row) => row.id)).toEqual([sent.id])
  })

  it('should settle the intent row when the step completes, even after a stop', async () => {
    const { workspace, cadence, enrollment, intent } = await scenario()
    const { run } = expectOk(await R.beginRun(intent()))
    await R.markRunSent(run.id, 'mail1')
    const base = {
      enrollmentId: enrollment.id,
      workspaceId: workspace.id,
      cadenceId: cadence.id,
      stepId: cadence.steps[0].id,
      position: 0,
      type: 'EMAIL' as const,
      runId: run.id,
      now: when,
    }

    expect(
      expectOk(
        await R.completeStep({
          ...base,
          status: 'SENT',
          detail: 'ana@x.com',
          next: { position: 1, runAt: when },
        }),
      ),
    ).toBe(true)
    expect(await prisma.crmCadenceRun.count()).toBe(1)
    expect(
      await prisma.crmCadenceRun.findUniqueOrThrow({ where: { id: run.id } }),
    ).toMatchObject({
      status: 'SENT',
      detail: 'ana@x.com',
      providerMessageId: 'mail1',
    })

    // A stop landed meanwhile: the enrollment does not move, the message is still recorded.
    const second = expectOk(await R.beginRun(intent(1))).run
    await R.finish([enrollment.id], 'STOPPED', 'MANUAL', null, when)
    expect(
      expectOk(
        await R.completeStep({
          ...base,
          stepId: cadence.steps[1].id,
          position: 1,
          runId: second.id,
          status: 'SENT',
          providerMessageId: 'mail2',
          next: null,
        }),
      ),
    ).toBe(false)
    expect(
      await prisma.crmCadenceRun.findUniqueOrThrow({
        where: { id: second.id },
      }),
    ).toMatchObject({ status: 'SENT', providerMessageId: 'mail2' })
  })
})

describe('open and click tracking', () => {
  it('should count opens, stamping only the first', async () => {
    const { workspace, cadence, enrollment } = await scenario()
    const run = await seedCrmCadenceRun({
      workspaceId: workspace.id,
      cadenceId: cadence.id,
      enrollmentId: enrollment.id,
      status: 'SENT',
    })
    const first = new Date('2026-10-29T13:00:00Z')
    expectOk(await T.recordOpen(run.id, first))
    expectOk(await T.recordOpen(run.id, new Date('2026-10-29T14:00:00Z')))
    expect(
      await prisma.crmCadenceRun.findUniqueOrThrow({ where: { id: run.id } }),
    ).toMatchObject({ openedAt: first, openCount: 2, clickedAt: null })
  })

  it('should count clicks and fill a missing open', async () => {
    const { workspace, cadence, enrollment } = await scenario()
    const run = await seedCrmCadenceRun({
      workspaceId: workspace.id,
      cadenceId: cadence.id,
      enrollmentId: enrollment.id,
      status: 'SENT',
    })
    const first = new Date('2026-10-29T13:00:00Z')
    expectOk(await T.recordClick(run.id, first))
    expectOk(await T.recordClick(run.id, new Date('2026-10-29T15:00:00Z')))
    expect(
      await prisma.crmCadenceRun.findUniqueOrThrow({ where: { id: run.id } }),
    ).toMatchObject({
      clickedAt: first,
      openedAt: first,
      clickCount: 2,
      openCount: 0,
    })
  })

  it('should load an e-mail run with its cadence setting and enrollment status', async () => {
    const { workspace, cadence, enrollment } = await scenario()
    await prisma.crmCadence.update({
      where: { id: cadence.id },
      data: { stopOnClick: true },
    })
    const run = await seedCrmCadenceRun({
      workspaceId: workspace.id,
      cadenceId: cadence.id,
      enrollmentId: enrollment.id,
    })
    const task = await seedCrmCadenceRun({
      workspaceId: workspace.id,
      cadenceId: cadence.id,
      enrollmentId: enrollment.id,
      type: 'TASK',
      position: 1,
    })

    const found = expectOk(await T.findForTracking(run.id))
    expect(found).toMatchObject({
      id: run.id,
      cadence: { stopOnClick: true },
      enrollment: { status: 'ACTIVE' },
    })
    expect(expectOk(await T.findForTracking(task.id))).toBeNull()
    expect(expectOk(await T.findForTracking('missing'))).toBeNull()
  })

  it('should count distinct opened and clicked e-mails per step', async () => {
    const { workspace, user, cadence, enrollment } = await scenario()
    const ids = { workspaceId: workspace.id, cadenceId: cadence.id }
    const other = await seedCrmCadenceEnrollment({
      ...ids,
      leadId: (await seedCrmLead(workspace.id, user.id)).id,
      enrolledById: user.id,
    })
    const run = (enrollmentId: string, extra = {}) =>
      seedCrmCadenceRun({ ...ids, enrollmentId, status: 'SENT', ...extra })
    await run(enrollment.id, { openedAt: when, openCount: 3 })
    await run(other.id, { openedAt: when, clickedAt: when, clickCount: 2 })
    await run(other.id, { position: 1 })

    expect(expectOk(await CrmCadenceRepository.trackingCounts([]))).toEqual([])
    const counts = expectOk(
      await CrmCadenceRepository.trackingCounts([cadence.id]),
    )
    expect(
      counts
        .sort((a, b) => a.position - b.position)
        .map((row) => [row.position, row.opened, row.clicked]),
    ).toEqual([
      [0, 2, 1],
      [1, 0, 0],
    ])
  })

  it('should split enrollment counts by stop reason', async () => {
    const { workspace, user, cadence } = await scenario()
    await seedCrmCadenceEnrollment({
      workspaceId: workspace.id,
      cadenceId: cadence.id,
      leadId: (await seedCrmLead(workspace.id, user.id)).id,
      enrolledById: user.id,
      overrides: { status: 'STOPPED', stopReason: 'CLICKED' },
    })
    const counts = expectOk(
      await CrmCadenceRepository.enrollmentCounts([cadence.id]),
    )
    expect(counts).toContainEqual({
      cadenceId: cadence.id,
      status: 'STOPPED',
      stopReason: 'CLICKED',
      n: 1,
    })
  })
})

describe('database failures', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  type Spyable = Record<string, (...args: unknown[]) => unknown>
  const spy = (target: object, method: string) =>
    vi.spyOn(target as Spyable, method)

  const intent = {
    workspaceId: 'w',
    cadenceId: 'c',
    enrollmentId: 'e',
    stepId: 's',
    position: 0,
    type: 'EMAIL' as const,
    idempotencyKey: 'e:0',
  }

  it('should return DATABASE_ERROR from beginRun (lookup and lost race)', async () => {
    spy(prisma.crmCadenceRun, 'findUnique').mockRejectedValue(new Error('down'))
    expectErr(await R.beginRun(intent), 'DATABASE_ERROR')
    vi.restoreAllMocks()

    // Create fails and the row is still not there: the original error is reported.
    spy(prisma.crmCadenceRun, 'findUnique').mockResolvedValue(null)
    spy(prisma.crmCadenceRun, 'create').mockRejectedValue(new Error('boom'))
    expectErr(await R.beginRun(intent), 'DATABASE_ERROR')
  })

  it.each([
    [
      'markRunSent',
      () => spy(prisma.crmCadenceRun, 'updateMany'),
      () => R.markRunSent('r', 'p'),
    ],
    [
      'discardRun',
      () => spy(prisma.crmCadenceRun, 'deleteMany'),
      () => R.discardRun('r'),
    ],
    [
      'findForTracking',
      () => spy(prisma.crmCadenceRun, 'findFirst'),
      () => T.findForTracking('r'),
    ],
    [
      'recordOpen',
      () => spy(prisma, '$transaction'),
      () => T.recordOpen('r', when),
    ],
    [
      'recordClick',
      () => spy(prisma, '$transaction'),
      () => T.recordClick('r', when),
    ],
    [
      'trackingCounts',
      () => spy(prisma.crmCadenceRun, 'groupBy'),
      () => CrmCadenceRepository.trackingCounts(['c']),
    ],
  ])('should return DATABASE_ERROR from %s', async (_name, arm, call) => {
    ;(arm() as { mockRejectedValue: (e: Error) => void }).mockRejectedValue(
      new Error('db down'),
    )
    expectErr(await call(), 'DATABASE_ERROR')
  })
})
