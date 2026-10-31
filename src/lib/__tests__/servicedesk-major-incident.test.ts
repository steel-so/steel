import { describe, expect, it } from 'vitest'
import {
  SD_STATUS_PAGE_SLUG_PATTERN,
  sdNormalizeStatusEmail,
  sdPageMatchesTicket,
  sdStatusPageAutoSlug,
  sdStatusPageOverall,
  sdStatusPagePath,
  sdStatusPageSlugify,
  sdStatusSubscriptionPath,
  sdStatusUpdateText,
} from '../servicedesk/major-incident'

const ticket = {
  customerId: 'c1',
  companyId: 'c2',
  serviceId: 's1',
  categoryId: 'k1',
  subcategoryId: null,
}

describe('sdStatusPageOverall', () => {
  it('is operational without active incidents and takes the worst impact', () => {
    expect(sdStatusPageOverall([])).toBe('OPERATIONAL')
    expect(sdStatusPageOverall(['DEGRADED'])).toBe('DEGRADED')
    expect(
      sdStatusPageOverall(['DEGRADED', 'MAJOR_OUTAGE', 'PARTIAL_OUTAGE']),
    ).toBe('MAJOR_OUTAGE')
    expect(sdStatusPageOverall(['PARTIAL_OUTAGE', 'DEGRADED'])).toBe(
      'PARTIAL_OUTAGE',
    )
  })
})

describe('slugs and paths', () => {
  it('slugifies names without accents or symbols', () => {
    expect(sdStatusPageSlugify('Acme · Telefonia São Paulo!')).toBe(
      'acme-telefonia-sao-paulo',
    )
    expect(sdStatusPageSlugify('###')).toBe('')
    expect(sdStatusPageSlugify('x'.repeat(80))).toHaveLength(48)
  })

  it('builds an auto slug that satisfies the pattern', () => {
    const slug = sdStatusPageAutoSlug('Acme Telefonia', 'a1b2c3')
    expect(slug).toBe('acme-telefonia-a1b2c3')
    expect(SD_STATUS_PAGE_SLUG_PATTERN.test(slug)).toBe(true)
    expect(sdStatusPageAutoSlug('???', 'a1b2c3')).toBe('status-a1b2c3')
    const long = sdStatusPageAutoSlug('y'.repeat(60), 'a1b2c3')
    expect(long.length).toBeLessThanOrEqual(48)
    expect(SD_STATUS_PAGE_SLUG_PATTERN.test(long)).toBe(true)
  })

  it('builds the public paths', () => {
    expect(sdStatusPagePath('acme')).toBe('/status-page/acme')
    expect(sdStatusSubscriptionPath('acme', 'tok')).toBe(
      '/status-page/acme/inscricao/tok',
    )
    expect(sdNormalizeStatusEmail('  Ana@ACME.com ')).toBe('ana@acme.com')
  })
})

describe('sdStatusUpdateText', () => {
  it('formats the WhatsApp notice', () => {
    const text = sdStatusUpdateText({
      pageName: 'Acme',
      incidentTitle: 'Telefonia fora',
      status: 'IDENTIFIED',
      message: 'Trocando o link.',
      url: 'https://x/status-page/acme',
    })
    expect(text).toContain('*Acme* — Telefonia fora')
    expect(text).toContain('Situação: Causa identificada')
    expect(text).toContain('Trocando o link.')
    expect(text).toContain('https://x/status-page/acme')
  })
})

describe('sdPageMatchesTicket', () => {
  it('matches pages without scope', () => {
    expect(
      sdPageMatchesTicket({ customerId: null, serviceIds: [] }, ticket),
    ).toBe(true)
  })

  it('matches by customer or company', () => {
    expect(
      sdPageMatchesTicket({ customerId: 'c1', serviceIds: [] }, ticket),
    ).toBe(true)
    expect(
      sdPageMatchesTicket({ customerId: 'c2', serviceIds: [] }, ticket),
    ).toBe(true)
    expect(
      sdPageMatchesTicket({ customerId: 'zz', serviceIds: [] }, ticket),
    ).toBe(false)
  })

  it('matches by any catalog level', () => {
    expect(
      sdPageMatchesTicket({ customerId: null, serviceIds: ['k1'] }, ticket),
    ).toBe(true)
    expect(
      sdPageMatchesTicket({ customerId: null, serviceIds: ['s1'] }, ticket),
    ).toBe(true)
    expect(
      sdPageMatchesTicket({ customerId: null, serviceIds: ['other'] }, ticket),
    ).toBe(false)
    expect(
      sdPageMatchesTicket(
        { customerId: null, serviceIds: ['x'] },
        { ...ticket, serviceId: null, categoryId: null },
      ),
    ).toBe(false)
  })
})

describe('sdStatusPageOverall with components', () => {
  it('keeps the incident-only behavior', () => {
    expect(sdStatusPageOverall([])).toBe('OPERATIONAL')
    expect(sdStatusPageOverall(['DEGRADED', 'MAJOR_OUTAGE'])).toBe(
      'MAJOR_OUTAGE',
    )
  })

  it('maps a degraded component to DEGRADED and an outage to a partial outage', () => {
    expect(sdStatusPageOverall([], ['OPERATIONAL', 'OPERATIONAL'])).toBe(
      'OPERATIONAL',
    )
    expect(sdStatusPageOverall([], ['OPERATIONAL', 'DEGRADED'])).toBe(
      'DEGRADED',
    )
    expect(sdStatusPageOverall([], ['OPERATIONAL', 'OUTAGE'])).toBe(
      'PARTIAL_OUTAGE',
    )
  })

  it('is a major outage when every component is down', () => {
    expect(sdStatusPageOverall([], ['OUTAGE'])).toBe('MAJOR_OUTAGE')
    expect(sdStatusPageOverall([], ['OUTAGE', 'OUTAGE'])).toBe('MAJOR_OUTAGE')
  })

  it('takes the worst of incidents and components', () => {
    expect(sdStatusPageOverall(['MAJOR_OUTAGE'], ['DEGRADED'])).toBe(
      'MAJOR_OUTAGE',
    )
    expect(sdStatusPageOverall(['DEGRADED'], ['OPERATIONAL', 'OUTAGE'])).toBe(
      'PARTIAL_OUTAGE',
    )
  })
})
