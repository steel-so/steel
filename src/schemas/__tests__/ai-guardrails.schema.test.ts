import { describe, expect, it } from 'vitest'
import {
  AI_FORBIDDEN_TOPICS_MAX,
  UpdateWorkspaceAiGuardrailsSchema,
} from '../ai-guardrails.schema'

const parse = (input: unknown) =>
  UpdateWorkspaceAiGuardrailsSchema.safeParse(input)

describe('UpdateWorkspaceAiGuardrailsSchema', () => {
  it('should accept an empty patch and a full one', () => {
    expect(parse({}).success).toBe(true)
    const full = parse({
      piiMaskingPolicy: 'EVERYWHERE',
      injectionClassifierEnabled: true,
      forbiddenTopics: ['  processo judicial  ', 'portabilidade'],
      maxDiscountPercent: 10,
      maxRefundAmount: 99.9,
      maxDeadlineDays: 30,
    })
    expect(full.success).toBe(true)
    expect(full.data?.forbiddenTopics).toEqual([
      'processo judicial',
      'portabilidade',
    ])
  })

  it('should accept null to clear the limits', () => {
    expect(
      parse({
        maxDiscountPercent: null,
        maxRefundAmount: null,
        maxDeadlineDays: null,
      }).success,
    ).toBe(true)
  })

  it.each([
    [{ piiMaskingPolicy: 'SOMETIMES' }, 'Política de mascaramento inválida'],
    [
      { forbiddenTopics: ['a'] },
      'Cada assunto precisa de ao menos 2 caracteres',
    ],
    [{ forbiddenTopics: ['x'.repeat(81)] }, 'até 80 caracteres'],
    [{ forbiddenTopics: ['Pix', 'pix'] }, 'Assuntos repetidos'],
    [
      {
        forbiddenTopics: Array.from(
          { length: AI_FORBIDDEN_TOPICS_MAX + 1 },
          (_, i) => `assunto ${i}`,
        ),
      },
      'no máximo 50',
    ],
    [{ maxDiscountPercent: 10.5 }, 'percentual inteiro'],
    [{ maxDiscountPercent: -1 }, 'não pode ser negativo'],
    [{ maxDiscountPercent: 101 }, 'vai até 100'],
    [{ maxRefundAmount: -5 }, 'não pode ser negativo'],
    [{ maxRefundAmount: 10.123 }, 'duas casas decimais'],
    [{ maxRefundAmount: 2_000_000 }, 'acima do limite'],
    [{ maxDeadlineDays: 1.5 }, 'número inteiro de dias'],
    [{ maxDeadlineDays: -1 }, 'não pode ser negativo'],
    [{ maxDeadlineDays: 5000 }, 'Máximo de 3650 dias'],
  ])('should reject %o', (input, message) => {
    const result = parse(input)
    expect(result.success).toBe(false)
    expect(result.error?.issues[0].message).toContain(message)
  })
})
