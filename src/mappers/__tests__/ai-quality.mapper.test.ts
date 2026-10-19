import { describe, expect, it } from 'vitest'
import {
  createFakeAiEvalCase,
  createFakeAiEvalResult,
  createFakeAiEvalRunWithResults,
  createFakeAiEvalRunWithUser,
  createFakeAiEvalSetSummary,
  createFakeAiEvalSetWithCases,
  createFakeAiFeedback,
} from '@/src/__tests__/factories/ai-quality.factory'
import type {
  AiQualityFeedbackRow,
  AiQualityLinkContext,
} from '@/src/repositories/ai-quality.repository'
import {
  toAiEvalCaseDTO,
  toAiEvalResultDTO,
  toAiEvalRunDetailDTO,
  toAiEvalRunDTO,
  toAiEvalSetDetailDTO,
  toAiEvalSetDTO,
} from '../ai-eval.mapper'
import { toAiFeedbackDTO } from '../ai-feedback.mapper'
import {
  AI_QUALITY_NO_MODEL_LABEL,
  approvalRate,
  linkFor,
  modelLabel,
  resolutionItem,
  toAiQualityAggregateCsvRow,
  toAiQualityCsvRow,
  toAiQualityDTO,
  toAiQualityWorstItemDTO,
} from '../ai-quality.mapper'

const VIEWER = 'user_1'

function row(over: Partial<AiQualityFeedbackRow> = {}): AiQualityFeedbackRow {
  return {
    id: 'f1',
    surface: 'STEEL_AI_MESSAGE',
    targetId: 'm1',
    variant: '',
    rating: 'DOWN',
    reason: 'incorrect',
    comment: '=SOMA(1)',
    modelKey: 'openai:gpt-4o-mini',
    userId: VIEWER,
    userName: 'Ana',
    userEmail: 'ana@x.com',
    createdAt: new Date('2026-10-05T10:00:00.000Z'),
    ...over,
  }
}

function context(
  over: Partial<AiQualityLinkContext> = {},
): AiQualityLinkContext {
  return {
    chats: new Map([['m1', { conversationId: 'c1', ownerId: VIEWER }]]),
    agentRuns: new Map([['r1', { agentId: 'a1' }]]),
    tickets: new Map([['t1', { number: 42 }]]),
    articles: new Set(['k1']),
    whatsapp: new Map([['w1', { conversationId: 'wc1' }]]),
    ...over,
  }
}

describe('ai-feedback mapper', () => {
  it('maps a row', () => {
    const fb = createFakeAiFeedback({ rating: 'DOWN', reason: 'tone' })
    expect(toAiFeedbackDTO(fb)).toMatchObject({
      id: fb.id,
      rating: 'DOWN',
      reason: 'tone',
      createdAt: fb.createdAt.toISOString(),
    })
  })
})

describe('ai-quality mapper', () => {
  it('computes rates and labels', () => {
    expect(approvalRate(0, 0)).toBeNull()
    expect(approvalRate(1, 4)).toBe(0.25)
    expect(modelLabel(null)).toBe(AI_QUALITY_NO_MODEL_LABEL)
    expect(modelLabel('openai:gpt-4o-mini')).toBe('GPT-4o mini')
    expect(modelLabel('acme:x')).toBe('acme:x')
  })

  it('builds a resolution item', () => {
    expect(resolutionItem({ handled: 0, resolved: 0 }, 0)).toEqual({
      handled: 0,
      resolved: 0,
      rate: null,
      costUsd: 0,
      costPerResolutionUsd: null,
    })
    expect(resolutionItem({ handled: 4, resolved: 2 }, 1)).toMatchObject({
      rate: 0.5,
      costPerResolutionUsd: 0.5,
    })
  })

  it('links each surface (chats only for their owner)', () => {
    const ctx = context()
    expect(linkFor(row(), ctx, VIEWER)).toEqual({
      kind: 'chat',
      conversationId: 'c1',
    })
    expect(linkFor(row(), ctx, 'someone')).toBeNull()
    expect(
      linkFor(row({ surface: 'STEEL_AGENT_RUN', targetId: 'r1' }), ctx, VIEWER),
    ).toEqual({ kind: 'agent_run', agentId: 'a1', runId: 'r1' })
    expect(
      linkFor(
        row({ surface: 'STEEL_AGENT_RUN', targetId: 'gone' }),
        ctx,
        VIEWER,
      ),
    ).toBeNull()
    expect(
      linkFor(row({ surface: 'SD_TRIAGE', targetId: 't1' }), ctx, VIEWER),
    ).toEqual({ kind: 'ticket', ticketNumber: 42 })
    expect(
      linkFor(row({ surface: 'SD_COPILOT', targetId: 'gone' }), ctx, VIEWER),
    ).toBeNull()
    expect(
      linkFor(row({ surface: 'SD_KCS_DRAFT', targetId: 'k1' }), ctx, VIEWER),
    ).toEqual({ kind: 'kb_article', articleId: 'k1' })
    expect(
      linkFor(row({ surface: 'SD_KCS_DRAFT', targetId: 'gone' }), ctx, VIEWER),
    ).toBeNull()
    expect(
      linkFor(
        row({ surface: 'WHATSAPP_AUTO_REPLY', targetId: 'w1' }),
        ctx,
        VIEWER,
      ),
    ).toEqual({ kind: 'whatsapp', conversationId: 'wc1' })
    expect(
      linkFor(
        row({ surface: 'WHATSAPP_AUTO_REPLY', targetId: 'gone' }),
        ctx,
        VIEWER,
      ),
    ).toBeNull()
  })

  it('maps a worst item with or without who rated', () => {
    const ctx = context()
    expect(toAiQualityWorstItemDTO(row(), ctx, VIEWER, true)).toMatchObject({
      surfaceLabel: 'Chat do Steel AI',
      reasonLabel: 'Informação errada',
      modelLabel: 'GPT-4o mini',
      userName: 'Ana',
    })
    const bare = toAiQualityWorstItemDTO(
      row({ reason: null, modelKey: null, userName: null }),
      ctx,
      VIEWER,
      true,
    )
    expect(bare).toMatchObject({
      reasonLabel: null,
      modelLabel: null,
      userName: 'Usuário removido',
    })
    expect(
      toAiQualityWorstItemDTO(row({ reason: 'legacy' }), ctx, VIEWER, false),
    ).toMatchObject({ reasonLabel: 'legacy', userName: null })
  })

  it('builds the panel DTO with a zero-filled daily series', () => {
    const dto = toAiQualityDTO({
      query: { scope: 'workspace', period: 'custom' },
      range: {
        from: new Date('2026-10-01T00:00:00.000Z'),
        to: new Date('2026-10-04T00:00:00.000Z'),
      },
      canViewWorkspace: true,
      groups: [
        {
          surface: 'STEEL_AI_MESSAGE',
          modelKey: 'openai:gpt-4o-mini',
          rating: 'UP',
          count: 3,
        },
        {
          surface: 'STEEL_AI_MESSAGE',
          modelKey: null,
          rating: 'DOWN',
          count: 1,
        },
        {
          surface: 'WHATSAPP_AUTO_REPLY',
          modelKey: null,
          rating: 'DOWN',
          count: 2,
        },
        { surface: 'SD_TRIAGE', modelKey: null, rating: 'UP', count: 2 },
      ],
      daily: [{ day: '2026-10-02', up: 1, down: 1 }],
      resolution: null,
      worst: [],
    })
    expect(dto.totals).toEqual({
      up: 5,
      down: 3,
      total: 8,
      approvalRate: 5 / 8,
    })
    expect(dto.bySurface.map((s) => s.key)).toEqual([
      'STEEL_AI_MESSAGE',
      'SD_TRIAGE',
      'WHATSAPP_AUTO_REPLY',
    ])
    expect(dto.byModel.map((m) => m.label)).toEqual([
      AI_QUALITY_NO_MODEL_LABEL,
      'GPT-4o mini',
    ])
    expect(dto.daily).toEqual([
      { date: '2026-10-01', up: 0, down: 0, approvalRate: null },
      { date: '2026-10-02', up: 1, down: 1, approvalRate: 0.5 },
      { date: '2026-10-03', up: 0, down: 0, approvalRate: null },
    ])
  })

  it('writes CSV rows (formula-safe) and hides people in the personal view', () => {
    const line = toAiQualityCsvRow(row(), true)
    expect(line).toContain('Ana')
    expect(line).toContain("'=SOMA(1)")
    expect(line).toContain('negativa')
    const personal = toAiQualityCsvRow(
      row({ rating: 'UP', reason: null, modelKey: null, userName: null }),
      false,
    )
    expect(personal).not.toContain('Ana')
    expect(personal).toContain('positiva')
    expect(toAiQualityCsvRow(row({ userName: null }), true)).toContain(
      'Usuário removido',
    )
    expect(
      toAiQualityAggregateCsvRow({
        key: '',
        label: 'Sem modelo',
        up: 1,
        down: 2,
        total: 3,
        approvalRate: 1 / 3,
      }),
    ).toBe(',Sem modelo,1,2,3,33.3\r\n')
    expect(
      toAiQualityAggregateCsvRow({
        key: 'k',
        label: 'L',
        up: 0,
        down: 0,
        total: 0,
        approvalRate: null,
      }),
    ).toBe('k,L,0,0,0,\r\n')
  })
})

describe('ai-eval mapper', () => {
  it('maps runs by status, model and reason', () => {
    const done = toAiEvalRunDTO(
      createFakeAiEvalRunWithUser({
        status: 'DONE',
        caseCount: 4,
        passedCount: 3,
        modelKey: 'openai:gpt-4o-mini',
        promptOverride: 'rascunho',
        reason: 'model_change',
        startedAt: new Date('2026-10-18T12:00:00.000Z'),
        finishedAt: new Date('2026-10-18T12:01:00.000Z'),
      }),
    )
    expect(done).toMatchObject({
      passRate: 0.75,
      modelLabel: 'GPT-4o mini',
      hasPromptOverride: true,
      reason: 'model_change',
      startedBy: { id: 'user_1', name: 'Ana' },
      finishedAt: '2026-10-18T12:01:00.000Z',
    })
    const queued = toAiEvalRunDTO(
      createFakeAiEvalRunWithUser({
        modelKey: 'acme:x',
        reason: 'legacy',
        startedBy: null,
      }),
    )
    expect(queued).toMatchObject({
      passRate: null,
      modelLabel: 'acme:x',
      reason: 'manual',
      startedBy: null,
      startedAt: null,
    })
    expect(
      toAiEvalRunDTO(
        createFakeAiEvalRunWithUser({ status: 'FAILED', caseCount: 0 }),
      ).passRate,
    ).toBeNull()
    expect(
      toAiEvalRunDTO(createFakeAiEvalRunWithUser({ modelKey: null }))
        .modelLabel,
    ).toBeNull()
  })

  it('maps results, cases and sets', () => {
    const result = createFakeAiEvalResult()
    expect(toAiEvalResultDTO(result)).toMatchObject({
      id: result.id,
      costUsd: 0.001,
    })
    const detail = toAiEvalRunDetailDTO(createFakeAiEvalRunWithResults())
    expect(detail.results).toHaveLength(1)
    const testCase = createFakeAiEvalCase()
    expect(toAiEvalCaseDTO(testCase).createdAt).toBe(
      testCase.createdAt.toISOString(),
    )
    const set = toAiEvalSetDTO(
      createFakeAiEvalSetSummary({
        target: 'WHATSAPP_REPLY',
        lastRun: createFakeAiEvalRunWithUser(),
      }),
    )
    expect(set.targetLabel).toBe('Resposta automática do WhatsApp')
    expect(set.lastRun).not.toBeNull()
    expect(
      toAiEvalSetDetailDTO(createFakeAiEvalSetWithCases()).cases,
    ).toHaveLength(1)
  })
})
