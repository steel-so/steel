import { describe, expect, it } from 'vitest'
import {
  createFakeAiProcedure,
  createFakeAiProcedureRun,
  createFakeAiProcedureRunStep,
  createFakeAiProcedureVersion,
} from '@/src/__tests__/factories/nov-a5-procedures.factory'
import {
  stepsOf,
  toAiProcedureDTO,
  toAiProcedureRunDetailDTO,
  toAiProcedureRunDTO,
  toAiProcedureVersionDTO,
} from '../ai-procedure.mapper'

describe('ai-procedure mapper', () => {
  it('should map a procedure with its monthly runs', () => {
    const dto = toAiProcedureDTO(createFakeAiProcedure({ id: 'p1' }), 4)
    expect(dto).toMatchObject({
      id: 'p1',
      runsThisMonth: 4,
      createdAt: '2026-10-30T12:00:00.000Z',
    })
    expect(dto.steps).toHaveLength(3)
    expect(toAiProcedureDTO(createFakeAiProcedure()).runsThisMonth).toBe(0)
  })

  it('should treat a malformed steps column as empty', () => {
    expect(stepsOf(null)).toEqual([])
    expect(stepsOf({})).toEqual([])
  })

  it('should flag the version in use', () => {
    const version = createFakeAiProcedureVersion({ number: 2 })
    expect(toAiProcedureVersionDTO(version, 2).current).toBe(true)
    expect(toAiProcedureVersionDTO(version, 3).current).toBe(false)
  })

  it('should map runs, finished or not, and their steps', () => {
    const run = {
      ...createFakeAiProcedureRun({ finishedAt: null }),
      procedure: { name: 'Segunda via' },
    }
    expect(toAiProcedureRunDTO(run)).toMatchObject({
      procedureName: 'Segunda via',
      finishedAt: null,
    })
    const done = {
      ...run,
      finishedAt: new Date('2026-10-30T13:00:00.000Z'),
      steps: [createFakeAiProcedureRunStep({ title: 'Validar CPF' })],
    }
    const detail = toAiProcedureRunDetailDTO(done)
    expect(detail.finishedAt).toBe('2026-10-30T13:00:00.000Z')
    expect(detail.steps[0]).toMatchObject({ title: 'Validar CPF', status: 'OK' })
  })
})
