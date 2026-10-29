import { describe, expect, it } from 'vitest'
import {
  adLeadSource,
  leadPhoneFromWaId,
  parseMetaReferral,
} from '../whatsapp/ad-referral'

describe('parseMetaReferral', () => {
  it('reads the full Click-to-WhatsApp block', () => {
    expect(
      parseMetaReferral({
        source_url: 'https://fb.me/ad1',
        source_id: '120210000000001',
        source_type: 'AD',
        headline: '  Promoção  ',
        body: 'Texto',
        media_type: 'IMAGE',
        image_url: 'https://cdn.example/a.jpg',
        thumbnail_url: 'https://cdn.example/t.jpg',
        ctwa_clid: 'clid',
      }),
    ).toEqual({
      sourceType: 'ad',
      sourceId: '120210000000001',
      sourceUrl: 'https://fb.me/ad1',
      headline: 'Promoção',
      body: 'Texto',
      mediaType: 'image',
      mediaUrl: 'https://cdn.example/a.jpg',
      ctwaClid: 'clid',
    })
  })

  it('falls back to the thumbnail, then the video, for the media', () => {
    expect(
      parseMetaReferral({ source_id: 'a', thumbnail_url: 'https://t' })
        ?.mediaUrl,
    ).toBe('https://t')
    expect(
      parseMetaReferral({ source_id: 'a', video_url: 'https://v' })?.mediaUrl,
    ).toBe('https://v')
  })

  it('groups on the URL when the ad id is missing and defaults the type to ad', () => {
    expect(parseMetaReferral({ source_url: 'https://fb.me/x' })).toMatchObject({
      sourceId: 'https://fb.me/x',
      sourceType: 'ad',
    })
  })

  it('keeps a post source type', () => {
    expect(
      parseMetaReferral({ source_id: 'p1', source_type: 'post' })?.sourceType,
    ).toBe('post')
  })

  it('truncates oversized values', () => {
    const parsed = parseMetaReferral({
      source_id: 'x'.repeat(300),
      headline: 'h'.repeat(400),
    })
    expect(parsed?.sourceId).toHaveLength(100)
    expect(parsed?.headline).toHaveLength(300)
  })

  it('ignores blocks that cannot identify an ad', () => {
    expect(parseMetaReferral(undefined)).toBeNull()
    expect(parseMetaReferral('x')).toBeNull()
    expect(parseMetaReferral({})).toBeNull()
    expect(
      parseMetaReferral({ headline: 'só título', source_id: '  ' }),
    ).toBeNull()
    expect(parseMetaReferral({ source_id: 42 })).toBeNull()
  })
})

describe('adLeadSource', () => {
  it('appends the headline to the base text', () => {
    expect(adLeadSource('Anúncio', 'Verão')).toBe('Anúncio · Verão')
  })

  it('returns the base alone without a headline', () => {
    expect(adLeadSource(' Anúncio ', null)).toBe('Anúncio')
    expect(adLeadSource('Anúncio', '   ')).toBe('Anúncio')
    expect(adLeadSource('Anúncio', undefined)).toBe('Anúncio')
  })

  it('fits the 100 character limit of CrmLead.source', () => {
    const source = adLeadSource('Anúncio', 'x'.repeat(200))
    expect(source).toHaveLength(100)
    expect(source.endsWith('…')).toBe(true)
    expect(adLeadSource('y'.repeat(150), 'z')).toHaveLength(100)
  })
})

describe('leadPhoneFromWaId', () => {
  it('accepts phone digits only', () => {
    expect(leadPhoneFromWaId('5511988887777')).toBe('5511988887777')
    expect(leadPhoneFromWaId('BR.123456789')).toBeNull()
    expect(leadPhoneFromWaId('123')).toBeNull()
  })
})
