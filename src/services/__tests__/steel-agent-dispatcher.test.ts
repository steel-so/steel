import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createFakeSteelAgent,
  createFakeSteelAgentRun,
} from '@/src/__tests__/factories/steel-agent.factory'
import { createFakeAiPendingAction } from '@/src/__tests__/factories/steel-ai.factory'
import { databaseError } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/repositories/steel-agent.repository')
vi.mock('@/src/repositories/ai-pending-action.repository')
vi.mock('@/src/lib/steel-agents/enqueue')

import { enqueueSteelAgentRun } from '@/src/lib/steel-agents/enqueue'
import { runInSteelAgentContext } from '@/src/lib/steel-agents/run-context'
import { AiPendingActionRepository } from '@/src/repositories/ai-pending-action.repository'
import {
  SteelAgentRepository,
  SteelAgentRunRepository,
  SteelAgentRunStepRepository,
} from '@/src/repositories/steel-agent.repository'
import {
  dispatchSteelAgentDirect,
  dispatchSteelAgentEvent,
  runSteelAgentTick,
} from '../steel-agent-dispatcher'

const agents = vi.mocked(SteelAgentRepository)
const runs = vi.mocked(SteelAgentRunRepository)
const steps = vi.mocked(SteelAgentRunStepRepository)
const pending = vi.mocked(AiPendingActionRepository)
const enqueue = vi.mocked(enqueueSteelAgentRun)

// 09:00:20 in São Paulo (UTC-3) on a Tuesday.
const NOW = new Date('2026-10-06T12:00:20.000Z')

const scheduled = (
  overrides: Parameters<typeof createFakeSteelAgent>[0] = {},
) =>
  createFakeSteelAgent({
    id: 'agent1',
    workspaceId: 'ws1',
    triggerType: 'SCHEDULE',
    cron: '0 9 * * *',
    timezone: 'America/Sao_Paulo',
    ...overrides,
  })

beforeEach(() => {
  runs.listOverdueActions.mockResolvedValue(ok([]))
  agents.listScheduled.mockResolvedValue(ok([scheduled()]))
  agents.claimOccurrence.mockResolvedValue(ok(true))
  agents.listByEvent.mockResolvedValue(ok([]))
  runs.create.mockImplementation(async (data) =>
    ok(
      createFakeSteelAgentRun({
        id: `run_${data.agentId}`,
        ...data,
        triggerPayload: (data.triggerPayload ?? null) as never,
      }),
    ),
  )
  enqueue.mockResolvedValue(ok(true))
  steps.updateByPendingAction.mockResolvedValue(ok(1))
})

describe('runSteelAgentTick — schedule', () => {
  it('should dispatch a due occurrence once (claim + run + enqueue)', async () => {
    const result = await runSteelAgentTick(NOW)
    expect(result).toEqual({
      considered: 1,
      dispatched: 1,
      expired: 0,
      errors: 0,
    })
    const occurrence = new Date('2026-10-06T12:00:00.000Z')
    expect(agents.claimOccurrence).toHaveBeenCalledWith(
      'agent1',
      occurrence,
      new Date('2026-10-07T12:00:00.000Z'),
    )
    expect(runs.create).toHaveBeenCalledWith({
      workspaceId: 'ws1',
      agentId: 'agent1',
      triggerType: 'SCHEDULE',
      triggerPayload: { scheduledFor: occurrence.toISOString() },
    })
    expect(enqueue).toHaveBeenCalledWith('run_agent1')
  })

  it('should dedupe by lastRunAt and by the claim', async () => {
    agents.listScheduled.mockResolvedValue(
      ok([scheduled({ lastRunAt: new Date('2026-10-06T12:00:00.000Z') })]),
    )
    expect((await runSteelAgentTick(NOW)).dispatched).toBe(0)
    expect(agents.claimOccurrence).not.toHaveBeenCalled()

    agents.listScheduled.mockResolvedValue(ok([scheduled()]))
    agents.claimOccurrence.mockResolvedValue(ok(false))
    expect((await runSteelAgentTick(NOW)).dispatched).toBe(0)
    expect(runs.create).not.toHaveBeenCalled()
  })

  it('should ignore stale occurrences (worker was down)', async () => {
    const late = new Date('2026-10-06T12:06:00.000Z')
    expect((await runSteelAgentTick(late)).dispatched).toBe(0)
  })

  it('should dispatch when lastRunAt is an older occurrence', async () => {
    agents.listScheduled.mockResolvedValue(
      ok([scheduled({ lastRunAt: new Date('2026-10-05T12:00:00.000Z') })]),
    )
    expect((await runSteelAgentTick(NOW)).dispatched).toBe(1)
  })

  it('should skip invalid cron expressions', async () => {
    agents.listScheduled.mockResolvedValue(ok([scheduled({ cron: 'bad' })]))
    expect(await runSteelAgentTick(NOW)).toEqual(
      expect.objectContaining({ considered: 1, dispatched: 0, errors: 0 }),
    )
  })

  it('should count errors without stopping the tick', async () => {
    agents.listScheduled.mockResolvedValue(
      ok([
        scheduled({ id: 'a' }),
        scheduled({ id: 'b' }),
        scheduled({ id: 'c' }),
      ]),
    )
    agents.claimOccurrence
      .mockResolvedValueOnce(err(databaseError('x')))
      .mockResolvedValue(ok(true))
    runs.create
      .mockResolvedValueOnce(err(databaseError('x')))
      .mockResolvedValue(ok(createFakeSteelAgentRun({ id: 'r' })))
    enqueue.mockResolvedValue(err(databaseError('redis')))
    expect(await runSteelAgentTick(NOW)).toEqual({
      considered: 3,
      dispatched: 0,
      expired: 0,
      errors: 3,
    })
  })

  it('should report a listing failure', async () => {
    agents.listScheduled.mockResolvedValue(err(databaseError('x')))
    expect((await runSteelAgentTick(NOW)).errors).toBe(1)
  })

  it('should use the current time by default', async () => {
    agents.listScheduled.mockResolvedValue(ok([]))
    expect(await runSteelAgentTick()).toEqual({
      considered: 0,
      dispatched: 0,
      expired: 0,
      errors: 0,
    })
  })
})

describe('runSteelAgentTick — approval expiry', () => {
  it('should expire overdue approvals and resume each run once', async () => {
    const a1 = createFakeAiPendingAction({ id: 'a1', agentRunId: 'run1' })
    const a2 = createFakeAiPendingAction({ id: 'a2', agentRunId: 'run1' })
    const a3 = createFakeAiPendingAction({ id: 'a3', agentRunId: null })
    runs.listOverdueActions.mockResolvedValue(ok([a1, a2, a3]))
    pending.transitionFromPending.mockResolvedValue(ok(a1))
    agents.listScheduled.mockResolvedValue(ok([]))

    const result = await runSteelAgentTick(NOW)
    expect(result.expired).toBe(3)
    expect(steps.updateByPendingAction).toHaveBeenCalledWith('a1', {
      status: 'EXPIRED',
    })
    expect(enqueue).toHaveBeenCalledTimes(1)
    expect(enqueue).toHaveBeenCalledWith('run1')
  })

  it('should skip actions decided meanwhile and count failures', async () => {
    runs.listOverdueActions.mockResolvedValue(
      ok([
        createFakeAiPendingAction({ id: 'a1', agentRunId: 'run1' }),
        createFakeAiPendingAction({ id: 'a2', agentRunId: 'run2' }),
        createFakeAiPendingAction({ id: 'a3', agentRunId: 'run3' }),
      ]),
    )
    pending.transitionFromPending
      .mockResolvedValueOnce(ok(null))
      .mockResolvedValueOnce(err(databaseError('x')))
      .mockResolvedValueOnce(ok(createFakeAiPendingAction()))
    enqueue.mockResolvedValue(err(databaseError('redis')))
    agents.listScheduled.mockResolvedValue(ok([]))

    const result = await runSteelAgentTick(NOW)
    expect(result.expired).toBe(1)
    expect(result.errors).toBe(2)
  })

  it('should report a failure listing overdue approvals', async () => {
    runs.listOverdueActions.mockResolvedValue(err(databaseError('x')))
    agents.listScheduled.mockResolvedValue(ok([]))
    expect((await runSteelAgentTick(NOW)).errors).toBe(1)
  })
})

describe('dispatchSteelAgentEvent', () => {
  it('should create and enqueue a run per listening agent', async () => {
    agents.listByEvent.mockResolvedValue(
      ok([
        createFakeSteelAgent({ id: 'a1' }),
        createFakeSteelAgent({ id: 'a2' }),
      ]),
    )
    runs.create
      .mockResolvedValueOnce(ok(createFakeSteelAgentRun({ id: 'r1' })))
      .mockResolvedValueOnce(err(databaseError('x')))

    const count = await dispatchSteelAgentEvent('ws1', 'sd.ticket.created', {
      ticketId: 't1',
    })
    expect(count).toBe(1)
    expect(agents.listByEvent).toHaveBeenCalledWith('ws1', 'sd.ticket.created')
    expect(runs.create).toHaveBeenCalledWith({
      workspaceId: 'ws1',
      agentId: 'a1',
      triggerType: 'EVENT',
      triggerPayload: { event: 'sd.ticket.created', ticketId: 't1' },
    })
    expect(enqueue).toHaveBeenCalledWith('r1')
  })

  it('should not count runs that could not be enqueued', async () => {
    agents.listByEvent.mockResolvedValue(ok([createFakeSteelAgent()]))
    enqueue.mockResolvedValue(err(databaseError('redis')))
    expect(await dispatchSteelAgentEvent('ws1', 'crm.lead.created', {})).toBe(0)
  })

  it('should ignore events caused by an agent write (loop guard)', async () => {
    const count = await runInSteelAgentContext(
      { agentId: 'a1', runId: 'r1' },
      () => dispatchSteelAgentEvent('ws1', 'sd.ticket.created', {}),
    )
    expect(count).toBe(0)
    expect(agents.listByEvent).not.toHaveBeenCalled()
  })

  it('should never throw', async () => {
    agents.listByEvent.mockResolvedValue(err(databaseError('x')))
    expect(await dispatchSteelAgentEvent('ws1', 'zap.ai.handoff', {})).toBe(0)

    agents.listByEvent.mockRejectedValue(new Error('boom'))
    expect(await dispatchSteelAgentEvent('ws1', 'zap.ai.handoff', {})).toBe(0)

    agents.listByEvent.mockRejectedValue('boom')
    expect(
      await dispatchSteelAgentEvent('ws1', 'zap.conversation.assigned', {}),
    ).toBe(0)
  })
})

describe('dispatchSteelAgentDirect', () => {
  beforeEach(() => {
    agents.listEnabledByIds.mockResolvedValue(
      ok([createFakeSteelAgent({ id: 'a1', triggerType: 'MANUAL' })]),
    )
  })

  it('should queue a run for the targeted agent whatever its trigger type', async () => {
    const queued = await dispatchSteelAgentDirect(
      'ws1',
      'a1',
      'sd.ticket.agent_assigned',
      { ticketId: 't1' },
      'u1',
    )
    expect(queued).toBe(true)
    expect(agents.listEnabledByIds).toHaveBeenCalledWith('ws1', ['a1'])
    expect(runs.create).toHaveBeenCalledWith({
      workspaceId: 'ws1',
      agentId: 'a1',
      triggerType: 'EVENT',
      startedById: 'u1',
      triggerPayload: { event: 'sd.ticket.agent_assigned', ticketId: 't1' },
    })
    expect(enqueue).toHaveBeenCalledWith('run_a1')
  })

  it('should skip paused or foreign agents', async () => {
    agents.listEnabledByIds.mockResolvedValue(ok([]))
    expect(
      await dispatchSteelAgentDirect(
        'ws1',
        'a1',
        'crm.lead.agent_assigned',
        {},
      ),
    ).toBe(false)
    expect(runs.create).not.toHaveBeenCalled()

    agents.listEnabledByIds.mockResolvedValue(err(databaseError('x')))
    expect(
      await dispatchSteelAgentDirect(
        'ws1',
        'a1',
        'crm.lead.agent_assigned',
        {},
      ),
    ).toBe(false)
  })

  it('should ignore hand-offs caused by an agent write (loop guard)', async () => {
    const queued = await runInSteelAgentContext(
      { agentId: 'a2', runId: 'r2' },
      () =>
        dispatchSteelAgentDirect('ws1', 'a1', 'crm.note.agent_mentioned', {}),
    )
    expect(queued).toBe(false)
    expect(agents.listEnabledByIds).not.toHaveBeenCalled()
  })

  it('should report a run that could not be created or enqueued', async () => {
    runs.create.mockResolvedValueOnce(err(databaseError('x')))
    expect(
      await dispatchSteelAgentDirect(
        'ws1',
        'a1',
        'sd.ticket.agent_mentioned',
        {},
      ),
    ).toBe(false)
    enqueue.mockResolvedValueOnce(err(databaseError('redis')))
    expect(
      await dispatchSteelAgentDirect(
        'ws1',
        'a1',
        'sd.ticket.agent_mentioned',
        {},
      ),
    ).toBe(false)
  })

  it('should never throw', async () => {
    agents.listEnabledByIds.mockRejectedValue(new Error('boom'))
    expect(
      await dispatchSteelAgentDirect(
        'ws1',
        'a1',
        'sd.ticket.agent_mentioned',
        {},
      ),
    ).toBe(false)
    agents.listEnabledByIds.mockRejectedValue('boom')
    expect(
      await dispatchSteelAgentDirect(
        'ws1',
        'a1',
        'sd.ticket.agent_mentioned',
        {},
      ),
    ).toBe(false)
  })
})
