import { describe, expect, it } from 'vitest'
import {
  collectWikiMediaKeys,
  rewriteWikiMediaUrl,
  rewriteWikiMediaUrls,
  wikiMediaKeyFromUrl,
  wikiPublicMediaPath,
} from '../wiki-public-media'

const WS = 'ws1'
const SIGNED = `http://localhost:9002/wiki-media/${WS}/abc.png?X-Amz-Signature=x`

describe('wikiMediaKeyFromUrl()', () => {
  it('should extract the key of a pre-signed wiki media URL', () => {
    expect(wikiMediaKeyFromUrl(SIGNED, WS)).toBe(`${WS}/abc.png`)
  })

  it('should decode an encoded key', () => {
    expect(
      wikiMediaKeyFromUrl(`https://m/wiki-media/${WS}/a%20b.png`, WS),
    ).toBe(`${WS}/a b.png`)
  })

  it('should ignore other buckets, workspaces and external URLs', () => {
    expect(wikiMediaKeyFromUrl('https://example.com/x.png', WS)).toBeNull()
    expect(
      wikiMediaKeyFromUrl('http://m/wiki-media/other/abc.png', WS),
    ).toBeNull()
  })

  it('should reject traversal and empty segments', () => {
    expect(
      wikiMediaKeyFromUrl(`http://m/wiki-media/${WS}/%2e%2e/x.png`, WS),
    ).toBeNull()
    expect(wikiMediaKeyFromUrl(`http://m/wiki-media/${WS}//x`, WS)).toBeNull()
  })

  it('should return null for a malformed encoding or URL', () => {
    expect(
      wikiMediaKeyFromUrl(`http://m/wiki-media/${WS}/%E0%A4%A`, WS),
    ).toBeNull()
    expect(wikiMediaKeyFromUrl('http://[::1', WS)).toBeNull()
  })
})

describe('rewriteWikiMediaUrls()', () => {
  it('should rewrite nested media urls and keep the rest', () => {
    const content = [
      { type: 'img', url: SIGNED, children: [{ text: '' }] },
      {
        type: 'column_group',
        children: [
          {
            type: 'a',
            url: 'https://example.com',
            children: [{ type: 'video', url: SIGNED, children: [] }],
          },
        ],
      },
      { type: 'p', children: [{ text: 'x', bold: true }] },
    ]

    type Node = { url?: string; children?: Node[] }
    const out = rewriteWikiMediaUrls(content, WS, 'tok') as unknown as Node[]

    const path = wikiPublicMediaPath('tok', `${WS}/abc.png`)
    expect(out[0].url).toBe(path)
    expect(out[1].children?.[0].url).toBe('https://example.com')
    expect(out[1].children?.[0].children?.[0].url).toBe(path)
    expect(out[2]).toEqual(content[2])
    expect(content[0].url).toBe(SIGNED)
  })
})

describe('rewriteWikiMediaUrl()', () => {
  it('should rewrite a media cover and keep others', () => {
    expect(rewriteWikiMediaUrl(SIGNED, WS, 'tok')).toBe(
      '/api/wiki/public/tok/media?key=ws1%2Fabc.png',
    )
    expect(rewriteWikiMediaUrl('https://x/y.png', WS, 'tok')).toBe(
      'https://x/y.png',
    )
    expect(rewriteWikiMediaUrl(null, WS, 'tok')).toBeNull()
  })
})

describe('collectWikiMediaKeys()', () => {
  it('should collect keys from content and cover', () => {
    const keys = collectWikiMediaKeys(
      [
        { type: 'img', url: SIGNED },
        { type: 'a', url: 'https://example.com', children: [{ text: '' }] },
        { type: 'p', children: [{ url: 7 }] },
      ],
      `http://m/wiki-media/${WS}/cover.jpg`,
      WS,
    )

    expect([...keys].sort()).toEqual([`${WS}/abc.png`, `${WS}/cover.jpg`])
  })

  it('should ignore a non-media cover and empty content', () => {
    expect(collectWikiMediaKeys(null, 'https://x/y.png', WS).size).toBe(0)
    expect(collectWikiMediaKeys([], null, WS).size).toBe(0)
  })
})
