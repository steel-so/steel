import { describe, expect, it } from 'vitest'
import {
  emptyVersionStats,
  evaluateGate,
  normalizeVersionTools,
  parseVersionTools,
  pickVersionId,
  summarizeVersionStats,
  versionContentChanged,
} from '../steel-agents/versions'

const content = {
  instructions: 'Faça a triagem',
  maxToolRounds: 8,
  tools: [
    { toolName: 'b_tool', mode: 'AUTO' as const },
    { toolName: 'a_tool', mode: 'APPROVAL' as const },
  ],
}

describe('normalizeVersionTools / parseVersionTools', () => {
  it('should sort tools by name', () => {
    expect(normalizeVersionTools(content.tools).map((t) => t.toolName)).toEqual(
      ['a_tool', 'b_tool'],
    )
  })

  it('should read the JSON column defensively', () => {
    expect(parseVersionTools('nope')).toEqual([])
    expect(
      parseVersionTools([
        null,
        'x',
        { toolName: 1, mode: 'AUTO' },
        { toolName: 'ok', mode: 'WEIRD' },
        { toolName: 'z', mode: 'AUTO' },
        { toolName: 'a', mode: 'APPROVAL' },
      ]),
    ).toEqual([
      { toolName: 'a', mode: 'APPROVAL' },
      { toolName: 'z', mode: 'AUTO' },
    ])
  })
})

describe('versionContentChanged', () => {
  it('should ignore tool order', () => {
    expect(
      versionContentChanged(content, {
        ...content,
        tools: [...content.tools].reverse(),
      }),
    ).toBe(false)
  })

  it('should detect instructions, rounds, tools and mode changes', () => {
    expect(
      versionContentChanged(content, { ...content, instructions: 'Outra' }),
    ).toBe(true)
    expect(
      versionContentChanged(content, { ...content, maxToolRounds: 9 }),
    ).toBe(true)
    expect(
      versionContentChanged(content, {
        ...content,
        tools: content.tools.slice(0, 1),
      }),
    ).toBe(true)
    expect(
      versionContentChanged(content, {
        ...content,
        tools: [
          { toolName: 'a_tool', mode: 'AUTO' },
          { toolName: 'b_tool', mode: 'AUTO' },
        ],
      }),
    ).toBe(true)
    expect(
      versionContentChanged(content, {
        ...content,
        tools: [
          { toolName: 'a_tool', mode: 'APPROVAL' },
          { toolName: 'c_tool', mode: 'AUTO' },
        ],
      }),
    ).toBe(true)
  })
})

describe('evaluateGate', () => {
  it('should pass at or above the minimum rate', () => {
    expect(
      evaluateGate({ passedCases: 8, failedCases: 2, minPassRate: 0.8 }),
    ).toEqual({ passed: true, total: 10, passedCases: 8, rate: 0.8 })
    expect(
      evaluateGate({ passedCases: 7, failedCases: 3, minPassRate: 0.8 }).passed,
    ).toBe(false)
  })

  it('should never pass when nothing was graded', () => {
    expect(
      evaluateGate({ passedCases: 0, failedCases: 0, minPassRate: 0.1 }),
    ).toEqual({ passed: false, total: 0, passedCases: 0, rate: 0 })
  })
})

describe('pickVersionId', () => {
  const challenger = { id: 'v2', percent: 30 }

  it('should send the configured share to the challenger', () => {
    expect(
      pickVersionId({ publishedId: 'v1', challenger, random: () => 0.29 }),
    ).toBe('v2')
    expect(
      pickVersionId({ publishedId: 'v1', challenger, random: () => 0.3 }),
    ).toBe('v1')
  })

  it('should use the published version without a challenger', () => {
    expect(pickVersionId({ publishedId: 'v1', challenger: null })).toBe('v1')
    expect(pickVersionId({ publishedId: null, challenger: null })).toBeNull()
  })

  it('should fall back to Math.random', () => {
    const picked = pickVersionId({ publishedId: 'v1', challenger })
    expect(['v1', 'v2']).toContain(picked)
  })
})

describe('summarizeVersionStats', () => {
  it('should aggregate runs and approvals per version', () => {
    const stats = summarizeVersionStats(
      [
        { versionId: 'v1', status: 'SUCCEEDED', costUsd: 0.2, rounds: 2 },
        { versionId: 'v1', status: 'FAILED', costUsd: 0.4, rounds: 4 },
        { versionId: 'v1', status: 'SKIPPED', costUsd: 0, rounds: 0 },
        { versionId: 'v1', status: 'RUNNING', costUsd: 0, rounds: 0 },
        { versionId: 'v2', status: 'SUCCEEDED', costUsd: 0.1, rounds: 1 },
      ],
      [
        { versionId: 'v1', status: 'EXECUTED' },
        { versionId: 'v1', status: 'FAILED' },
        { versionId: 'v1', status: 'CANCELED' },
        { versionId: 'v1', status: 'EXPIRED' },
        { versionId: 'v1', status: 'PENDING' },
        { versionId: 'v3', status: 'CANCELED' },
      ],
    )
    const v1 = stats.get('v1')
    expect(v1).toMatchObject({
      runs: 4,
      succeeded: 1,
      failed: 1,
      skipped: 1,
      successRate: 0.5,
      approvalsDecided: 4,
      approvalsApproved: 2,
      approvalRate: 0.5,
    })
    expect(v1?.avgCostUsd).toBeCloseTo(0.3)
    expect(v1?.avgRounds).toBe(3)
    expect(stats.get('v2')?.successRate).toBe(1)
    expect(stats.get('v2')?.approvalRate).toBeNull()
    expect(stats.get('v3')).toMatchObject({
      runs: 0,
      successRate: null,
      avgCostUsd: null,
      approvalRate: 0,
    })
  })

  it('should return empty stats helper values', () => {
    expect(emptyVersionStats()).toMatchObject({ runs: 0, successRate: null })
    expect(summarizeVersionStats([], []).size).toBe(0)
  })
})
