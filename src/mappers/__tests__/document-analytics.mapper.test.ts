import { describe, expect, it } from 'vitest'
import {
  type DocumentAnalyticsRows,
  emptyDocumentTotals,
  REMOVED_SECTION_NAME,
  toDocumentAnalyticsDTO,
} from '../document-analytics.mapper'

function rows(
  overrides: Partial<DocumentAnalyticsRows> = {},
): DocumentAnalyticsRows {
  return {
    structure: [
      { id: 'sec-a', name: 'Introdução', index: 0 },
      { id: 'sec-b', name: 'Investimento', index: 1 },
    ],
    totals: {
      sessions: 4,
      uniqueVisitors: 3,
      totalActiveMs: 200_000,
      avgScrollPct: 71.6,
      reachedEnd: 1,
    },
    forwards: 2,
    sections: [
      { sectionId: 'sec-a', totalActiveMs: 90_000, readers: 4 },
      { sectionId: 'sec-b', totalActiveMs: 30_000, readers: 2 },
      { sectionId: 'old-1', totalActiveMs: 5_000, readers: 1 },
      { sectionId: 'old-2', totalActiveMs: 8_000, readers: 1 },
    ],
    devices: [
      { device: 'desktop', sessions: 2 },
      { device: 'mobile', sessions: 1 },
      { device: null, sessions: 1 },
      { device: 'tv', sessions: 1 },
    ],
    readers: [
      {
        recipientId: 'r1',
        name: 'Maria',
        visitorId: 'v1',
        sessions: 2,
        activeMs: 150_000,
        device: 'mobile',
        lastSeenAt: new Date('2026-11-11T12:00:00Z'),
      },
    ],
    daily: [{ date: '2026-11-10', sessions: 4, activeMs: 200_000 }],
    days: ['2026-11-09', '2026-11-10', '2026-11-11'],
    ...overrides,
  }
}

describe('toDocumentAnalyticsDTO', () => {
  it('derives averages, completion, revisits and forwards', () => {
    expect(toDocumentAnalyticsDTO(rows()).totals).toEqual({
      sessions: 4,
      uniqueVisitors: 3,
      totalActiveMs: 200_000,
      avgActiveMs: 50_000,
      avgScrollPct: 72,
      completionRate: 0.25,
      revisits: 1,
      forwards: 2,
    })
  })

  it('lists the current sections in order, then the removed ones', () => {
    const { sections } = toDocumentAnalyticsDTO(rows())
    expect(sections).toEqual([
      {
        id: 'sec-a',
        name: 'Introdução',
        index: 0,
        totalActiveMs: 90_000,
        avgActiveMs: 22_500,
        readers: 4,
        reachRate: 1,
      },
      {
        id: 'sec-b',
        name: 'Investimento',
        index: 1,
        totalActiveMs: 30_000,
        avgActiveMs: 15_000,
        readers: 2,
        reachRate: 0.5,
      },
      {
        id: 'old-2',
        name: REMOVED_SECTION_NAME,
        index: 2,
        totalActiveMs: 8_000,
        avgActiveMs: 8_000,
        readers: 1,
        reachRate: 0.25,
      },
      {
        id: 'old-1',
        name: REMOVED_SECTION_NAME,
        index: 3,
        totalActiveMs: 5_000,
        avgActiveMs: 5_000,
        readers: 1,
        reachRate: 0.25,
      },
    ])
  })

  it('buckets devices and fills every day of the period', () => {
    const dto = toDocumentAnalyticsDTO(rows())
    expect(dto.devices).toEqual({
      desktop: 2,
      tablet: 0,
      mobile: 1,
      unknown: 2,
    })
    expect(dto.daily).toEqual([
      { date: '2026-11-09', sessions: 0, activeMs: 0 },
      { date: '2026-11-10', sessions: 4, activeMs: 200_000 },
      { date: '2026-11-11', sessions: 0, activeMs: 0 },
    ])
    expect(dto.readers).toEqual([
      {
        recipientId: 'r1',
        name: 'Maria',
        visitorId: 'v1',
        sessions: 2,
        activeMs: 150_000,
        device: 'mobile',
        lastSeenAt: '2026-11-11T12:00:00.000Z',
      },
    ])
  })

  it('returns zeros without sessions, keeping the section names', () => {
    const dto = toDocumentAnalyticsDTO(
      rows({
        totals: emptyDocumentTotals(),
        forwards: 0,
        sections: [],
        devices: [],
        readers: [],
        daily: [],
        days: [],
      }),
    )
    expect(dto.totals).toEqual({
      sessions: 0,
      uniqueVisitors: 0,
      totalActiveMs: 0,
      avgActiveMs: 0,
      avgScrollPct: 0,
      completionRate: 0,
      revisits: 0,
      forwards: 0,
    })
    expect(dto.sections.map((s) => s.name)).toEqual([
      'Introdução',
      'Investimento',
    ])
    expect(dto.sections.map((s) => s.reachRate + s.avgActiveMs)).toEqual([0, 0])
    expect(dto.devices).toEqual({
      desktop: 0,
      tablet: 0,
      mobile: 0,
      unknown: 0,
    })
    expect(dto.daily).toEqual([])
  })

  it('never reports a reach above 100%', () => {
    const dto = toDocumentAnalyticsDTO(
      rows({
        totals: { ...emptyDocumentTotals(), sessions: 1, uniqueVisitors: 2 },
        sections: [{ sectionId: 'sec-a', totalActiveMs: 10, readers: 3 }],
      }),
    )
    expect(dto.sections[0].reachRate).toBe(1)
    expect(dto.totals.revisits).toBe(0)
  })
})
