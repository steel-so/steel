import { Prisma } from '@prisma/client'
import { describe, expect, it } from 'vitest'
import { createFakeSteelAgentVersion } from '@/src/__tests__/factories/nov-a2-agent-versions.factory'
import {
  createFakeSteelAgentRun,
  createFakeSteelAgentRunDetail,
  createFakeSteelAgentRunStep,
  createFakeSteelAgentTool,
  createFakeSteelAgentWithRelations,
} from '@/src/__tests__/factories/steel-agent.factory'
import { createFakeAiPendingAction } from '@/src/__tests__/factories/steel-ai.factory'
import { emptyVersionStats } from '@/src/lib/steel-agents/versions'
import {
  toSteelAgentDTO,
  toSteelAgentRunDetailDTO,
  toSteelAgentRunDTO,
  toSteelAgentRunStepDTO,
  toSteelAgentVersionDTO,
  toSteelAgentVersionRefDTO,
} from '../steel-agent.mapper'

const kindOf = (name: string) =>
  name.includes('delete') ? ('DELETE' as const) : ('CREATE' as const)

describe('steel agent mapper', () => {
  it('should map an agent with owner, effective modes and last run', () => {
    const agent = createFakeSteelAgentWithRelations({
      id: 'a1',
      lastRunAt: new Date('2026-10-06T11:00:00.000Z'),
      nextRunAt: new Date('2026-10-07T11:00:00.000Z'),
      tools: [
        createFakeSteelAgentTool({ toolName: 'crm_delete_task', mode: 'AUTO' }),
        createFakeSteelAgentTool({ toolName: 'crm_create_task', mode: 'AUTO' }),
      ],
      runs: [
        {
          id: 'r1',
          status: 'SUCCEEDED',
          triggerType: 'MANUAL',
          createdAt: new Date('2026-10-06T11:00:00.000Z'),
          finishedAt: null,
        },
      ],
    })
    const dto = toSteelAgentDTO(agent, kindOf)
    expect(dto.owner?.name).toBe('Ana Dona')
    expect(dto.tools).toEqual([
      { toolName: 'crm_delete_task', mode: 'APPROVAL' },
      { toolName: 'crm_create_task', mode: 'AUTO' },
    ])
    expect(dto.lastRun).toEqual({
      id: 'r1',
      status: 'SUCCEEDED',
      triggerType: 'MANUAL',
      createdAt: '2026-10-06T11:00:00.000Z',
      finishedAt: null,
    })
    expect(dto.lastRunAt).toBe('2026-10-06T11:00:00.000Z')
  })

  it('should map an agent without owner nor runs', () => {
    const dto = toSteelAgentDTO(
      createFakeSteelAgentWithRelations({ ownerId: null }),
      kindOf,
    )
    expect(dto.owner).toBeNull()
    expect(dto.lastRun).toBeNull()
    expect(dto.lastRunAt).toBeNull()
  })

  it('should map a run with a numeric cost', () => {
    const dto = toSteelAgentRunDTO(
      createFakeSteelAgentRun({
        costUsd: new Prisma.Decimal('0.123456'),
        startedAt: new Date('2026-10-06T11:00:00.000Z'),
        triggerPayload: { a: 1 },
      }),
    )
    expect(dto.costUsd).toBe(0.123456)
    expect(dto.startedAt).toBe('2026-10-06T11:00:00.000Z')
    expect(dto.triggerPayload).toEqual({ a: 1 })
    expect(
      toSteelAgentRunDTO(createFakeSteelAgentRun()).triggerPayload,
    ).toBeNull()
  })

  it('should map steps with tool labels', () => {
    const labelOf = (name: string) => (name === 'x' ? 'Label X' : null)
    expect(
      toSteelAgentRunStepDTO(
        createFakeSteelAgentRunStep({ toolName: 'x' }),
        labelOf,
      ).toolLabel,
    ).toBe('Label X')
    const model = toSteelAgentRunStepDTO(
      createFakeSteelAgentRunStep({
        kind: 'MODEL',
        toolName: null,
        input: null,
        output: null,
      }),
      labelOf,
    )
    expect(model.toolLabel).toBeNull()
    expect(model.input).toBeNull()
    expect(model.output).toBeNull()
  })

  it('should hide the retrieved context from viewers who cannot approve', () => {
    const output = {
      summary: '1 chamado',
      context: { excerpt: 'dados', truncated: false },
    }
    const step = createFakeSteelAgentRunStep({ output })
    expect(toSteelAgentRunStepDTO(step, () => null).output).toEqual(output)
    expect(toSteelAgentRunStepDTO(step, () => null, false).output).toEqual({
      summary: '1 chamado',
    })
    const plain = createFakeSteelAgentRunStep({ output: null })
    expect(toSteelAgentRunStepDTO(plain, () => null, false).output).toBeNull()

    const detail = createFakeSteelAgentRunDetail({ steps: [step] })
    const hidden = toSteelAgentRunDetailDTO(detail, {
      canApprove: false,
      labelOf: () => null,
    })
    expect(hidden.steps[0].output).toEqual({ summary: '1 chamado' })
  })

  it('should expose the run a test was re-executed from', () => {
    expect(
      toSteelAgentRunDTO(createFakeSteelAgentRun({ rerunOfId: 'run0' }))
        .rerunOfId,
    ).toBe('run0')
  })

  it('should map the run detail', () => {
    const detail = createFakeSteelAgentRunDetail({
      steps: [createFakeSteelAgentRunStep()],
      pendingActions: [createFakeAiPendingAction({ id: 'p1' })],
    })
    const dto = toSteelAgentRunDetailDTO(detail, {
      canApprove: true,
      labelOf: () => 'L',
    })
    expect(dto.agent.name).toBe('Triagem')
    expect(dto.steps).toHaveLength(1)
    expect(dto.pendingActions[0].id).toBe('p1')
    expect(dto.canApprove).toBe(true)
  })

  it('should expose the version pointers and the gate settings on the agent', () => {
    const dto = toSteelAgentDTO(
      createFakeSteelAgentWithRelations({
        evalSetId: 'set1',
        evalMinPassRate: 0.9,
        simGateEnabled: true,
        simGateMinPassRate: 0.7,
        publishedVersionId: 'v1',
        challengerVersionId: 'v2',
      }),
      kindOf,
    )
    expect(dto).toMatchObject({
      evalSetId: 'set1',
      evalMinPassRate: 0.9,
      simGateEnabled: true,
      simGateMinPassRate: 0.7,
      publishedVersionId: 'v1',
      challengerVersionId: 'v2',
    })
    expect(
      toSteelAgentRunDTO(createFakeSteelAgentRun({ versionId: 'v1' }))
        .versionId,
    ).toBe('v1')
  })

  it('should map a version with effective tool modes, eval rate and stats', () => {
    const version = createFakeSteelAgentVersion({
      id: 'v3',
      number: 3,
      status: 'CHALLENGER',
      rolloutPercent: 20,
      evalPassed: 8,
      evalTotal: 10,
      simulationId: 'sim1',
      simPassed: 3,
      simTotal: 4,
      tools: [
        { toolName: 'crm_delete_task', mode: 'AUTO' },
        { toolName: 'crm_create_task', mode: 'AUTO' },
      ],
    })
    const dto = toSteelAgentVersionDTO(
      version,
      { ...emptyVersionStats(), runs: 4 },
      kindOf,
    )
    expect(dto).toMatchObject({
      id: 'v3',
      number: 3,
      status: 'CHALLENGER',
      rolloutPercent: 20,
      evalPassRate: 0.8,
      simulationId: 'sim1',
      simPassRate: 0.75,
      stats: { runs: 4 },
    })
    expect(dto.tools).toEqual([
      { toolName: 'crm_create_task', mode: 'AUTO' },
      { toolName: 'crm_delete_task', mode: 'APPROVAL' },
    ])
    expect(dto.publishedAt).toBe('2026-10-29T12:00:00.000Z')
  })

  it('should default the stats and leave the pass rate empty without an eval', () => {
    const dto = toSteelAgentVersionDTO(
      createFakeSteelAgentVersion({ publishedAt: null }),
      undefined,
      kindOf,
    )
    expect(dto.evalPassRate).toBeNull()
    expect(dto.simPassRate).toBeNull()
    expect(dto.publishedAt).toBeNull()
    expect(dto.stats.runs).toBe(0)
    expect(
      toSteelAgentVersionRefDTO(createFakeSteelAgentVersion({ number: 5 })),
    ).toMatchObject({ number: 5, status: 'PUBLISHED' })
  })
})
