import type { Role } from '@prisma/client'
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
import { documentContent } from '@/src/__tests__/factories/document-analytics.factory'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/document-analytics.repository')

import {
  DocumentAnalyticsRepository,
  type DocumentAnalyticsTarget,
} from '@/src/repositories/document-analytics.repository'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { WorkspaceModuleAccessRepository } from '@/src/repositories/workspace-module-access.repository'
import {
  analyticsDays,
  DocumentAnalyticsService,
  sectionsOfContent,
} from '../document-analytics.service'

const repo = vi.mocked(DocumentAnalyticsRepository)
const memberships = vi.mocked(MembershipRepository)
const moduleAccess = vi.mocked(WorkspaceModuleAccessRepository)

// 15:00 in São Paulo on 11/11.
const NOW = new Date('2026-11-11T18:00:00Z')

const content = documentContent([
  { id: 'sec-a', title: 'Introdução' },
  { id: 'sec-b', title: 'Investimento' },
])

function asRole(role: Role) {
  memberships.findByUserAndWorkspace.mockResolvedValue(
    ok(createFakeMembership({ role })),
  )
}

function target(
  overrides: Partial<DocumentAnalyticsTarget> = {},
): DocumentAnalyticsTarget {
  return {
    id: 'doc-1',
    isTemplate: false,
    content: {},
    currentVersionContent: content as never,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  asRole('VIEWER')
  moduleAccess.isEnabled.mockResolvedValue(ok(true))
  repo.findTarget.mockResolvedValue(ok(target()))
  repo.documentIdsFromTemplate.mockResolvedValue(ok(['doc-2', 'doc-3']))
  repo.totals.mockResolvedValue(
    ok({
      sessions: 2,
      uniqueVisitors: 1,
      totalActiveMs: 60_000,
      avgScrollPct: 80,
      reachedEnd: 1,
    }),
  )
  repo.forwards.mockResolvedValue(ok(0))
  repo.sections.mockResolvedValue(
    ok([{ sectionId: 'sec-a', totalActiveMs: 40_000, readers: 2 }]),
  )
  repo.devices.mockResolvedValue(ok([{ device: 'mobile', sessions: 2 }]))
  repo.readers.mockResolvedValue(ok([]))
  repo.daily.mockResolvedValue(
    ok([{ date: '2026-11-10', sessions: 2, activeMs: 60_000 }]),
  )
})

describe('DocumentAnalyticsService.get', () => {
  it('lets a VIEWER read the analytics of the current version', async () => {
    const dto = expectOk(
      await DocumentAnalyticsService.get(
        'u1',
        'ws1',
        'doc-1',
        { days: 'all' },
        NOW,
      ),
    )

    expect(repo.findTarget).toHaveBeenCalledWith('ws1', 'doc-1')
    expect(repo.totals).toHaveBeenCalledWith({
      documentIds: ['doc-1'],
      since: null,
    })
    expect(repo.daily).toHaveBeenCalledWith(
      { documentIds: ['doc-1'], since: null },
      'America/Sao_Paulo',
    )
    expect(dto.totals.revisits).toBe(1)
    expect(dto.sections.map((s) => [s.id, s.name, s.reachRate])).toEqual([
      ['sec-a', 'Introdução', 1],
      ['sec-b', 'Investimento', 0],
    ])
    expect(dto.devices.mobile).toBe(2)
    expect(dto.daily.map((d) => d.date)).toEqual(['2026-11-10', '2026-11-11'])
  })

  it('filters the period from local midnight in São Paulo', async () => {
    const dto = expectOk(
      await DocumentAnalyticsService.get(
        'u1',
        'ws1',
        'doc-1',
        { days: '7' },
        NOW,
      ),
    )
    expect(repo.totals).toHaveBeenCalledWith({
      documentIds: ['doc-1'],
      since: new Date('2026-11-05T03:00:00.000Z'),
    })
    expect(dto.daily).toHaveLength(7)
    expect(dto.daily[0].date).toBe('2026-11-05')
    expect(dto.daily[6].date).toBe('2026-11-11')
  })

  it('uses the draft when the document was never sent', async () => {
    repo.findTarget.mockResolvedValue(
      ok(target({ content: content as never, currentVersionContent: null })),
    )
    const dto = expectOk(
      await DocumentAnalyticsService.get('u1', 'ws1', 'doc-1', { days: 'all' }),
    )
    expect(dto.sections).toHaveLength(2)
  })

  it('sums the documents created from a template', async () => {
    repo.findTarget.mockResolvedValue(
      ok(
        target({
          id: 'tpl-1',
          isTemplate: true,
          content: content as never,
          currentVersionContent: null,
        }),
      ),
    )
    const dto = expectOk(
      await DocumentAnalyticsService.get('u1', 'ws1', 'tpl-1', { days: '30' }),
    )
    expect(repo.documentIdsFromTemplate).toHaveBeenCalledWith('ws1', 'tpl-1')
    expect(repo.totals.mock.calls[0][0].documentIds).toEqual(['doc-2', 'doc-3'])
    expect(dto.sections.map((s) => s.name)).toEqual([
      'Introdução',
      'Investimento',
    ])
  })

  it('answers zeros for a template nobody used yet', async () => {
    repo.findTarget.mockResolvedValue(
      ok(target({ isTemplate: true, content: content as never })),
    )
    repo.documentIdsFromTemplate.mockResolvedValue(ok([]))

    const dto = expectOk(
      await DocumentAnalyticsService.get(
        'u1',
        'ws1',
        'tpl-1',
        { days: '7' },
        NOW,
      ),
    )
    expect(repo.totals).not.toHaveBeenCalled()
    expect(dto.totals.sessions).toBe(0)
    expect(dto.sections).toHaveLength(2)
    expect(dto.daily).toHaveLength(7)
  })

  it('returns DOCUMENT_NOT_FOUND for another workspace or a deleted one', async () => {
    repo.findTarget.mockResolvedValue(ok(null))
    expectErr(
      await DocumentAnalyticsService.get('u1', 'ws1', 'x', { days: 'all' }),
      'DOCUMENT_NOT_FOUND',
    )
  })

  it('denies non-members and a disabled CRM', async () => {
    memberships.findByUserAndWorkspace.mockResolvedValue(ok(null))
    expectErr(
      await DocumentAnalyticsService.get('u1', 'ws1', 'doc-1', { days: 'all' }),
      'FORBIDDEN',
    )
    asRole('OWNER')
    moduleAccess.isEnabled.mockResolvedValue(ok(false))
    expectErr(
      await DocumentAnalyticsService.get('u1', 'ws1', 'doc-1', { days: 'all' }),
      'MODULE_DISABLED',
    )
    expect(repo.findTarget).not.toHaveBeenCalled()
  })

  it('denies a custom profile without the documents permission', async () => {
    memberships.findByUserAndWorkspace.mockResolvedValue(
      ok(
        createFakeMembership({
          role: 'MEMBER',
          profile: {
            id: 'p1',
            workspaceId: 'ws1',
            name: 'Sem documentos',
            isSystem: false,
            systemKey: null,
            permissions: { leads: ['VIEW'] },
            createdAt: new Date(),
            updatedAt: new Date(),
          } as never,
        }),
      ),
    )
    expectErr(
      await DocumentAnalyticsService.get('u1', 'ws1', 'doc-1', { days: 'all' }),
      'FORBIDDEN',
    )
  })

  it.each([
    'findTarget',
    'documentIdsFromTemplate',
    'totals',
    'forwards',
    'sections',
    'devices',
    'readers',
    'daily',
  ] as const)('propagates a database error from %s', async (method) => {
    repo.findTarget.mockResolvedValue(
      ok(target({ isTemplate: method === 'documentIdsFromTemplate' })),
    )
    const failing = repo[method] as unknown as Mock
    failing.mockResolvedValue(err(databaseError()))
    expectErr(
      await DocumentAnalyticsService.get('u1', 'ws1', 'doc-1', { days: 'all' }),
      'DATABASE_ERROR',
    )
  })
})

describe('helpers', () => {
  it('reads sections only from canvas documents', () => {
    expect(sectionsOfContent(content).map((s) => s.id)).toEqual([
      'sec-a',
      'sec-b',
    ])
    expect(sectionsOfContent(null)).toEqual([])
    expect(sectionsOfContent('x')).toEqual([])
    expect(sectionsOfContent({ rootId: 'r' })).toEqual([])
  })

  it('caps the all-time series at a year and needs a start', () => {
    expect(
      analyticsDays({ fromDay: null, firstDay: null, today: '2026-11-11' }),
    ).toEqual([])
    expect(
      analyticsDays({
        fromDay: null,
        firstDay: '2020-01-01',
        today: '2026-11-11',
      }),
    ).toHaveLength(366)
    expect(
      analyticsDays({
        fromDay: '2026-11-09',
        firstDay: '2026-11-10',
        today: '2026-11-11',
      }),
    ).toEqual(['2026-11-09', '2026-11-10', '2026-11-11'])
  })
})
