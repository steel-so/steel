import { describe, expect, it } from 'vitest'
import {
  toSpendCategories,
  toWhatsAppSpendCapStatusDTO,
} from '../whatsapp-spend-cap.mapper'

const connection = { id: 'c1', label: 'Fidelizza+', phoneNumber: '5511999' }
const NOW = new Date('2026-11-11T15:00:00Z')

function snapshot(cost: number, source: 'META_COST' | 'META_VOLUME') {
  return {
    cost: cost as never,
    currency: 'BRL',
    source,
    byCategory: [
      { category: 'MARKETING', volume: 496, billableVolume: 496, cost: 159.56 },
    ],
    fetchedAt: new Date('2026-11-11T14:58:00Z'),
    periodEnd: new Date('2026-11-11T00:00:00Z'),
  }
}

describe('toSpendCategories()', () => {
  it('labels known categories and tolerates malformed rows', () => {
    expect(
      toSpendCategories([
        { category: 'SERVICE', volume: 5, billableVolume: 0, cost: 0 },
        { category: 'NEW_ONE', volume: 'x', cost: 1.234 },
        { volume: 1 },
        null,
        'oops',
      ]),
    ).toEqual([
      {
        category: 'SERVICE',
        label: 'Atendimento (janela de 24 h)',
        volume: 5,
        billableVolume: 0,
        cost: 0,
      },
      {
        category: 'NEW_ONE',
        label: 'NEW_ONE',
        volume: 0,
        billableVolume: 0,
        cost: 1.23,
      },
      {
        category: 'OTHER',
        label: 'OTHER',
        volume: 1,
        billableVolume: 0,
        cost: 0,
      },
    ])
    expect(toSpendCategories({})).toEqual([])
  })
})

describe('toWhatsAppSpendCapStatusDTO()', () => {
  it('adds Meta and the ledger and projects the month', () => {
    const dto = toWhatsAppSpendCapStatusDTO({
      connection,
      cap: { monthlyCapAmount: 1500 as never, capMode: 'BLOCK' },
      snapshot: snapshot(1100, 'META_VOLUME'),
      ledgerSpent: 120,
      period: '2026-11',
      now: NOW,
    })
    expect(dto).toMatchObject({
      connectionId: 'c1',
      spent: 1220,
      metaSpent: 1100,
      ledgerSpent: 120,
      source: 'META_VOLUME',
      monthlyCapAmount: 1500,
      capMode: 'BLOCK',
      percent: 81,
      level: 80,
      status: 'ALLOWED',
      daysElapsed: 11,
      daysInMonth: 30,
      projection: 3327.27,
      fetchedAt: '2026-11-11T14:58:00.000Z',
      metaPeriodEnd: '2026-11-11T00:00:00.000Z',
      stale: false,
      staleReason: null,
    })
    expect(dto.byCategory[0].label).toBe('Marketing')
  })

  it('reports BLOCKED once a BLOCK cap is reached, but never for WARN', () => {
    const base = {
      connection,
      snapshot: snapshot(1500, 'META_COST'),
      ledgerSpent: 0,
      period: '2026-11',
      now: NOW,
    }
    expect(
      toWhatsAppSpendCapStatusDTO({
        ...base,
        cap: { monthlyCapAmount: 1500 as never, capMode: 'BLOCK' },
      }),
    ).toMatchObject({ status: 'BLOCKED', level: 100, percent: 100 })
    expect(
      toWhatsAppSpendCapStatusDTO({
        ...base,
        cap: { monthlyCapAmount: 1500 as never, capMode: 'WARN' },
      }),
    ).toMatchObject({ status: 'ALLOWED', level: 100 })
  })

  it('falls back to the ledger without a snapshot or a cap', () => {
    const dto = toWhatsAppSpendCapStatusDTO({
      connection,
      cap: null,
      snapshot: null,
      ledgerSpent: 3.5,
      period: '2026-11',
      now: NOW,
      stale: true,
      staleReason: 'Meta fora',
    })
    expect(dto).toMatchObject({
      source: 'STEEL_LEDGER',
      currency: 'BRL',
      spent: 3.5,
      monthlyCapAmount: null,
      capMode: null,
      percent: null,
      level: null,
      status: 'NO_CAP',
      fetchedAt: null,
      metaPeriodEnd: null,
      byCategory: [],
      stale: true,
      staleReason: 'Meta fora',
    })
  })

  it('counts a past month as complete and a zero cap without percent', () => {
    const dto = toWhatsAppSpendCapStatusDTO({
      connection,
      cap: { monthlyCapAmount: 0 as never, capMode: 'WARN' },
      snapshot: null,
      ledgerSpent: 31,
      period: '2026-10',
      now: NOW,
    })
    expect(dto).toMatchObject({
      daysElapsed: 31,
      daysInMonth: 31,
      projection: 31,
      percent: null,
    })
  })
})
