import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { databaseError } from '@/src/errors'
import { err, ok } from '@/src/lib/result'
import type { CrmWorkflowDefinition } from '@/src/schemas/crm-workflow.schema'

const mocks = vi.hoisted(() => ({
  crmTask: { create: vi.fn() },
  enqueue: vi.fn(),
  loggerMock: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('@/lib/axiom/logger', () => ({ logger: mocks.loggerMock }))
vi.mock('@/src/lib/mail/send')
vi.mock('@/src/lib/prisma', () => ({
  prisma: {
    crmTask: mocks.crmTask,
    crmCompany: {},
    crmPerson: {},
    crmOpportunity: {},
    crmNote: {},
  },
}))
vi.mock('@/src/lib/queue/crm-workflow-delay', () => ({
  enqueueCrmWorkflowResume: mocks.enqueue,
}))
vi.mock('@/src/repositories/crm-workflow.repository', () => ({
  CrmWorkflowRunRepository: {
    setStatus: vi.fn(),
    createStep: vi.fn(),
    updateStep: vi.fn(),
    pause: vi.fn(),
    clearPause: vi.fn(),
    findById: vi.fn(),
    findRunWorkflow: vi.fn(),
  },
  CrmWorkflowVersionRepository: { findById: vi.fn() },
}))
vi.mock('@/src/services/crm-notifications', () => ({
  notifyCrmWorkflowFailed: vi.fn().mockResolvedValue(1),
  notifyCrmWorkflowWaiting: vi.fn().mockResolvedValue(1),
}))

import { CrmWorkflowDelayJob } from '@/src/lib/queue/jobs'
import {
  processCrmWorkflowDelay,
  runCrmWorkflowDelayJob,
} from '@/src/lib/queue/processors/crm-workflow-delay'
import {
  CrmWorkflowRunRepository,
  CrmWorkflowVersionRepository,
} from '@/src/repositories/crm-workflow.repository'
import {
  resumeCrmWorkflow,
  runCrmWorkflow,
} from '@/src/services/crm-workflow-runner'

const runRepo = vi.mocked(CrmWorkflowRunRepository)
const versionRepo = vi.mocked(CrmWorkflowVersionRepository)

const T0 = new Date('2026-10-09T12:00:00.000Z')
const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

type Edge = { source: string; target: string }

function definition(
  delay: { amount: number; unit: string },
  extra: { nodes?: { id: string; title: string }[]; edges?: Edge[] } = {},
): CrmWorkflowDefinition {
  const tasks = extra.nodes ?? [{ id: 'after', title: 'depois do atraso' }]
  return {
    trigger: {
      id: 'trigger',
      position: { x: 0, y: 0 },
      data: { type: 'launch-manually', inputs: [] },
    },
    nodes: [
      {
        id: 'd1',
        position: { x: 0, y: 0 },
        data: { type: 'delay', ...delay },
      },
      ...tasks.map((t) => ({
        id: t.id,
        position: { x: 0, y: 0 },
        data: {
          type: 'create-record',
          entity: 'task',
          fields: { title: t.title },
        },
      })),
    ],
    edges: (
      extra.edges ?? [
        { source: 'trigger', target: 'd1' },
        { source: 'd1', target: 'after' },
      ]
    ).map((e, i) => ({ id: `e${i}`, ...e })),
  } as unknown as CrmWorkflowDefinition
}

function params(def: CrmWorkflowDefinition, now: () => Date = () => T0) {
  return {
    runId: 'run-1',
    workspaceId: 'ws-1',
    actingUserId: 'user-1',
    definition: def,
    triggerType: 'webhook' as const,
    triggerPayload: { pedido: 'PV-1' },
    testMode: false,
    now,
  }
}

function job(data: unknown, name: string = CrmWorkflowDelayJob.Resume) {
  return { id: 'job-1', name, data } as unknown as Job
}

/** Rebuilds the persisted run from what the runner wrote when pausing. */
function persistedRun(overrides: Record<string, unknown> = {}) {
  const state = runRepo.pause.mock.calls.at(-1)?.[1].state
  const delayUpdate = runRepo.updateStep.mock.calls.find(
    ([, data]) => data.status === 'RUNNING',
  )
  return {
    id: 'run-1',
    workflowId: 'wf-1',
    versionId: 'v-1',
    status: 'WAITING',
    waitingStepId: 'step-d1',
    state,
    triggerPayload: { pedido: 'PV-1' },
    steps: [
      {
        id: 'step-d1',
        nodeId: 'd1',
        nodeType: 'delay',
        output: delayUpdate?.[1].output ?? null,
      },
    ],
    ...overrides,
  }
}

function statuses() {
  return runRepo.setStatus.mock.calls.map((c) => c[1])
}

let stepSeq = 0

beforeEach(() => {
  vi.clearAllMocks()
  stepSeq = 0
  runRepo.setStatus.mockResolvedValue(ok({} as never))
  runRepo.createStep.mockImplementation(async (data) =>
    ok({ id: stepSeq++ === 0 ? 'step-d1' : `step-${data.nodeId}` } as never),
  )
  runRepo.updateStep.mockResolvedValue(ok({} as never))
  runRepo.pause.mockResolvedValue(ok({} as never))
  runRepo.clearPause.mockResolvedValue(ok({} as never))
  runRepo.findRunWorkflow.mockResolvedValue(ok(null))
  mocks.enqueue.mockResolvedValue('job-1')
  mocks.crmTask.create.mockResolvedValue({ id: 'task-1' })
})

describe('CRM workflow delay — real pause with an injected clock', () => {
  it.each([
    ['5 minutes', { amount: 5, unit: 'minutes' }, 5 * MINUTE],
    ['1 hour', { amount: 1, unit: 'hours' }, HOUR],
    ['1 day', { amount: 1, unit: 'days' }, DAY],
  ])(
    'should pause for %s and resume only when it is over',
    async (_label, delay, ms) => {
      const def = definition(delay)
      await runCrmWorkflow(params(def))

      // Paused: nothing after the delay ran, a delayed job was scheduled.
      const resumeAt = new Date(T0.getTime() + ms).toISOString()
      expect(mocks.crmTask.create).not.toHaveBeenCalled()
      expect(statuses()).toEqual(['RUNNING', 'WAITING'])
      expect(mocks.enqueue).toHaveBeenCalledWith(
        { runId: 'run-1', stepId: 'step-d1' },
        ms,
      )
      expect(runRepo.updateStep).toHaveBeenCalledWith('step-d1', {
        status: 'RUNNING',
        output: { delayMs: ms, resumeAt },
        startedAt: expect.any(Date),
      })
      expect(runRepo.pause).toHaveBeenCalledWith('run-1', {
        state: expect.objectContaining({
          steps: { d1: { output: { delayMs: ms, resumeAt } } },
          $resume: {
            queue: [],
            visited: ['d1'],
            workspaceId: 'ws-1',
            actingUserId: 'user-1',
            triggerType: 'webhook',
          },
        }),
        waitingStepId: 'step-d1',
      })

      runRepo.findById.mockResolvedValue(ok(persistedRun() as never))
      versionRepo.findById.mockResolvedValue(
        ok({ id: 'v-1', definition: def } as never),
      )
      vi.clearAllMocks()
      runRepo.setStatus.mockResolvedValue(ok({} as never))
      runRepo.createStep.mockResolvedValue(ok({ id: 'step-after' } as never))
      runRepo.updateStep.mockResolvedValue(ok({} as never))
      runRepo.clearPause.mockResolvedValue(ok({} as never))
      mocks.crmTask.create.mockResolvedValue({ id: 'task-1' })

      // One millisecond early (worker clock skew): scheduled again.
      const early = new Date(T0.getTime() + ms - 1)
      expect(
        await runCrmWorkflowDelayJob(
          job({ runId: 'run-1', stepId: 'step-d1' }),
          () => early,
        ),
      ).toBe('rescheduled')
      expect(mocks.enqueue).toHaveBeenCalledWith(
        { runId: 'run-1', stepId: 'step-d1' },
        1,
      )
      expect(mocks.crmTask.create).not.toHaveBeenCalled()

      // Delay over: the run continues from the step after the delay.
      const due = new Date(T0.getTime() + ms)
      expect(
        await runCrmWorkflowDelayJob(
          job({ runId: 'run-1', stepId: 'step-d1' }),
          () => due,
        ),
      ).toBe('resumed')
      expect(runRepo.updateStep).toHaveBeenCalledWith('step-d1', {
        status: 'COMPLETED',
        output: { delayMs: ms, resumeAt, resumedAt: due.toISOString() },
        finishedAt: due,
      })
      expect(runRepo.clearPause).toHaveBeenCalledWith('run-1')
      expect(mocks.crmTask.create).toHaveBeenCalledTimes(1)
      expect(mocks.crmTask.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          title: 'depois do atraso',
          workspaceId: 'ws-1',
          createdById: 'user-1',
        }),
      })
      expect(statuses()).toEqual(['RUNNING', 'COMPLETED'])
      expect(mocks.loggerMock.info).toHaveBeenCalledWith(
        'queue.crm_workflow_delay.processed',
        expect.objectContaining({ outcome: 'resumed' }),
      )
    },
  )

  it('should keep a parallel branch queued while the delay waits', async () => {
    const def = definition(
      { amount: 1, unit: 'hours' },
      {
        nodes: [
          { id: 'after', title: 'depois' },
          { id: 'side', title: 'ramo paralelo' },
        ],
        edges: [
          { source: 'trigger', target: 'd1' },
          { source: 'trigger', target: 'side' },
          { source: 'd1', target: 'after' },
        ],
      },
    )
    await runCrmWorkflow(params(def))
    expect(mocks.crmTask.create).not.toHaveBeenCalled()
    expect(runRepo.pause.mock.calls[0][1].state).toMatchObject({
      $resume: { queue: ['side'], visited: ['d1'] },
    })

    runRepo.findById.mockResolvedValue(ok(persistedRun() as never))
    versionRepo.findById.mockResolvedValue(
      ok({ id: 'v-1', definition: def } as never),
    )
    await runCrmWorkflowDelayJob(
      job({ runId: 'run-1', stepId: 'step-d1' }),
      () => new Date(T0.getTime() + HOUR),
    )
    const titles = mocks.crmTask.create.mock.calls.map(
      ([arg]) => (arg as { data: { title: string } }).data.title,
    )
    expect(titles).toEqual(['depois', 'ramo paralelo'])
  })

  it('should fail the run when the resume cannot be scheduled', async () => {
    mocks.enqueue.mockRejectedValue(new Error('redis down'))
    await runCrmWorkflow(params(definition({ amount: 5, unit: 'minutes' })))

    expect(runRepo.clearPause).toHaveBeenCalledWith('run-1')
    expect(runRepo.updateStep).toHaveBeenCalledWith(
      'step-d1',
      expect.objectContaining({
        status: 'FAILED',
        error: 'delay: redis down',
      }),
    )
    expect(statuses().at(-1)).toBe('FAILED')
    expect(mocks.crmTask.create).not.toHaveBeenCalled()
  })

  it('should report a non-Error scheduling failure too', async () => {
    mocks.enqueue.mockRejectedValue('timeout')
    await runCrmWorkflow(params(definition({ amount: 5, unit: 'minutes' })))
    expect(runRepo.updateStep).toHaveBeenCalledWith(
      'step-d1',
      expect.objectContaining({ status: 'FAILED', error: 'delay: timeout' }),
    )
  })

  it('should fail the run when the delay step row could not be created', async () => {
    runRepo.createStep.mockResolvedValue(err(databaseError('x')))
    await runCrmWorkflow(params(definition({ amount: 5, unit: 'minutes' })))
    expect(mocks.enqueue).not.toHaveBeenCalled()
    expect(statuses().at(-1)).toBe('FAILED')
  })

  it('should use the system clock by default', async () => {
    const before = Date.now()
    const { now: _drop, ...rest } = params(
      definition({ amount: 5, unit: 'minutes' }),
    )
    await runCrmWorkflow(rest)
    const output = runRepo.updateStep.mock.calls[0][1].output as {
      resumeAt: string
    }
    expect(Date.parse(output.resumeAt)).toBeGreaterThanOrEqual(
      before + 5 * MINUTE,
    )
  })
})

describe('resumeCrmWorkflowAfterDelay() guards', () => {
  const payload = { runId: 'run-1', stepId: 'step-d1' }
  const at = () => new Date(T0.getTime() + DAY)
  const waiting = {
    id: 'run-1',
    versionId: 'v-1',
    status: 'WAITING',
    waitingStepId: 'step-d1',
    triggerPayload: {},
    state: {
      trigger: {},
      steps: {},
      $resume: {
        queue: [],
        visited: ['d1'],
        workspaceId: 'ws-1',
        actingUserId: 'user-1',
        triggerType: 'webhook',
      },
    },
    steps: [
      {
        id: 'step-d1',
        nodeId: 'd1',
        nodeType: 'delay',
        output: { delayMs: DAY, resumeAt: T0.toISOString() },
      },
    ],
  }

  it.each([
    ['the run is gone', null],
    ['the run is no longer waiting', { ...waiting, status: 'CANCELED' }],
    ['another step is waiting', { ...waiting, waitingStepId: 'other' }],
    ['the step is missing', { ...waiting, steps: [] }],
    [
      'the waiting step is not a delay',
      {
        ...waiting,
        steps: [{ ...waiting.steps[0], nodeType: 'form' }],
      },
    ],
    ['the state was cleared', { ...waiting, state: null }],
  ])('should leave the run alone when %s', async (_label, run) => {
    runRepo.findById.mockResolvedValue(ok(run as never))
    expect(await runCrmWorkflowDelayJob(job(payload), at)).toBe('stale')
    expect(runRepo.setStatus).not.toHaveBeenCalled()
    expect(mocks.enqueue).not.toHaveBeenCalled()
  })

  it('should throw on database errors so BullMQ retries', async () => {
    runRepo.findById.mockResolvedValue(err(databaseError('db down')))
    await expect(runCrmWorkflowDelayJob(job(payload), at)).rejects.toThrow(
      'crm workflow delay: db down',
    )

    runRepo.findById.mockResolvedValue(ok(waiting as never))
    versionRepo.findById.mockResolvedValue(err(databaseError('db down')))
    await expect(runCrmWorkflowDelayJob(job(payload), at)).rejects.toThrow(
      'crm workflow delay: db down',
    )
  })

  it('should resume a step without a stored resume time right away', async () => {
    runRepo.findById.mockResolvedValue(
      ok({
        ...waiting,
        steps: [{ ...waiting.steps[0], output: null }],
      } as never),
    )
    versionRepo.findById.mockResolvedValue(
      ok({
        id: 'v-1',
        definition: definition({ amount: 1, unit: 'days' }),
      } as never),
    )
    runRepo.createStep.mockResolvedValue(ok({ id: 'step-after' } as never))
    expect(await runCrmWorkflowDelayJob(job(payload), at)).toBe('resumed')
    expect(mocks.crmTask.create).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['the version was deleted', waiting, null],
    [
      'the state has no resume info',
      { ...waiting, state: { trigger: {}, steps: {} } },
      { id: 'v-1', definition: definition({ amount: 1, unit: 'days' }) },
    ],
  ])('should fail the run when %s', async (_label, run, version) => {
    runRepo.findById.mockResolvedValue(ok(run as never))
    versionRepo.findById.mockResolvedValue(ok(version as never))
    expect(await runCrmWorkflowDelayJob(job(payload), at)).toBe('failed')
    expect(runRepo.updateStep).toHaveBeenCalledWith(
      'step-d1',
      expect.objectContaining({ status: 'FAILED' }),
    )
    expect(runRepo.clearPause).toHaveBeenCalledWith('run-1')
    expect(statuses()).toEqual(['FAILED'])
  })
})

describe('crm-workflow-delay processor', () => {
  it('should reject unknown job names', async () => {
    await expect(
      runCrmWorkflowDelayJob(job({}, 'nope'), () => T0),
    ).rejects.toThrow('Unknown crm-workflow-delay job: nope (id=job-1)')
    await expect(
      runCrmWorkflowDelayJob(
        { name: 'nope', data: {} } as unknown as Job,
        () => T0,
      ),
    ).rejects.toThrow('(id=unknown)')
  })

  it('should run with the real clock when called by BullMQ', async () => {
    const future = new Date(Date.now() + DAY).toISOString()
    runRepo.findById.mockResolvedValue(
      ok({
        id: 'run-1',
        status: 'WAITING',
        waitingStepId: 'step-d1',
        state: { steps: {} },
        steps: [
          {
            id: 'step-d1',
            nodeId: 'd1',
            nodeType: 'delay',
            output: { delayMs: DAY, resumeAt: future },
          },
        ],
      } as never),
    )
    expect(
      await processCrmWorkflowDelay(job({ runId: 'run-1', stepId: 'step-d1' })),
    ).toBe('rescheduled')
    const remaining = mocks.enqueue.mock.calls[0][1] as number
    expect(remaining).toBeGreaterThan(DAY - MINUTE)
    expect(remaining).toBeLessThanOrEqual(DAY)
  })
})

describe('resumeCrmWorkflow() (form) with stored resume info', () => {
  it('should also run the branches that were queued when the form paused', async () => {
    const def = {
      trigger: {
        id: 'trigger',
        position: { x: 0, y: 0 },
        data: { type: 'launch-manually', inputs: [] },
      },
      nodes: [
        {
          id: 'form1',
          position: { x: 0, y: 0 },
          data: { type: 'form', title: 'F', fields: [] },
        },
        {
          id: 'side',
          position: { x: 0, y: 0 },
          data: {
            type: 'create-record',
            entity: 'task',
            fields: { title: 'ramo {{steps.form1.output.ok}}' },
          },
        },
      ],
      edges: [],
    } as unknown as CrmWorkflowDefinition
    runRepo.createStep.mockResolvedValue(ok({ id: 'step-side' } as never))

    await resumeCrmWorkflow({
      runId: 'run-1',
      workspaceId: 'ws-1',
      actingUserId: 'user-1',
      definition: def,
      triggerType: 'launch-manually',
      triggerPayload: {},
      waitingStepId: 'step-form',
      pausedNodeId: 'form1',
      scope: {
        trigger: {},
        steps: {},
        $resume: {
          queue: ['side', 'gone'],
          visited: ['form1'],
          workspaceId: 'ws-1',
          actingUserId: 'user-1',
          triggerType: 'launch-manually',
        },
      },
      submission: { ok: 'sim' },
      outputAlias: 'form1',
    })

    expect(mocks.crmTask.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ title: 'ramo sim' }),
    })
    expect(statuses()).toEqual(['RUNNING', 'COMPLETED'])
  })
})
