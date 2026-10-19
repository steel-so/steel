import { describe, expect, it } from 'vitest'
import {
  AiEvalCaseFromMessageSchema,
  AiEvalLatestQuerySchema,
  CreateAiEvalCaseSchema,
  CreateAiEvalSetSchema,
  hasGrading,
  StartAiEvalRunSchema,
  UpdateAiEvalCaseSchema,
  UpdateAiEvalSetSchema,
} from '../ai-eval.schema'
import {
  AiQualityExportQuerySchema,
  AiQualityQuerySchema,
  ListMyAiFeedbackQuerySchema,
  UpsertAiFeedbackSchema,
} from '../ai-feedback.schema'

describe('UpsertAiFeedbackSchema', () => {
  it('accepts a thumbs up with defaults', () => {
    expect(
      UpsertAiFeedbackSchema.parse({
        surface: 'STEEL_AI_MESSAGE',
        targetId: 'msg_1',
        rating: 'UP',
      }),
    ).toEqual({
      surface: 'STEEL_AI_MESSAGE',
      targetId: 'msg_1',
      variant: '',
      rating: 'UP',
      reason: null,
      comment: null,
    })
  })

  it('accepts a thumbs down with reason and trims the comment', () => {
    const parsed = UpsertAiFeedbackSchema.parse({
      surface: 'SD_COPILOT',
      targetId: 'tk_1',
      variant: 'chat:3',
      rating: 'DOWN',
      reason: 'incomplete',
      comment: '  faltou o prazo  ',
    })
    expect(parsed.comment).toBe('faltou o prazo')
    expect(parsed.variant).toBe('chat:3')
  })

  it('turns an empty comment into null', () => {
    expect(
      UpsertAiFeedbackSchema.parse({
        surface: 'STEEL_AGENT_RUN',
        targetId: 'r1',
        rating: 'DOWN',
        comment: '   ',
      }).comment,
    ).toBeNull()
  })

  it.each([
    [{ surface: 'SD_COPILOT', variant: '' }, 'variant'],
    [{ surface: 'SD_COPILOT', variant: 'whatever' }, 'variant'],
    [{ surface: 'STEEL_AI_MESSAGE', variant: 'summary' }, 'variant'],
    [
      { surface: 'STEEL_AI_MESSAGE', reason: 'incorrect', rating: 'UP' },
      'reason',
    ],
    [{ surface: 'STEEL_AI_MESSAGE', targetId: 'bad id!' }, 'targetId'],
    [{ surface: 'STEEL_AI_MESSAGE', comment: 'x'.repeat(1001) }, 'comment'],
    [{ surface: 'NOPE' }, 'surface'],
  ])('rejects %j', (patch, path) => {
    const result = UpsertAiFeedbackSchema.safeParse({
      targetId: 't1',
      rating: 'UP',
      ...patch,
    })
    expect(result.success).toBe(false)
    expect(result.error?.issues.some((i) => i.path[0] === path)).toBe(true)
  })
})

describe('ListMyAiFeedbackQuerySchema', () => {
  it('splits, dedupes and caps the ids', () => {
    const ids = Array.from({ length: 120 }, (_, i) => `m${i}`)
    const parsed = ListMyAiFeedbackQuerySchema.parse({
      surface: 'STEEL_AI_MESSAGE',
      targetIds: ` m1 ,m1,,${ids.join(',')}`,
    })
    expect(parsed.targetIds[0]).toBe('m1')
    expect(parsed.targetIds).toHaveLength(100)
  })

  it('needs at least one id', () => {
    expect(
      ListMyAiFeedbackQuerySchema.safeParse({
        surface: 'STEEL_AI_MESSAGE',
        targetIds: ' , ',
      }).success,
    ).toBe(false)
  })
})

describe('quality queries', () => {
  it('reuse the usage period rules', () => {
    expect(AiQualityQuerySchema.parse({})).toEqual({
      scope: 'personal',
      period: 'this_month',
    })
    expect(
      AiQualityQuerySchema.safeParse({ period: 'custom', from: '2026-10-01' })
        .success,
    ).toBe(false)
    expect(AiQualityExportQuerySchema.parse({ scope: 'workspace' }).view).toBe(
      'feedback',
    )
    expect(AiQualityExportQuerySchema.safeParse({ view: 'user' }).success).toBe(
      false,
    )
  })
})

describe('eval set schemas', () => {
  it('creates with defaults and validates the name', () => {
    expect(
      CreateAiEvalSetSchema.parse({ name: ' FAQ ', target: 'WHATSAPP_REPLY' }),
    ).toEqual({
      name: 'FAQ',
      description: null,
      target: 'WHATSAPP_REPLY',
      skillId: null,
    })
    expect(
      CreateAiEvalSetSchema.safeParse({ name: '', target: 'STEEL_ASSISTANT' })
        .success,
    ).toBe(false)
  })

  it('needs something to update', () => {
    expect(UpdateAiEvalSetSchema.safeParse({}).success).toBe(false)
    expect(UpdateAiEvalSetSchema.parse({ description: '' })).toEqual({
      description: null,
    })
  })
})

describe('eval case schemas', () => {
  it('needs a grading', () => {
    expect(
      CreateAiEvalCaseSchema.safeParse({ input: 'Pergunta' }).success,
    ).toBe(false)
    expect(
      CreateAiEvalCaseSchema.parse({
        input: 'Pergunta',
        mustContain: ['prazo'],
      }),
    ).toEqual({
      input: 'Pergunta',
      expected: null,
      criteria: null,
      mustContain: ['prazo'],
      mustNotContain: [],
    })
  })

  it('caps the checks', () => {
    expect(
      CreateAiEvalCaseSchema.safeParse({
        input: 'P',
        mustContain: Array.from({ length: 11 }, (_, i) => `t${i}`),
      }).success,
    ).toBe(false)
  })

  it('updates partially', () => {
    expect(UpdateAiEvalCaseSchema.safeParse({}).success).toBe(false)
    expect(UpdateAiEvalCaseSchema.parse({ criteria: 'x' })).toEqual({
      criteria: 'x',
    })
  })

  it('tells when a case has a grading', () => {
    expect(hasGrading({})).toBe(false)
    expect(hasGrading({ mustNotContain: ['a'] })).toBe(true)
    expect(hasGrading({ criteria: 'c' })).toBe(true)
  })

  it('saves from a message', () => {
    expect(
      AiEvalCaseFromMessageSchema.parse({ setId: 's1', messageId: 'm1' }),
    ).toEqual({ setId: 's1', messageId: 'm1', criteria: null })
  })
})

describe('StartAiEvalRunSchema', () => {
  it('defaults to the current settings', () => {
    expect(StartAiEvalRunSchema.parse({})).toEqual({
      modelKey: null,
      skillId: null,
      promptOverride: null,
      reason: 'manual',
    })
  })

  it('only accepts catalog models', () => {
    expect(
      StartAiEvalRunSchema.safeParse({ modelKey: 'openai:gpt-4o-mini' })
        .success,
    ).toBe(true)
    expect(
      StartAiEvalRunSchema.safeParse({ modelKey: 'acme:nope' }).success,
    ).toBe(false)
  })

  it('validates the latest query', () => {
    expect(
      AiEvalLatestQuerySchema.safeParse({ target: 'STEEL_ASSISTANT' }).success,
    ).toBe(true)
    expect(AiEvalLatestQuerySchema.safeParse({}).success).toBe(false)
  })
})
