import { describe, expect, it } from 'vitest'
import {
  createFakeCrmProspectDraft,
  createFakeCrmProspectingSettings,
  createFakeCrmProspectUsage,
} from '@/src/__tests__/factories/nov-prospecting-agent.factory'
import {
  DEFAULT_DRAFT_LIMIT,
  DEFAULT_WEB_LIMIT,
  parseSignals,
  parseSources,
  toCrmProspectDraftDTO,
  toCrmProspectingSettingsDTO,
  toCrmProspectingUsageDTO,
} from '../crm-prospecting.mapper'

describe('toCrmProspectDraftDTO()', () => {
  it('should map the row with labelled signals and ISO dates', () => {
    const decidedAt = new Date('2026-11-02T10:00:00Z')
    const row = createFakeCrmProspectDraft({
      status: 'APPROVED',
      decidedAt,
      decidedById: 'u2',
    })
    const dto = toCrmProspectDraftDTO(row)
    expect(dto.id).toBe(row.id)
    expect(dto.status).toBe('APPROVED')
    expect(dto.decidedAt).toBe('2026-11-02T10:00:00.000Z')
    expect(dto.createdAt).toBe(row.createdAt.toISOString())
    expect(dto.signals).toEqual([
      {
        type: 'HIRING',
        label: 'Contratando',
        evidence: 'Estamos contratando analistas de infraestrutura',
        sourceUrl: 'https://acme.com.br/vagas',
      },
    ])
    expect(dto.sources).toEqual([
      { url: 'https://acme.com.br/vagas', title: 'Vagas' },
    ])
  })

  it('should keep nulls for an undecided draft', () => {
    const dto = toCrmProspectDraftDTO(createFakeCrmProspectDraft())
    expect(dto.decidedAt).toBeNull()
    expect(dto.rejectReason).toBeNull()
  })
})

describe('parseSignals() and parseSources()', () => {
  it('should survive bad JSON', () => {
    expect(parseSignals(null)).toEqual([])
    expect(parseSignals('x')).toEqual([])
    expect(
      parseSignals([
        null,
        { type: 'NOPE', evidence: 'x' },
        { type: 'HIRING', evidence: 12 },
        { type: 'FUNDING', evidence: 'Série A' },
      ]),
    ).toEqual([
      {
        type: 'FUNDING',
        label: 'Investimento ou rodada',
        evidence: 'Série A',
        sourceUrl: null,
      },
    ])
    expect(parseSources({})).toEqual([])
    expect(
      parseSources([1, { url: 5 }, { url: 'https://a.com', title: 3 }]),
    ).toEqual([{ url: 'https://a.com', title: null }])
  })
})

describe('toCrmProspectingSettingsDTO()', () => {
  it('should be off with default limits when there is no row', () => {
    expect(toCrmProspectingSettingsDTO(null, false)).toEqual({
      enabled: false,
      monthlyWebLimit: DEFAULT_WEB_LIMIT,
      monthlyDraftLimit: DEFAULT_DRAFT_LIMIT,
      allowedChannels: ['EMAIL', 'WHATSAPP'],
      valueProposition: null,
      signalKeywords: [],
      searchAvailable: false,
      updatedAt: null,
    })
  })

  it('should map a saved row', () => {
    const row = createFakeCrmProspectingSettings({
      signalKeywords: ['pabx'],
      allowedChannels: ['EMAIL'],
    })
    const dto = toCrmProspectingSettingsDTO(row, true)
    expect(dto.enabled).toBe(true)
    expect(dto.searchAvailable).toBe(true)
    expect(dto.allowedChannels).toEqual(['EMAIL'])
    expect(dto.signalKeywords).toEqual(['pabx'])
    expect(dto.updatedAt).toBe(row.updatedAt.toISOString())
  })
})

describe('toCrmProspectingUsageDTO()', () => {
  const period = new Date(Date.UTC(2026, 10, 1))

  it('should be zero without a row', () => {
    expect(
      toCrmProspectingUsageDTO(null, period, { web: 300, draft: 100 }),
    ).toEqual({
      period: period.toISOString(),
      searches: 0,
      fetches: 0,
      drafts: 0,
      webLimit: 300,
      draftLimit: 100,
    })
  })

  it('should carry the counters', () => {
    const row = createFakeCrmProspectUsage({
      searches: 4,
      fetches: 9,
      drafts: 2,
    })
    expect(
      toCrmProspectingUsageDTO(row, period, { web: 10, draft: 5 }),
    ).toMatchObject({ searches: 4, fetches: 9, drafts: 2, webLimit: 10 })
  })
})
