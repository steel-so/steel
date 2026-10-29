import { describe, expect, it } from 'vitest'
import {
  checkAnswer,
  evaluateCondition,
  interpolate,
  interpolateJson,
  normalizeAnswer,
  readPath,
} from '@/src/lib/whatsapp/chatbot/text'
import {
  matchesKeyword,
  shouldStartBot,
} from '@/src/lib/whatsapp/chatbot/trigger'

describe('chatbot text helpers', () => {
  it('normalizes answers', () => {
    expect(normalizeAnswer('  Ação!  RÁPIDA ')).toBe('acao rapida')
  })

  it('interpolates known variables and blanks the unknown ones', () => {
    expect(interpolate('Oi {{ nome }} {{x}}', { nome: 'Ana' })).toBe('Oi Ana ')
  })

  it('interpolates inside JSON string values only', () => {
    expect(
      interpolateJson('{"a":"{{n}}","b":[1,"{{n}}"],"c":{"d":"{{n}}"},"e":2}', {
        n: 'x',
      }),
    ).toEqual({ a: 'x', b: [1, 'x'], c: { d: 'x' }, e: 2 })
    expect(interpolateJson('not json {{n}}', { n: 'x' })).toBe('not json x')
  })

  describe('checkAnswer', () => {
    it.each([
      ['TEXT', '  oi ', 'oi'],
      ['NUMBER', '12,5', '12.5'],
      ['NUMBER', '-3', '-3'],
      ['EMAIL', 'A@B.com', 'a@b.com'],
      ['PHONE', '(11) 99999-0000', '11999990000'],
      ['CPF', '529.982.247-25', '52998224725'],
      ['CNPJ', '11.222.333/0001-81', '11222333000181'],
      ['DATE', '5/3/2026', '05/03/2026'],
      ['DATE', '29-02-2024', '29/02/2024'],
    ] as const)('accepts %s %s', (validation, raw, value) => {
      expect(checkAnswer(validation, raw)).toEqual({ ok: true, value })
    })

    it.each([
      ['TEXT', '   '],
      ['NUMBER', 'abc'],
      ['EMAIL', 'a@b'],
      ['PHONE', '123'],
      ['CPF', '111.111.111-11'],
      ['CNPJ', '11.111.111/1111-11'],
      ['DATE', '31/02/2026'],
      ['DATE', 'ontem'],
    ] as const)('refuses %s %s', (validation, raw) => {
      expect(checkAnswer(validation, raw)).toEqual({ ok: false })
    })
  })

  describe('evaluateCondition', () => {
    it('compares text without case or accents', () => {
      expect(evaluateCondition('equals', 'Ação', 'acao')).toBe(true)
      expect(evaluateCondition('not_equals', 'a', 'b')).toBe(true)
      expect(evaluateCondition('contains', 'plano premium', 'premium')).toBe(
        true,
      )
      expect(evaluateCondition('not_contains', 'plano', 'premium')).toBe(true)
      expect(evaluateCondition('is_empty', '  ', '')).toBe(true)
      expect(evaluateCondition('is_not_empty', 'x', '')).toBe(true)
    })

    it('compares numbers and refuses non-numeric operands', () => {
      expect(evaluateCondition('greater_than', '10,5', '2')).toBe(true)
      expect(evaluateCondition('less_than', '1', '2')).toBe(true)
      expect(evaluateCondition('greater_than', 'abc', '2')).toBe(false)
      expect(evaluateCondition('less_than', '1', 'x')).toBe(false)
    })
  })

  describe('readPath', () => {
    it('walks objects and arrays', () => {
      const data = { a: { b: [{ c: 5 }] }, n: null, o: { k: 1 } }
      expect(readPath(data, 'a.b.0.c')).toBe('5')
      expect(readPath(data, 'o')).toBe('{"k":1}')
      expect(readPath(data, 'n')).toBeNull()
      expect(readPath(data, 'a.x.y')).toBeNull()
      expect(readPath('text', 'a')).toBeNull()
      expect(readPath(null, 'a')).toBeNull()
    })
  })
})

describe('chatbot triggers', () => {
  it('matches whole-word keywords', () => {
    expect(matchesKeyword('Quero um ORÇAMENTO, por favor', ['orcamento'])).toBe(
      true,
    )
    expect(matchesKeyword('orçamentos', ['orcamento'])).toBe(false)
    expect(matchesKeyword('oi', ['', '  '])).toBe(false)
    expect(matchesKeyword('segunda via do boleto', ['segunda via'])).toBe(true)
  })

  it('decides by trigger kind', () => {
    const facts = { opening: true, text: 'oi', outsideBusinessHours: false }
    expect(
      shouldStartBot({ triggerKind: 'NEW_CONVERSATION', keywords: [] }, facts),
    ).toBe(true)
    expect(
      shouldStartBot(
        { triggerKind: 'NEW_CONVERSATION', keywords: [] },
        { ...facts, opening: false },
      ),
    ).toBe(false)
    expect(
      shouldStartBot(
        { triggerKind: 'KEYWORD', keywords: ['oi'] },
        { ...facts, opening: false },
      ),
    ).toBe(true)
    expect(
      shouldStartBot(
        { triggerKind: 'OUTSIDE_BUSINESS_HOURS', keywords: [] },
        facts,
      ),
    ).toBe(false)
    expect(
      shouldStartBot(
        { triggerKind: 'OUTSIDE_BUSINESS_HOURS', keywords: [] },
        { ...facts, outsideBusinessHours: true },
      ),
    ).toBe(true)
  })
})
