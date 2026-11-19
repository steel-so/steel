import { describe, expect, it } from 'vitest'
import {
  normalizePhoneDigits,
  normalizeWebUrl,
  resolveBioDestination,
  youtubeVideoId,
} from '@/src/lib/bio-link/destination'

describe('normalizeWebUrl', () => {
  it('adds https to bare addresses and keeps http(s) ones', () => {
    expect(normalizeWebUrl('meusite.com.br')).toBe('https://meusite.com.br/')
    expect(normalizeWebUrl('https://a.com/x?y=1')).toBe('https://a.com/x?y=1')
    expect(normalizeWebUrl('http://a.com')).toBe('http://a.com/')
  })

  it('rejects other schemes, spaces and hosts without a dot', () => {
    expect(normalizeWebUrl('javascript:alert(1)')).toBeNull()
    expect(normalizeWebUrl('data:text/html,hi')).toBeNull()
    expect(normalizeWebUrl('ftp://a.com')).toBeNull()
    expect(normalizeWebUrl('meu site.com')).toBeNull()
    expect(normalizeWebUrl('localhost')).toBeNull()
    expect(normalizeWebUrl('')).toBeNull()
  })
})

describe('normalizePhoneDigits', () => {
  it('adds the Brazilian country code to national numbers', () => {
    expect(normalizePhoneDigits('(11) 91234-5678')).toBe('5511912345678')
    expect(normalizePhoneDigits('(11) 3456-7890')).toBe('551134567890')
  })

  it('keeps numbers that already carry a country code', () => {
    expect(normalizePhoneDigits('+55 11 91234-5678')).toBe('5511912345678')
    expect(normalizePhoneDigits('+44 7911 123456')).toBe('447911123456')
  })

  it('rejects numbers that are too short or too long', () => {
    expect(normalizePhoneDigits('12345')).toBeNull()
    expect(normalizePhoneDigits('1234567890123456')).toBeNull()
  })
})

describe('resolveBioDestination', () => {
  it('builds a WhatsApp link with the pre-filled message encoded', () => {
    expect(
      resolveBioDestination({
        network: 'whatsapp',
        value: '(11) 91234-5678',
        message: 'Olá! Quero saber mais & comprar',
      }),
    ).toBe(
      'https://wa.me/5511912345678?text=Ol%C3%A1!%20Quero%20saber%20mais%20%26%20comprar',
    )
    expect(
      resolveBioDestination({ network: 'whatsapp', value: '11912345678' }),
    ).toBe('https://wa.me/5511912345678')
    expect(
      resolveBioDestination({ network: 'whatsapp', value: 'abc' }),
    ).toBeNull()
  })

  it('turns handles into profile URLs and keeps full URLs', () => {
    expect(
      resolveBioDestination({ network: 'instagram', value: '@minha.loja' }),
    ).toBe('https://www.instagram.com/minha.loja/')
    expect(
      resolveBioDestination({
        network: 'instagram',
        value: 'https://instagram.com/minha.loja',
      }),
    ).toBe('https://instagram.com/minha.loja')
    expect(
      resolveBioDestination({ network: 'facebook', value: 'minhaloja' }),
    ).toBe('https://www.facebook.com/minhaloja')
    expect(
      resolveBioDestination({ network: 'tiktok', value: '@minhaloja' }),
    ).toBe('https://www.tiktok.com/@minhaloja')
    expect(resolveBioDestination({ network: 'youtube', value: '@canal' })).toBe(
      'https://www.youtube.com/@canal',
    )
    expect(
      resolveBioDestination({ network: 'youtube', value: 'youtu.be/abc' }),
    ).toBe('https://youtu.be/abc')
  })

  it('refuses handles with unsafe characters', () => {
    expect(
      resolveBioDestination({ network: 'instagram', value: 'a b' }),
    ).toBeNull()
    expect(
      resolveBioDestination({ network: 'tiktok', value: '@a/b?x' }),
    ).toBeNull()
  })

  it('handles custom links, sites, e-mail and phone', () => {
    expect(
      resolveBioDestination({ network: 'custom', value: 'a.com/promo' }),
    ).toBe('https://a.com/promo')
    expect(
      resolveBioDestination({ network: 'site', value: 'javascript:alert(1)' }),
    ).toBeNull()
    expect(
      resolveBioDestination({ network: 'email', value: 'oi@loja.com.br' }),
    ).toBe('mailto:oi@loja.com.br')
    expect(
      resolveBioDestination({ network: 'email', value: 'sem-arroba' }),
    ).toBeNull()
    expect(
      resolveBioDestination({ network: 'phone', value: '(11) 3456-7890' }),
    ).toBe('tel:+551134567890')
  })

  it('returns null for an empty value', () => {
    expect(resolveBioDestination({ network: 'custom', value: '  ' })).toBeNull()
  })
})

describe('youtubeVideoId', () => {
  const ID = 'dQw4w9WgXcQ'

  it('reads watch, short, embed, shorts and bare ids', () => {
    expect(youtubeVideoId(`https://www.youtube.com/watch?v=${ID}&t=3`)).toBe(ID)
    expect(youtubeVideoId(`https://youtu.be/${ID}?si=x`)).toBe(ID)
    expect(youtubeVideoId(`https://www.youtube.com/embed/${ID}`)).toBe(ID)
    expect(youtubeVideoId(`https://youtube.com/shorts/${ID}`)).toBe(ID)
    expect(youtubeVideoId(`m.youtube.com/watch?v=${ID}`)).toBe(ID)
    expect(youtubeVideoId(ID)).toBe(ID)
  })

  it('rejects other hosts and malformed ids', () => {
    expect(youtubeVideoId(`https://vimeo.com/${ID}`)).toBeNull()
    expect(youtubeVideoId('https://www.youtube.com/watch?v=curto')).toBeNull()
    expect(youtubeVideoId('https://www.youtube.com/@canal')).toBeNull()
    expect(youtubeVideoId('')).toBeNull()
  })
})
