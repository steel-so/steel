import { Prisma } from '@prisma/client'
import { describe, expect, it } from 'vitest'
import {
  createFakeSimulation,
  createFakeSimulationCase,
  createFakeSimulationDetail,
} from '@/src/__tests__/factories/nov-a3-persona-simulation.factory'
import {
  toSteelAgentSimulationCaseDTO,
  toSteelAgentSimulationDetailDTO,
  toSteelAgentSimulationDTO,
} from '../steel-agent-simulation.mapper'

describe('toSteelAgentSimulationDTO', () => {
  it('should map dates to ISO strings and decimals to numbers', () => {
    const started = new Date('2026-11-06T12:01:00.000Z')
    const dto = toSteelAgentSimulationDTO(
      createFakeSimulation({
        id: 's1',
        agentId: 'a1',
        status: 'COMPLETED',
        passedCases: 2,
        failedCases: 1,
        totalCases: 3,
        avgScore: 81,
        costUsd: new Prisma.Decimal('0.123456'),
        modelKey: 'openai:gpt-4o-mini',
        startedAt: started,
        finishedAt: started,
      }),
    )
    expect(dto).toMatchObject({
      id: 's1',
      agentId: 'a1',
      status: 'COMPLETED',
      passedCases: 2,
      failedCases: 1,
      totalCases: 3,
      avgScore: 81,
      costUsd: 0.123456,
      modelKey: 'openai:gpt-4o-mini',
      startedAt: '2026-11-06T12:01:00.000Z',
      finishedAt: '2026-11-06T12:01:00.000Z',
      createdAt: '2026-11-06T12:00:00.000Z',
    })
  })

  it('should keep missing dates null', () => {
    const dto = toSteelAgentSimulationDTO(createFakeSimulation())
    expect(dto.startedAt).toBeNull()
    expect(dto.finishedAt).toBeNull()
  })
})

describe('toSteelAgentSimulationCaseDTO', () => {
  it('should map a judged case', () => {
    const dto = toSteelAgentSimulationCaseDTO(
      createFakeSimulationCase({
        status: 'DONE',
        verdict: 'PASS',
        score: 90,
        channel: 'EMAIL',
        transcript: [{ role: 'customer', text: 'Oi' }],
        toolEvents: [
          {
            turn: 1,
            toolName: 'x',
            kind: 'READ',
            status: 'OK',
            title: null,
            error: null,
          },
        ],
        criteriaResults: [{ criterion: 'A', met: true, evidence: 'e' }],
        judgeSummary: 'Bom',
        costUsd: new Prisma.Decimal('0.5'),
        startedAt: new Date('2026-11-06T12:01:00.000Z'),
      }),
    )
    expect(dto.channel).toBe('EMAIL')
    expect(dto.verdict).toBe('PASS')
    expect(dto.transcript).toHaveLength(1)
    expect(dto.toolEvents[0].toolName).toBe('x')
    expect(dto.criteriaResults[0].met).toBe(true)
    expect(dto.costUsd).toBe(0.5)
    expect(dto.startedAt).toBe('2026-11-06T12:01:00.000Z')
    expect(dto.criteria).toEqual([
      'Reconhece o problema',
      'Informa o próximo passo',
    ])
  })

  it('should default json columns and unknown channels', () => {
    const dto = toSteelAgentSimulationCaseDTO(
      createFakeSimulationCase({ channel: 'SMS', criteria: null as never }),
    )
    expect(dto.channel).toBe('WHATSAPP')
    expect(dto.criteria).toEqual([])
    expect(dto.transcript).toEqual([])
    expect(dto.toolEvents).toEqual([])
    expect(dto.criteriaResults).toEqual([])
  })
})

describe('toSteelAgentSimulationDetailDTO', () => {
  it('should add the agent name and the cases', () => {
    const dto = toSteelAgentSimulationDetailDTO(
      createFakeSimulationDetail({}, [{}, {}], { name: 'Triagem' }),
    )
    expect(dto.agentName).toBe('Triagem')
    expect(dto.cases).toHaveLength(2)
  })
})
