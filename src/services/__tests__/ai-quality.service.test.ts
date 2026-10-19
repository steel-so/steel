import { beforeEach, describe, expect, it, vi } from 'vitest'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError, forbidden } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/repositories/ai-quality.repository')
vi.mock('@/src/services/authz', () => ({ assertMember: vi.fn() }))
vi.mock('@/lib/axiom/audit', () => ({ auditMutation: vi.fn() }))

import { auditMutation } from '@/lib/axiom/audit'
import {
  type AiQualityFeedbackRow,
  AiQualityRepository,
} from '@/src/repositories/ai-quality.repository'
import { assertMember } from '@/src/services/authz'
import {
  AI_QUALITY_EXPORT_PAGE_SIZE,
  AiQualityService,
} from '../ai-quality.service'

const repo = vi.mocked(AiQualityRepository)
const member = vi.mocked(assertMember)
const audit = vi.mocked(auditMutation)

const ACTOR = 'user_1'
const WS = 'ws_1'
const NOW = new Date('2026-10-18T12:00:00.000Z')

function asRole(isPrivileged: boolean) {
  member.mockResolvedValue(
    ok({
      role: isPrivileged ? 'ADMIN' : 'MEMBER',
      isPrivileged,
      permissions: null,
    }) as never,
  )
}

function feedback(id: string): AiQualityFeedbackRow {
  return {
    id,
    surface: 'STEEL_AI_MESSAGE',
    targetId: `m_${id}`,
    variant: '',
    rating: 'DOWN',
    reason: 'incorrect',
    comment: null,
    modelKey: 'openai:gpt-4o-mini',
    userId: ACTOR,
    userName: 'Ana',
    userEmail: 'ana@x.com',
    createdAt: new Date('2026-10-05T10:00:00.000Z'),
  }
}

const EMPTY_LINKS = {
  chats: new Map(),
  agentRuns: new Map(),
  tickets: new Map(),
  articles: new Set<string>(),
  whatsapp: new Map(),
}

async function collect(chunks: AsyncGenerator<string>): Promise<string> {
  let out = ''
  for await (const chunk of chunks) out += chunk
  return out
}

beforeEach(() => {
  vi.clearAllMocks()
  asRole(false)
  repo.groupRatings.mockResolvedValue(
    ok([
      {
        surface: 'STEEL_AI_MESSAGE',
        modelKey: 'openai:gpt-4o-mini',
        rating: 'UP',
        count: 3,
      },
      {
        surface: 'STEEL_AI_MESSAGE',
        modelKey: 'openai:gpt-4o-mini',
        rating: 'DOWN',
        count: 1,
      },
    ]),
  )
  repo.dailyRatings.mockResolvedValue(ok([]))
  repo.latestDown.mockResolvedValue(ok([feedback('f1')]))
  repo.linkContext.mockResolvedValue(ok(EMPTY_LINKS))
  repo.whatsappResolution.mockResolvedValue(ok({ handled: 4, resolved: 3 }))
  repo.servicedeskResolution.mockResolvedValue(ok({ handled: 2, resolved: 1 }))
  repo.featureCosts.mockResolvedValue(
    ok({ WHATSAPP_REPLY: 0.6, SERVICEDESK_PRE_SERVICE: 0.2 }),
  )
})

describe('AiQualityService.quality', () => {
  it('builds the personal view from the actor ratings only', async () => {
    const dto = expectOk(
      await AiQualityService.quality(
        ACTOR,
        WS,
        { scope: 'personal', period: 'this_month' },
        NOW,
      ),
    )
    expect(dto.totals).toMatchObject({ total: 4, approvalRate: 0.75 })
    expect(dto.resolution).toBeNull()
    expect(dto.worst[0].userName).toBeNull()
    expect(repo.groupRatings).toHaveBeenCalledWith(WS, expect.anything(), ACTOR)
    expect(repo.whatsappResolution).not.toHaveBeenCalled()
  })

  it('adds the resolutions and who rated in the workspace view', async () => {
    asRole(true)
    const dto = expectOk(
      await AiQualityService.quality(
        ACTOR,
        WS,
        { scope: 'workspace', period: 'last_30_days' },
        NOW,
      ),
    )
    expect(repo.groupRatings).toHaveBeenCalledWith(
      WS,
      expect.anything(),
      undefined,
    )
    expect(dto.canViewWorkspace).toBe(true)
    expect(dto.worst[0].userName).toBe('Ana')
    expect(dto.resolution?.whatsapp).toMatchObject({ handled: 4, resolved: 3 })
    expect(dto.resolution?.whatsapp.costPerResolutionUsd).toBeCloseTo(0.2)
    expect(dto.resolution?.total).toMatchObject({ handled: 6, resolved: 4 })
    expect(dto.resolution?.total.costUsd).toBeCloseTo(0.8)
  })

  it('treats missing feature costs as zero', async () => {
    asRole(true)
    repo.featureCosts.mockResolvedValueOnce(ok({}))
    const dto = expectOk(
      await AiQualityService.quality(ACTOR, WS, {
        scope: 'workspace',
        period: 'this_month',
      }),
    )
    expect(dto.resolution?.total.costUsd).toBe(0)
  })

  it('keeps the workspace view for owners and admins', async () => {
    expectErr(
      await AiQualityService.quality(ACTOR, WS, {
        scope: 'workspace',
        period: 'this_month',
      }),
      'FORBIDDEN',
    )
    member.mockResolvedValueOnce(err(forbidden()) as never)
    expectErr(
      await AiQualityService.quality(ACTOR, WS, {
        scope: 'personal',
        period: 'this_month',
      }),
      'FORBIDDEN',
    )
  })

  it.each([
    'groupRatings',
    'dailyRatings',
    'latestDown',
    'linkContext',
    'whatsappResolution',
    'servicedeskResolution',
    'featureCosts',
  ] as const)('propagates a %s failure', async (method) => {
    asRole(true)
    repo[method].mockResolvedValueOnce(err(databaseError('x')) as never)
    expectErr(
      await AiQualityService.quality(ACTOR, WS, {
        scope: 'workspace',
        period: 'this_month',
      }),
      'DATABASE_ERROR',
    )
  })
})

describe('AiQualityService.exportCsv', () => {
  it('streams the feedback rows page by page and audits', async () => {
    asRole(true)
    const fullPage = Array.from(
      { length: AI_QUALITY_EXPORT_PAGE_SIZE },
      (_, i) => feedback(`f${i}`),
    )
    repo.exportPage
      .mockResolvedValueOnce(ok(fullPage))
      .mockResolvedValueOnce(ok([feedback('last')]))
    const result = expectOk(
      await AiQualityService.exportCsv(
        ACTOR,
        WS,
        { scope: 'workspace', period: 'this_month', view: 'feedback' },
        NOW,
      ),
    )
    expect(result.filename).toBe(
      'steel-ai-qualidade-workspace-feedback-2026-10-01_2026-10-18.csv',
    )
    const csv = await collect(result.chunks)
    expect(csv.startsWith('﻿data_utc')).toBe(true)
    expect(csv).toContain('Ana')
    expect(repo.exportPage).toHaveBeenLastCalledWith(WS, expect.anything(), {
      userId: undefined,
      cursor: `f${AI_QUALITY_EXPORT_PAGE_SIZE - 1}`,
      take: AI_QUALITY_EXPORT_PAGE_SIZE,
    })
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ entity: 'ai_quality', action: 'download' }),
    )
  })

  it('exports only the actor rows without names in the personal view', async () => {
    repo.exportPage.mockResolvedValueOnce(ok([]))
    const result = expectOk(
      await AiQualityService.exportCsv(
        ACTOR,
        WS,
        { scope: 'personal', period: 'this_month', view: 'feedback' },
        NOW,
      ),
    )
    expect(result.filename).toContain('pessoal')
    const csv = await collect(result.chunks)
    expect(csv.trim().split('\r\n')).toHaveLength(1)
    expect(repo.exportPage).toHaveBeenCalledWith(WS, expect.anything(), {
      userId: ACTOR,
      cursor: undefined,
      take: AI_QUALITY_EXPORT_PAGE_SIZE,
    })
  })

  it('aborts the stream when a page fails', async () => {
    repo.exportPage.mockResolvedValueOnce(err(databaseError('boom')))
    const result = expectOk(
      await AiQualityService.exportCsv(ACTOR, WS, {
        scope: 'personal',
        period: 'this_month',
        view: 'feedback',
      }),
    )
    await expect(collect(result.chunks)).rejects.toThrow('boom')
  })

  it('exports the totals per surface and per model', async () => {
    const surface = expectOk(
      await AiQualityService.exportCsv(ACTOR, WS, {
        scope: 'personal',
        period: 'this_month',
        view: 'surface',
      }),
    )
    expect(await collect(surface.chunks)).toContain('Chat do Steel AI,3,1,4,75')
    const model = expectOk(
      await AiQualityService.exportCsv(ACTOR, WS, {
        scope: 'personal',
        period: 'this_month',
        view: 'model',
      }),
    )
    expect(await collect(model.chunks)).toContain('GPT-4o mini')
    repo.groupRatings.mockResolvedValueOnce(ok([]))
    const empty = expectOk(
      await AiQualityService.exportCsv(ACTOR, WS, {
        scope: 'personal',
        period: 'this_month',
        view: 'model',
      }),
    )
    expect((await collect(empty.chunks)).trim().split('\r\n')).toHaveLength(1)
  })

  it('denies the workspace export to members and propagates errors', async () => {
    expectErr(
      await AiQualityService.exportCsv(ACTOR, WS, {
        scope: 'workspace',
        period: 'this_month',
        view: 'feedback',
      }),
      'FORBIDDEN',
    )
    repo.groupRatings.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await AiQualityService.exportCsv(ACTOR, WS, {
        scope: 'personal',
        period: 'this_month',
        view: 'surface',
      }),
      'DATABASE_ERROR',
    )
    expect(audit).not.toHaveBeenCalled()
  })
})
