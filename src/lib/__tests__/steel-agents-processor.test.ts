import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { databaseError } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/services/steel-agent-dispatcher', () => ({
  runSteelAgentTick: vi.fn(),
}))
vi.mock('@/src/services/steel-agent-runner', () => ({
  executeSteelAgentRun: vi.fn(),
}))
vi.mock('@/src/services/steel-agent-simulation-runner', () => ({
  executeSteelAgentSimulation: vi.fn(),
}))
vi.mock('@/src/lib/queue/queues', () => ({
  getSteelAgentsQueue: vi.fn(),
}))

import { QueueName, SteelAgentsJob } from '@/src/lib/queue/jobs'
import { processSteelAgents } from '@/src/lib/queue/processors/steel-agents'
import { getSteelAgentsQueue } from '@/src/lib/queue/queues'
import {
  enqueueSteelAgentRun,
  enqueueSteelAgentSimulation,
} from '@/src/lib/steel-agents/enqueue'
import { runSteelAgentTick } from '@/src/services/steel-agent-dispatcher'
import { executeSteelAgentRun } from '@/src/services/steel-agent-runner'
import { executeSteelAgentSimulation } from '@/src/services/steel-agent-simulation-runner'

const job = (name: string, data: unknown = {}) =>
  ({ id: 'j1', name, data }) as Job

beforeEach(() => {
  vi.mocked(runSteelAgentTick).mockResolvedValue({
    considered: 2,
    dispatched: 1,
    expired: 0,
    errors: 0,
  })
})

describe('processSteelAgents', () => {
  it('should name the queue', () => {
    expect(QueueName.SteelAgents).toBe('steel-agents')
  })

  it('should run the tick', async () => {
    expect(await processSteelAgents(job(SteelAgentsJob.Tick))).toEqual({
      considered: 2,
      dispatched: 1,
      expired: 0,
      errors: 0,
    })
  })

  it('should execute a run and return its outcome', async () => {
    vi.mocked(executeSteelAgentRun).mockResolvedValue(ok('succeeded'))
    expect(
      await processSteelAgents(job(SteelAgentsJob.Run, { runId: 'r1' })),
    ).toBe('succeeded')
    expect(executeSteelAgentRun).toHaveBeenCalledWith('r1')
  })

  it('should fail the job when the run cannot be loaded', async () => {
    vi.mocked(executeSteelAgentRun).mockResolvedValue(err(databaseError('x')))
    await expect(
      processSteelAgents(job(SteelAgentsJob.Run, { runId: 'r1' })),
    ).rejects.toThrow('steel-agents run r1 failed: DATABASE_ERROR')
  })

  it('should execute a persona simulation and return its outcome', async () => {
    vi.mocked(executeSteelAgentSimulation).mockResolvedValue(ok('completed'))
    expect(
      await processSteelAgents(
        job(SteelAgentsJob.Simulate, { simulationId: 's1' }),
      ),
    ).toBe('completed')
    expect(executeSteelAgentSimulation).toHaveBeenCalledWith('s1')
  })

  it('should fail the job when the simulation cannot be loaded', async () => {
    vi.mocked(executeSteelAgentSimulation).mockResolvedValue(
      err(databaseError('x')),
    )
    await expect(
      processSteelAgents(job(SteelAgentsJob.Simulate, { simulationId: 's1' })),
    ).rejects.toThrow('steel-agents simulate s1 failed: DATABASE_ERROR')
  })

  it('should reject unknown jobs', async () => {
    await expect(processSteelAgents(job('nope'))).rejects.toThrow(
      'Unknown steel-agents job: nope (id=j1)',
    )
    await expect(
      processSteelAgents({ name: 'nope', data: {} } as Job),
    ).rejects.toThrow('id=unknown')
  })
})

describe('enqueueSteelAgentRun', () => {
  it('should add a run job', async () => {
    const add = vi.fn(async () => ({}))
    vi.mocked(getSteelAgentsQueue).mockReturnValue({ add } as never)
    expect((await enqueueSteelAgentRun('r1')).ok).toBe(true)
    expect(add).toHaveBeenCalledWith('run', { runId: 'r1' })
  })

  it('should return an error instead of throwing', async () => {
    vi.mocked(getSteelAgentsQueue).mockReturnValue({
      add: vi.fn(async () => {
        throw new Error('redis down')
      }),
    } as never)
    const result = await enqueueSteelAgentRun('r1')
    expect(result.ok).toBe(false)

    vi.mocked(getSteelAgentsQueue).mockImplementation(() => {
      throw 'boom'
    })
    expect((await enqueueSteelAgentRun('r1')).ok).toBe(false)
  })
})

describe('enqueueSteelAgentSimulation', () => {
  it('should add a simulate job', async () => {
    const add = vi.fn(async () => ({}))
    vi.mocked(getSteelAgentsQueue).mockReturnValue({ add } as never)
    expect((await enqueueSteelAgentSimulation('s1')).ok).toBe(true)
    expect(add).toHaveBeenCalledWith('simulate', { simulationId: 's1' })
  })

  it('should return an error instead of throwing', async () => {
    vi.mocked(getSteelAgentsQueue).mockReturnValue({
      add: vi.fn(async () => {
        throw new Error('redis down')
      }),
    } as never)
    expect((await enqueueSteelAgentSimulation('s1')).ok).toBe(false)

    vi.mocked(getSteelAgentsQueue).mockImplementation(() => {
      throw 'boom'
    })
    expect((await enqueueSteelAgentSimulation('s1')).ok).toBe(false)
  })
})
