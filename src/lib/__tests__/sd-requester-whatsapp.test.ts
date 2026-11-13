import { describe, expect, it } from 'vitest'
import {
  buildSdRequesterComponents,
  decideSdRequesterSend,
  isSdRequesterEvent,
  parseSdRequesterTemplates,
  sanitizeSdTemplateParam,
  sdRequesterWindowOpen,
} from '../servicedesk/requester-whatsapp'

const NOW = new Date('2026-11-13T12:00:00Z')
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000)

describe('isSdRequesterEvent', () => {
  it('accepts events open to the customer only', () => {
    expect(isSdRequesterEvent('ticket.resolved')).toBe(true)
    expect(isSdRequesterEvent('ticket.phase_changed')).toBe(true)
    expect(isSdRequesterEvent('ticket.assigned')).toBe(false)
    expect(isSdRequesterEvent('sla.breached')).toBe(false)
    expect(isSdRequesterEvent('nope')).toBe(false)
  })
})

describe('parseSdRequesterTemplates', () => {
  it('keeps valid entries and drops the malformed ones', () => {
    expect(parseSdRequesterTemplates(null)).toEqual({})
    expect(parseSdRequesterTemplates([])).toEqual({})
    expect(
      parseSdRequesterTemplates({
        'ticket.resolved': {
          templateName: 'resolvido',
          language: 'pt_BR',
          variables: ['code', 'bogus', 'headline'],
        },
        'ticket.phase_changed': {
          templateName: 'fase',
          language: 'pt_BR',
        },
        'ticket.assigned': { templateName: 'x', language: 'pt_BR' },
        'ticket.reopened': null,
        'ticket.message': { templateName: '', language: 'pt_BR' },
        'ticket.csat': { templateName: 'x', language: '' },
      }),
    ).toEqual({
      'ticket.resolved': {
        templateName: 'resolvido',
        language: 'pt_BR',
        variables: ['code', 'headline'],
      },
      'ticket.phase_changed': {
        templateName: 'fase',
        language: 'pt_BR',
        variables: [],
      },
    })
  })
})

describe('template parameters', () => {
  it('flattens whitespace, truncates and never returns empty', () => {
    expect(sanitizeSdTemplateParam('  a\n\n b\t c ')).toBe('a b c')
    expect(sanitizeSdTemplateParam('   ')).toBe('-')
    const long = sanitizeSdTemplateParam('x'.repeat(2000))
    expect(long).toHaveLength(1000)
    expect(long.endsWith('…')).toBe(true)
  })

  it('builds a body component in the configured order', () => {
    const values = {
      code: 'INC-1',
      title: 'Sem rede',
      headline: 'Resolvido',
      message: 'linha 1\nlinha 2',
      requester: 'Ana',
    }
    expect(
      buildSdRequesterComponents(
        { templateName: 't', language: 'pt_BR', variables: [] },
        values,
      ),
    ).toEqual([])
    expect(
      buildSdRequesterComponents(
        {
          templateName: 't',
          language: 'pt_BR',
          variables: ['requester', 'code', 'message'],
        },
        values,
      ),
    ).toEqual([
      {
        type: 'body',
        parameters: [
          { type: 'text', text: 'Ana' },
          { type: 'text', text: 'INC-1' },
          { type: 'text', text: 'linha 1 linha 2' },
        ],
      },
    ])
  })
})

describe('sdRequesterWindowOpen', () => {
  it('is open within 24 h of the last inbound only', () => {
    expect(sdRequesterWindowOpen(null, NOW)).toBe(false)
    expect(sdRequesterWindowOpen(hoursAgo(23), NOW)).toBe(true)
    expect(sdRequesterWindowOpen(hoursAgo(25), NOW)).toBe(false)
    expect(sdRequesterWindowOpen(new Date(), undefined)).toBe(true)
  })
})

describe('decideSdRequesterSend', () => {
  const base = {
    provider: 'META' as const,
    optedOut: false,
    templateConfigured: true,
    templateApproved: true,
    textAllowed: false,
    lastInboundAt: null,
    now: NOW,
  }

  it('never sends to an opted-out contact', () => {
    expect(decideSdRequesterSend({ ...base, optedOut: true })).toEqual({
      action: 'skip',
      reason: 'opted_out',
    })
  })

  it('uses the approved template on Meta, even outside the window', () => {
    expect(decideSdRequesterSend(base)).toEqual({ action: 'template' })
  })

  it('falls back to free text inside the window when allowed', () => {
    const input = {
      ...base,
      templateApproved: false,
      textAllowed: true,
      lastInboundAt: hoursAgo(2),
    }
    expect(decideSdRequesterSend(input)).toEqual({ action: 'text' })
    expect(
      decideSdRequesterSend({ ...input, templateConfigured: false }),
    ).toEqual({ action: 'text' })
  })

  it('skips with the right reason when text is not possible', () => {
    expect(
      decideSdRequesterSend({ ...base, templateApproved: false }),
    ).toEqual({ action: 'skip', reason: 'template_unavailable' })
    expect(
      decideSdRequesterSend({
        ...base,
        templateApproved: false,
        textAllowed: true,
      }),
    ).toEqual({ action: 'skip', reason: 'template_unavailable' })
    expect(
      decideSdRequesterSend({
        ...base,
        templateConfigured: false,
        textAllowed: true,
      }),
    ).toEqual({ action: 'skip', reason: 'window_closed' })
    expect(
      decideSdRequesterSend({ ...base, templateConfigured: false }),
    ).toEqual({ action: 'skip', reason: 'no_channel' })
  })

  it('has no templates or window on Z-API', () => {
    expect(
      decideSdRequesterSend({ ...base, provider: 'ZAPI' }),
    ).toEqual({ action: 'text' })
    expect(
      decideSdRequesterSend({
        ...base,
        provider: 'ZAPI',
        templateConfigured: false,
        textAllowed: true,
      }),
    ).toEqual({ action: 'text' })
    expect(
      decideSdRequesterSend({
        ...base,
        provider: 'ZAPI',
        templateConfigured: false,
      }),
    ).toEqual({ action: 'skip', reason: 'no_channel' })
  })
})
