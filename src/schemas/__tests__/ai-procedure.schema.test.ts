import { describe, expect, it } from 'vitest'
import { BOLETO_STEPS } from '@/src/__tests__/factories/nov-a5-procedures.factory'
import {
  CreateAiProcedureSchema,
  ListAiProcedureRunsQuerySchema,
  PreviewAiProcedureSchema,
  ProcedureStepSchema,
  UpdateAiProcedureSchema,
} from '../ai-procedure.schema'

const valid = {
  name: 'Segunda via',
  whenToUse: 'boleto',
  steps: BOLETO_STEPS,
}

describe('ai-procedure schemas', () => {
  it('should create with defaults', () => {
    const parsed = CreateAiProcedureSchema.parse(valid)
    expect(parsed).toMatchObject({
      status: 'DRAFT',
      maxAttempts: 3,
      whatsappEnabled: true,
      agentIds: [],
    })
  })

  it('should default step fields per kind', () => {
    const http = ProcedureStepSchema.parse({
      key: 'a',
      kind: 'HTTP',
      title: 'Consulta',
      url: 'https://x.com',
    })
    expect(http).toMatchObject({ method: 'GET', saves: [], required: true })
    const collect = ProcedureStepSchema.parse({
      key: 'b',
      kind: 'COLLECT',
      title: 'CPF',
      variable: 'cpf',
      prompt: 'o CPF',
    })
    expect(collect).toMatchObject({ validation: 'TEXT' })
  })

  it.each([
    [{ ...valid, steps: [] }],
    [{ ...valid, name: '' }],
    [{ ...valid, maxAttempts: 9 }],
    [{ ...valid, steps: [{ ...BOLETO_STEPS[0], key: 'Bad Key' }] }],
    [{ ...valid, steps: [{ key: 'x', kind: 'NOPE', title: 't' }] }],
  ])('should reject %#', (body) => {
    expect(CreateAiProcedureSchema.safeParse(body).success).toBe(false)
  })

  it('should accept partial updates and reject bad status', () => {
    expect(UpdateAiProcedureSchema.parse({ name: 'x' })).toEqual({ name: 'x' })
    expect(UpdateAiProcedureSchema.safeParse({ status: 'X' }).success).toBe(false)
  })

  it('should parse preview and run queries', () => {
    expect(PreviewAiProcedureSchema.parse({})).toEqual({ variables: {} })
    expect(ListAiProcedureRunsQuerySchema.parse({})).toEqual({ limit: 30 })
    expect(
      ListAiProcedureRunsQuerySchema.parse({ limit: '5', status: 'FAILED' }),
    ).toEqual({ limit: 5, status: 'FAILED' })
  })
})
