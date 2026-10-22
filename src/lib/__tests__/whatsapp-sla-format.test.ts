import { describe, expect, it } from 'vitest'
import {
  formatSlaCountdown,
  formatSlaSpan,
  matchesSlaFilter,
  slaChipView,
} from '@/src/lib/whatsapp/sla-format'
import type { WhatsAppSlaOpenCycleDTO } from '@/types/whatsapp-sla'

const now = new Date('2026-10-22T15:00:00Z')
const at = (minutes: number) =>
  new Date(now.getTime() + minutes * 60_000).toISOString()

function cycle(
  overrides?: Partial<WhatsAppSlaOpenCycleDTO>,
): WhatsAppSlaOpenCycleDTO {
  return {
    cycleId: 'c1',
    conversationId: 'conv1',
    startedAt: at(-10),
    firstResponse: {
      dueAt: at(5),
      warnAt: at(-2),
      doneAt: null,
      state: 'AT_RISK',
    },
    resolution: null,
    state: 'AT_RISK',
    ...overrides,
  }
}

describe('formatSlaSpan()', () => {
  it.each([
    [10_000, 'menos de 1 min'],
    [12 * 60_000, '12 min'],
    [65 * 60_000, '1 h 05 min'],
    [(2 * 24 + 3) * 3_600_000, '2 d 3 h'],
    [-12 * 60_000, '12 min'],
  ])('should format %d ms as %s', (ms, text) => {
    expect(formatSlaSpan(ms)).toBe(text)
  })
})

describe('formatSlaCountdown()', () => {
  it('should say when it is due and when it was', () => {
    expect(formatSlaCountdown(at(12), now)).toBe('vence em 12 min')
    expect(formatSlaCountdown(at(-5), now)).toBe('venceu há 5 min')
  })
})

describe('slaChipView()', () => {
  it('should show the first response while it is pending, with the state at now', () => {
    const view = slaChipView(cycle(), now)
    expect(view).toMatchObject({ label: '1ª resposta', state: 'AT_RISK' })
    expect(
      slaChipView(
        cycle({
          firstResponse: {
            dueAt: at(-1),
            warnAt: at(-8),
            doneAt: null,
            state: 'OK',
          },
        }),
        now,
      )?.state,
    ).toBe('BREACHED')
    expect(
      slaChipView(
        cycle({
          firstResponse: {
            dueAt: at(30),
            warnAt: at(20),
            doneAt: null,
            state: 'AT_RISK',
          },
        }),
        now,
      )?.state,
    ).toBe('OK')
  })

  it('should switch to the resolution once answered', () => {
    const answered = cycle({
      firstResponse: {
        dueAt: at(5),
        warnAt: at(-2),
        doneAt: at(-3),
        state: 'OK',
      },
      resolution: {
        dueAt: at(60),
        warnAt: at(40),
        doneAt: null,
        state: 'OK',
      },
    })
    expect(slaChipView(answered, now)).toMatchObject({
      label: 'Resolução',
      state: 'OK',
    })
  })

  it('should show nothing once answered when the resolution is not tracked', () => {
    expect(
      slaChipView(
        cycle({
          firstResponse: {
            dueAt: at(5),
            warnAt: at(-2),
            doneAt: at(-3),
            state: 'OK',
          },
        }),
        now,
      ),
    ).toBeNull()
  })
})

describe('matchesSlaFilter()', () => {
  const risk = cycle()
  const breached = cycle({
    firstResponse: {
      dueAt: at(-1),
      warnAt: at(-8),
      doneAt: null,
      state: 'BREACHED',
    },
  })
  const fine = cycle({
    firstResponse: {
      dueAt: at(30),
      warnAt: at(20),
      doneAt: null,
      state: 'OK',
    },
  })

  it('should let everything through for "all"', () => {
    expect(matchesSlaFilter(undefined, 'all', now)).toBe(true)
  })

  it('should drop conversations without an open cycle otherwise', () => {
    expect(matchesSlaFilter(undefined, 'risk', now)).toBe(false)
    expect(matchesSlaFilter(undefined, 'breached', now)).toBe(false)
  })

  it('should keep at-risk and breached for "risk" and only breached for "breached"', () => {
    expect(matchesSlaFilter(risk, 'risk', now)).toBe(true)
    expect(matchesSlaFilter(breached, 'risk', now)).toBe(true)
    expect(matchesSlaFilter(fine, 'risk', now)).toBe(false)
    expect(matchesSlaFilter(risk, 'breached', now)).toBe(false)
    expect(matchesSlaFilter(breached, 'breached', now)).toBe(true)
  })

  it('should drop a cycle that has nothing running', () => {
    const done = cycle({
      firstResponse: {
        dueAt: at(5),
        warnAt: at(-2),
        doneAt: at(-3),
        state: 'OK',
      },
    })
    expect(matchesSlaFilter(done, 'risk', now)).toBe(false)
  })
})
