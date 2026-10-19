import { describe, expect, it } from 'vitest'
import {
  type AutoReplyLimits,
  autoReplyLimitsInstruction,
  evaluateAutoReplyLimits,
  findForbiddenTopic,
  hasAutoReplyLimits,
} from '@/src/lib/ai/guardrails/limits'

const none: AutoReplyLimits = {
  forbiddenTopics: [],
  maxDiscountPercent: null,
  maxRefundAmount: null,
  maxDeadlineDays: null,
}

describe('findForbiddenTopic()', () => {
  it('should match whole words ignoring case and accents', () => {
    expect(
      findForbiddenTopic('Quero falar do PROCESSO judicial', [
        'processo judicial',
      ]),
    ).toBe('processo judicial')
    expect(findForbiddenTopic('portabilidade já', ['Portabilidade'])).toBe(
      'Portabilidade',
    )
    expect(findForbiddenTopic('ação', ['acao'])).toBe('acao')
    expect(findForbiddenTopic('reprocessamento', ['processo'])).toBeNull()
    expect(findForbiddenTopic('qualquer', ['  '])).toBeNull()
  })
})

describe('evaluateAutoReplyLimits()', () => {
  it('should pass when nothing is configured', () => {
    expect(hasAutoReplyLimits(none)).toBe(false)
    expect(
      evaluateAutoReplyLimits(none, {
        inbound: 'quero 50% de desconto',
        reply: 'Te dou 50% de desconto e reembolso em 90 dias',
      }),
    ).toBeNull()
  })

  it('should hand off on a forbidden topic in the inbound text or the draft', () => {
    const limits = { ...none, forbiddenTopics: ['cancelamento'] }
    expect(
      evaluateAutoReplyLimits(limits, {
        inbound: 'Quero o cancelamento',
        reply: 'Claro!',
      }),
    ).toMatchObject({ kind: 'forbidden_topic' })
    expect(
      evaluateAutoReplyLimits(limits, {
        inbound: 'oi',
        reply: 'Posso iniciar o cancelamento',
      })?.note,
    ).toContain('cancelamento')
  })

  it('should enforce the discount limit', () => {
    const limits = { ...none, maxDiscountPercent: 10 }
    expect(
      evaluateAutoReplyLimits(limits, {
        inbound: '',
        reply: 'Consigo 15% de desconto',
      }),
    ).toMatchObject({ kind: 'discount' })
    expect(
      evaluateAutoReplyLimits(limits, {
        inbound: '',
        reply: 'Consigo 10% de desconto',
      }),
    ).toBeNull()
    expect(
      evaluateAutoReplyLimits(
        { ...none, maxDiscountPercent: 0 },
        { inbound: '', reply: 'Vou te dar um desconto especial' },
      )?.note,
    ).toContain('não pode prometer descontos')
  })

  it('should enforce the refund limit', () => {
    const limits = { ...none, maxRefundAmount: 100 }
    expect(
      evaluateAutoReplyLimits(limits, {
        inbound: '',
        reply: 'Faremos o reembolso de R$ 1.500,00',
      }),
    ).toMatchObject({ kind: 'refund' })
    expect(
      evaluateAutoReplyLimits(limits, {
        inbound: '',
        reply: 'Faremos o estorno de R$ 80',
      }),
    ).toBeNull()
    // A refund without an amount cannot be checked: hand off.
    expect(
      evaluateAutoReplyLimits(limits, {
        inbound: '',
        reply: 'Vamos devolver o seu dinheiro',
      }),
    ).toMatchObject({ kind: 'refund' })
    expect(
      evaluateAutoReplyLimits(
        { ...none, maxRefundAmount: 0 },
        { inbound: '', reply: 'Reembolso de R$ 10.50' },
      )?.note,
    ).toContain('não pode prometer reembolsos')
  })

  it('should enforce the deadline limit across units', () => {
    const limits = { ...none, maxDeadlineDays: 10 }
    expect(
      evaluateAutoReplyLimits(limits, {
        inbound: '',
        reply: 'Entregamos em 3 semanas',
      }),
    ).toMatchObject({ kind: 'deadline' })
    expect(
      evaluateAutoReplyLimits(limits, {
        inbound: '',
        reply: 'Resolvemos em até 48 horas',
      }),
    ).toBeNull()
    expect(
      evaluateAutoReplyLimits(limits, {
        inbound: '',
        reply: 'Fica pronto no prazo de 2 meses',
      }),
    ).toMatchObject({ kind: 'deadline' })
    expect(
      evaluateAutoReplyLimits(limits, { inbound: '', reply: 'em 5 dias' }),
    ).toBeNull()
  })
})

describe('autoReplyLimitsInstruction()', () => {
  it('should be empty without limits and list every rule otherwise', () => {
    expect(autoReplyLimitsInstruction(none)).toBe('')
    const text = autoReplyLimitsInstruction({
      forbiddenTopics: ['jurídico'],
      maxDiscountPercent: 5,
      maxRefundAmount: 200,
      maxDeadlineDays: 7,
    })
    expect(text).toContain('jurídico')
    expect(text).toContain('5%')
    expect(text).toContain('R$')
    expect(text).toContain('7 dia(s)')
    const zero = autoReplyLimitsInstruction({
      ...none,
      maxDiscountPercent: 0,
      maxRefundAmount: 0,
    })
    expect(zero).toContain('Nunca ofereça nem prometa descontos.')
    expect(zero).toContain('Nunca prometa reembolso ou estorno.')
  })
})
