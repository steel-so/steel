import { describe, expect, it } from 'vitest'
import {
  buildCrossEngineBodyComponents,
  CROSS_ENGINE_SKIP_MESSAGE,
  type CrossEngineDecisionInput,
  crossEngineWindowOpen,
  decideCrossEngineSend,
  sanitizeCrossEngineParam,
} from '../whatsapp/cross-engine-send'

const NOW = new Date('2026-11-13T12:00:00.000Z')
const RECENT = new Date('2026-11-13T00:00:00.000Z')
const OLD = new Date('2026-11-11T00:00:00.000Z')

function input(
  overrides: Partial<CrossEngineDecisionInput> = {},
): CrossEngineDecisionInput {
  return {
    provider: 'META',
    optOut: 'allowed',
    hasTemplate: true,
    templateApproved: true,
    hasText: false,
    lastInboundAt: null,
    now: NOW,
    ...overrides,
  }
}

describe('crossEngineWindowOpen', () => {
  it('is closed without an inbound message', () => {
    expect(crossEngineWindowOpen(null, NOW)).toBe(false)
  })

  it('is open within 24 hours and closed after', () => {
    expect(crossEngineWindowOpen(RECENT, NOW)).toBe(true)
    expect(crossEngineWindowOpen(OLD, NOW)).toBe(false)
  })

  it('defaults to the current time', () => {
    expect(crossEngineWindowOpen(new Date(), undefined)).toBe(true)
  })
})

describe('decideCrossEngineSend', () => {
  it('never sends to a contact that opted out, whatever else is set', () => {
    expect(
      decideCrossEngineSend(input({ optOut: 'opted_out', hasText: true })),
    ).toEqual({ action: 'skip', reason: 'opted_out' })
    expect(
      decideCrossEngineSend(input({ provider: 'ZAPI', optOut: 'opted_out' })),
    ).toEqual({ action: 'skip', reason: 'opted_out' })
  })

  it('fails closed when the opt-out could not be read', () => {
    expect(decideCrossEngineSend(input({ optOut: 'unverified' }))).toEqual({
      action: 'skip',
      reason: 'opt_out_unverified',
    })
  })

  it('sends an approved Meta template at any time', () => {
    expect(
      decideCrossEngineSend(input({ lastInboundAt: OLD, hasText: true })),
    ).toEqual({ action: 'template' })
  })

  it('uses free text on Meta only inside the 24 h window', () => {
    const base = { hasTemplate: false, templateApproved: false, hasText: true }
    expect(
      decideCrossEngineSend(input({ ...base, lastInboundAt: RECENT })),
    ).toEqual({ action: 'text' })
    expect(
      decideCrossEngineSend(input({ ...base, lastInboundAt: OLD })),
    ).toEqual({ action: 'skip', reason: 'window_closed' })
  })

  it('falls back to text when the template is not approved but the window is open', () => {
    expect(
      decideCrossEngineSend(
        input({
          templateApproved: false,
          hasText: true,
          lastInboundAt: RECENT,
        }),
      ),
    ).toEqual({ action: 'text' })
  })

  it('skips when the template is not approved and the window is closed', () => {
    expect(decideCrossEngineSend(input({ templateApproved: false }))).toEqual({
      action: 'skip',
      reason: 'template_unavailable',
    })
  })

  it('skips on Meta when nothing was configured', () => {
    expect(
      decideCrossEngineSend(
        input({ hasTemplate: false, templateApproved: false }),
      ),
    ).toEqual({ action: 'skip', reason: 'no_message' })
  })

  it('sends text on Z-API without templates or window', () => {
    const base = { provider: 'ZAPI' as const, hasTemplate: false }
    expect(decideCrossEngineSend(input({ ...base, hasText: true }))).toEqual({
      action: 'text',
    })
    expect(decideCrossEngineSend(input({ ...base }))).toEqual({
      action: 'skip',
      reason: 'no_message',
    })
  })

  it('has a pt-BR message for every skip reason', () => {
    for (const message of Object.values(CROSS_ENGINE_SKIP_MESSAGE)) {
      expect(message.length).toBeGreaterThan(10)
    }
  })
})

describe('template parameters', () => {
  it('collapses whitespace, truncates and never leaves a parameter empty', () => {
    expect(sanitizeCrossEngineParam('a \n\t b')).toBe('a b')
    expect(sanitizeCrossEngineParam('   ')).toBe('-')
    const long = sanitizeCrossEngineParam('x'.repeat(2000))
    expect(long).toHaveLength(1000)
    expect(long.endsWith('…')).toBe(true)
  })

  it('builds a single body component, or none without variables', () => {
    expect(buildCrossEngineBodyComponents([])).toEqual([])
    expect(buildCrossEngineBodyComponents(['Ana', ''])).toEqual([
      {
        type: 'body',
        parameters: [
          { type: 'text', text: 'Ana' },
          { type: 'text', text: '-' },
        ],
      },
    ])
  })
})
