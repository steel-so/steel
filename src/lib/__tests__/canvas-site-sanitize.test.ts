import { describe, expect, it } from 'vitest'
import { cssProperty, cssUrl, cssValue } from '@/src/lib/canvas-site/css-value'
import {
  escapeHtml,
  richTextToPlain,
  safeHref,
  safeSrc,
  sanitizeRichText,
  videoEmbedUrl,
  vimeoId,
  youtubeId,
} from '@/src/lib/canvas-site/sanitize'

describe('urls', () => {
  it('allows only script-free hrefs', () => {
    for (const ok of [
      'https://a.com',
      'http://a.com',
      'mailto:a@b.c',
      'tel:+55',
      '#top',
      '/sobre',
      '?q=1',
    ]) {
      expect(safeHref(ok)).toBe(ok)
    }
    for (const bad of [
      'javascript:alert(1)',
      'data:text/html,x',
      '//evil.com',
      'vbscript:x',
      '',
      '  ',
      undefined,
    ]) {
      expect(safeHref(bad)).toBeUndefined()
    }
    expect(safeHref('  /a ')).toBe('/a')
  })

  it('allows image sources and inline image data', () => {
    expect(safeSrc('https://cdn/x.png')).toBe('https://cdn/x.png')
    expect(safeSrc('/media/x.png')).toBe('/media/x.png')
    expect(safeSrc('data:image/png;base64,AAA')).toBe(
      'data:image/png;base64,AAA',
    )
    expect(safeSrc('data:image/svg+xml,<svg/>')).toBe(
      'data:image/svg+xml,<svg/>',
    )
    expect(safeSrc('data:text/html,x')).toBeUndefined()
    expect(safeSrc('javascript:x')).toBeUndefined()
    expect(safeSrc(undefined)).toBeUndefined()
  })

  it('escapes html', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;',
    )
  })
})

describe('rich text', () => {
  it('keeps the allowlist and drops attributes', () => {
    expect(
      sanitizeRichText(
        '<p class="x" onclick="y">Oi <strong style="a">forte</strong><br/></p><ul><li>a</li></ul>',
      ),
    ).toBe('<p>Oi <strong>forte</strong><br></p><ul><li>a</li></ul>')
  })

  it('removes dangerous tags with their content, comments and unknown tags', () => {
    expect(
      sanitizeRichText(
        '<!-- c --><script>alert(1)</script><style>p{}</style><iframe src=x></iframe><div>texto</div><![CDATA[x]]><!DOCTYPE html><svg><g/></svg>',
      ),
    ).toBe('texto')
    expect(sanitizeRichText('<script src=x>')).toBe('')
  })

  it('keeps safe links only', () => {
    expect(
      sanitizeRichText(
        '<a href="https://a.com?x=1&amp;y=2" target="_blank">a</a>',
      ),
    ).toBe(
      '<a href="https://a.com?x=1&amp;y=2" target="_blank" rel="noopener noreferrer">a</a>',
    )
    expect(sanitizeRichText("<a href='/sobre'>a</a>")).toBe(
      '<a href="/sobre">a</a>',
    )
    expect(sanitizeRichText('<a href=#x>a</a>')).toBe('<a href="#x">a</a>')
    expect(sanitizeRichText('<a href="javascript:alert(1)">a</a>')).toBe(
      '<a>a</a>',
    )
    expect(sanitizeRichText('<a>a</a>')).toBe('<a>a</a>')
  })

  it('turns rich text into plain text', () => {
    expect(
      richTextToPlain(
        '<p>Olá&nbsp;<b>mundo</b></p><p>A &amp; B &lt;c&gt; &quot;d&quot; &#39;e&#39;<br>f</p>',
      ),
    ).toBe(`Olá mundo A & B <c> "d" 'e' f`)
  })
})

describe('video urls', () => {
  it('parses YouTube ids', () => {
    for (const url of [
      'dQw4w9WgXcQ',
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://youtube.com/watch?feature=x&v=dQw4w9WgXcQ',
      'https://youtu.be/dQw4w9WgXcQ',
      'https://www.youtube.com/shorts/dQw4w9WgXcQ',
      'https://m.youtube.com/embed/dQw4w9WgXcQ',
    ]) {
      expect(youtubeId(url)).toBe('dQw4w9WgXcQ')
    }
    expect(youtubeId('https://vimeo.com/123456')).toBeNull()
  })

  it('parses Vimeo ids', () => {
    expect(vimeoId('76979871')).toBe('76979871')
    expect(vimeoId('https://vimeo.com/76979871')).toBe('76979871')
    expect(vimeoId('https://player.vimeo.com/video/76979871')).toBe('76979871')
    expect(vimeoId('https://youtu.be/x')).toBeNull()
  })

  it('builds embed urls with the player options', () => {
    const options = { autoplay: true, muted: true, loop: true, controls: false }
    expect(
      videoEmbedUrl('youtube', 'https://youtu.be/dQw4w9WgXcQ', options),
    ).toBe(
      'https://www.youtube.com/embed/dQw4w9WgXcQ?autoplay=1&mute=1&controls=0&rel=0&loop=1&playlist=dQw4w9WgXcQ',
    )
    expect(
      videoEmbedUrl('youtube', 'dQw4w9WgXcQ', {
        ...options,
        loop: false,
        autoplay: false,
      }),
    ).toBe(
      'https://www.youtube.com/embed/dQw4w9WgXcQ?autoplay=0&mute=1&controls=0&rel=0',
    )
    expect(videoEmbedUrl('vimeo', 'https://vimeo.com/76979871', options)).toBe(
      'https://player.vimeo.com/video/76979871?autoplay=1&muted=1&loop=1&controls=0&dnt=1',
    )
    expect(videoEmbedUrl('youtube', 'nope', options)).toBeNull()
    expect(videoEmbedUrl('vimeo', 'nope', options)).toBeNull()
  })
})

describe('css values', () => {
  it('neutralizes rule breakouts outside quotes', () => {
    expect(cssValue('red;}body{color:blue')).toBe('redbodycolor:blue')
    expect(cssValue('a</style><script>')).toBe('a/stylescript')
    expect(cssValue(12)).toBe('12')
  })

  it('encodes only string breakouts inside quotes and closes open quotes', () => {
    expect(cssValue('url("data:image/png;base64,AA</style>\\x")')).toBe(
      'url("data:image/png;base64,AA%3C/style%3E%5Cx")',
    )
    expect(cssValue('"Open')).toBe('"Open"')
    expect(cssValue('""')).toBe('""')
  })

  it('kebab-cases properties and quotes urls', () => {
    expect(cssProperty('backgroundColor')).toBe('background-color')
    expect(cssProperty('--canvas-x')).toBe('--canvas-x')
    expect(cssProperty('gap')).toBe('gap')
    expect(cssUrl(' /a"b.png ')).toBe('url("/a%22b.png")')
  })
})
