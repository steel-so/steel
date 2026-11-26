import { describe, expect, it } from 'vitest'
import { linkifyText } from '@/src/lib/linkify'

const links = (text: string) =>
  linkifyText(text).flatMap((p) => (p.type === 'link' ? [p.href] : []))

describe('linkifyText', () => {
  it('turns an https URL into a link and keeps the surrounding text', () => {
    expect(linkifyText('Veja https://steel.so/docs agora')).toEqual([
      { type: 'text', text: 'Veja ' },
      {
        type: 'link',
        text: 'https://steel.so/docs',
        href: 'https://steel.so/docs',
      },
      { type: 'text', text: ' agora' },
    ])
  })

  it('adds https to a bare www address', () => {
    expect(links('acesse www.stratustelecom.com.br')).toEqual([
      'https://www.stratustelecom.com.br',
    ])
  })

  it('leaves the closing punctuation outside the link', () => {
    expect(links('Acesse https://a.com/x.')).toEqual(['https://a.com/x'])
    expect(links('(veja https://a.com/x)')).toEqual(['https://a.com/x'])
    expect(links('Link: https://a.com/p?q=1, ok')).toEqual([
      'https://a.com/p?q=1',
    ])
  })

  it('keeps a balanced parenthesis that belongs to the URL', () => {
    expect(links('https://pt.wikipedia.org/wiki/Foo_(bar)')).toEqual([
      'https://pt.wikipedia.org/wiki/Foo_(bar)',
    ])
  })

  it('finds several links, also on separate lines', () => {
    expect(links('https://a.com\nhttps://b.com/c')).toEqual([
      'https://a.com',
      'https://b.com/c',
    ])
  })

  it('ignores other schemes and text that only looks like an address', () => {
    expect(links('javascript:alert(1)')).toEqual([])
    expect(links('http:// e www. sozinhos')).toEqual([])
    expect(links('versão 2.5 do app')).toEqual([])
    expect(linkifyText('sem link')).toEqual([
      { type: 'text', text: 'sem link' },
    ])
  })
})
