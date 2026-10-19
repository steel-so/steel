import { describe, expect, it } from 'vitest'
import {
  atClock,
  clockIn,
  dayKeyIn,
  duration,
  hourIn,
  minutesBetween,
  money,
  percent,
  plural,
  safeTimeZone,
  score,
} from '@/src/lib/ai/proactive/format'
import {
  AI_INSIGHT_KIND_LABELS,
  AI_INSIGHT_KINDS,
} from '@/src/lib/ai/proactive/labels'

// 23:30 in São Paulo, 02:30 UTC the next day.
const NOW = new Date('2026-10-19T02:30:00.000Z')
const TZ = 'America/Sao_Paulo'

describe('proactive AI formatting', () => {
  it('reads the day and hour in the record time zone, not the host', () => {
    expect(dayKeyIn(NOW, TZ)).toBe('2026-10-18')
    expect(dayKeyIn(NOW, 'UTC')).toBe('2026-10-19')
    expect(hourIn(NOW, TZ)).toBe(23)
    expect(dayKeyIn(NOW, 'Not/AZone')).toBe('2026-10-19')
    expect(hourIn(NOW, 'Not/AZone')).toBe(2)
  })

  it('validates time zones', () => {
    expect(safeTimeZone('Europe/Lisbon', TZ)).toBe('Europe/Lisbon')
    expect(safeTimeZone('Not/AZone', TZ)).toBe(TZ)
    expect(safeTimeZone(null, TZ)).toBe(TZ)
  })

  it('writes clock times, saying "amanhã" past local midnight', () => {
    const later = new Date(NOW.getTime() + 15 * 60_000)
    const tomorrow = new Date(NOW.getTime() + 60 * 60_000)
    expect(clockIn(later, NOW, TZ)).toBe('23:45')
    expect(atClock(later, NOW, TZ)).toBe('às 23:45')
    expect(clockIn(tomorrow, NOW, TZ)).toBe('amanhã às 00:30')
    expect(atClock(tomorrow, NOW, TZ)).toBe('amanhã às 00:30')
    expect(clockIn(later, NOW, 'Not/AZone')).toBe('02:45')
  })

  it('formats money, scores, durations and percentages in pt-BR', () => {
    expect(money(12500).replace(/ /g, ' ')).toBe('R$ 12.500,00')
    expect(score(-0.625)).toBe('-0,63')
    expect(duration(45)).toBe('45 min')
    expect(duration(120)).toBe('2 h')
    expect(duration(130)).toBe('2 h 10 min')
    expect(duration(3 * 24 * 60)).toBe('3 dias')
    expect(minutesBetween(NOW, new Date(NOW.getTime() + 90_000))).toBe(1)
    expect(minutesBetween(new Date(NOW.getTime() + 90_000), NOW)).toBe(0)
    expect(percent(60, 100)).toBe(60)
    expect(percent(1, 0)).toBe(0)
    expect(plural(1, 'chamado', 'chamados')).toBe('1 chamado')
    expect(plural(2, 'chamado', 'chamados')).toBe('2 chamados')
  })

  it('labels every insight kind', () => {
    for (const kind of AI_INSIGHT_KINDS) {
      expect(AI_INSIGHT_KIND_LABELS[kind]).toMatch(/\S/)
    }
  })
})
