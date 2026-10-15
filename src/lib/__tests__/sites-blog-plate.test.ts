import { describe, expect, it } from 'vitest'
import {
  excerptOf,
  isPlateValue,
  markdownInline,
  markdownToPlate,
  nodeText,
  type PlateValue,
  plateToHtml,
  plateToPlainText,
  readingStats,
} from '@/src/lib/sites/blog/plate'

const p = (text: string, extra: Record<string, unknown> = {}) => ({
  type: 'p',
  ...extra,
  children: [{ text }],
})

describe('plateToHtml', () => {
  it('renders paragraphs, marks and escapes text', () => {
    const { html } = plateToHtml([
      {
        type: 'p',
        children: [
          { text: 'Olá <b>' },
          { text: 'negrito', bold: true },
          { text: 'tudo', bold: true, italic: true, underline: true },
          { text: 'x', strikethrough: true, code: true },
          { text: 's', subscript: true, superscript: true },
          { text: 'h', highlight: true, kbd: true },
          { text: 'linha\nquebra' },
        ],
      },
    ])
    expect(html).toBe(
      '<p>Olá &lt;b&gt;<strong>negrito</strong><u><em><strong>tudo</strong></em></u><s><code>x</code></s><sup><sub>s</sub></sup><kbd><mark>h</mark></kbd>linha<br>quebra</p>',
    )
  })

  it('drops empty paragraphs and invalid values', () => {
    expect(plateToHtml([p('')]).html).toBe('')
    expect(plateToHtml('nope').html).toBe('')
    expect(plateToHtml(null).headings).toEqual([])
  })

  it('demotes headings when the body uses h1 and builds unique ids', () => {
    const result = plateToHtml([
      { type: 'h1', children: [{ text: 'Introdução' }] },
      { type: 'h2', children: [{ text: 'Introdução' }] },
      { type: 'h6', children: [{ text: '' }] },
      { type: 'h6', children: [{ text: '!!!' }] },
    ])
    expect(result.html).toBe(
      '<h2 id="introducao">Introdução</h2><h3 id="introducao-2">Introdução</h3><h6 id="secao">!!!</h6>',
    )
    expect(result.headings.map((h) => h.level)).toEqual([2, 3, 6])
  })

  it('keeps heading levels without h1 and applies alignment classes', () => {
    const { html } = plateToHtml([
      { type: 'h2', align: 'center', children: [{ text: 'Título' }] },
      p('Direita', { align: 'right' }),
      p('Justificado', { textAlign: 'justify' }),
      p('Esquerda', { align: 'left' }),
    ])
    expect(html).toContain('<h2 id="titulo" class="s-al-center">')
    expect(html).toContain('<p class="s-al-right">Direita</p>')
    expect(html).toContain('<p class="s-al-justify">')
    expect(html).toContain('<p>Esquerda</p>')
  })

  it('renders links with safe URLs only', () => {
    const { html } = plateToHtml([
      {
        type: 'p',
        children: [
          { type: 'a', url: 'https://x.com', children: [{ text: 'ext' }] },
          {
            type: 'a',
            url: '/sobre',
            target: '_blank',
            children: [{ text: 'int' }],
          },
          {
            type: 'a',
            url: 'javascript:alert(1)',
            children: [{ text: 'bad' }],
          },
          { type: 'mention', value: 'Ana', children: [{ text: '' }] },
          { type: 'mention', children: [{ text: '@Bia' }] },
          { type: 'inline_equation', texExpression: 'x^2', children: [] },
          { type: 'inline_equation', children: [] },
          { type: 'date', date: '2026-10-15', children: [] },
          { type: 'date', children: [] },
          { type: 'emoji_input', children: [{ text: '🙂' }] },
        ],
      },
    ])
    expect(html).toContain('<a href="https://x.com" rel="noopener">ext</a>')
    expect(html).toContain('<a href="/sobre" target="_blank">int</a>')
    expect(html).toContain('bad')
    expect(html).not.toContain('javascript')
    expect(html).toContain('Ana@Bia<code>x^2</code><code></code>2026-10-15🙂')
  })

  it('renders blocks: quote, rule, code, callout, columns, equation', () => {
    const { html } = plateToHtml([
      { type: 'blockquote', children: [{ text: 'Citação' }] },
      { type: 'blockquote', children: [p('Em bloco')] },
      { type: 'hr', children: [{ text: '' }] },
      {
        type: 'code_block',
        lang: 'ts',
        children: [
          { type: 'code_line', children: [{ text: 'const a = 1' }] },
          { type: 'code_line', children: [{ text: 'a < 2' }] },
        ],
      },
      {
        type: 'code_block',
        lang: 'bad lang!',
        children: [{ type: 'code_line', children: [{ text: 'x' }] }],
      },
      {
        type: 'callout',
        variant: 'warning',
        icon: '⚠️',
        children: [{ text: 'Atenção' }],
      },
      { type: 'callout', variant: 'other', children: [p('Info')] },
      {
        type: 'column_group',
        children: [
          { type: 'column', children: [p('A')] },
          { type: 'column', children: [p('B')] },
        ],
      },
      { type: 'column', children: [p('Solta')] },
      { type: 'equation', texExpression: 'e=mc^2', children: [] },
      { type: 'equation', children: [] },
      { type: 'code_drawing', children: [] },
      { type: 'excalidraw', children: [] },
    ])
    expect(html).toContain('<blockquote>Citação</blockquote>')
    expect(html).toContain('<blockquote><p>Em bloco</p></blockquote>')
    expect(html).toContain('<hr>')
    expect(html).toContain(
      '<pre><code class="language-ts">const a = 1\na &lt; 2</code></pre>',
    )
    expect(html).toContain('<pre><code>x</code></pre>')
    expect(html).toContain(
      '<aside class="s-callout s-callout-warning"><span class="s-callout-icon" aria-hidden="true">⚠️</span><div>Atenção</div></aside>',
    )
    expect(html).toContain('s-callout-info"><div><p>Info</p></div>')
    expect(html).toContain(
      '<div class="s-post-cols"><div><p>A</p></div><div><p>B</p></div></div>',
    )
    expect(html).toContain('<div><p>Solta</p></div>')
    expect(html).toContain('<p><code>e=mc^2</code></p><p><code></code></p>')
  })

  it('renders images, embeds, videos and files', () => {
    const { html } = plateToHtml([
      {
        type: 'img',
        url: '/media/a.png',
        caption: [{ text: 'Legenda' }],
        children: [],
      },
      { type: 'img', url: '/media/b.png', alt: 'Alt', children: [] },
      { type: 'img', url: '/media/c.png', caption: 'Texto', children: [] },
      { type: 'img', url: 'javascript:x', children: [] },
      { type: 'img', children: [] },
      {
        type: 'media_embed',
        url: 'https://youtu.be/dQw4w9WgXcQ',
        children: [],
      },
      {
        type: 'media_embed',
        url: 'https://vimeo.com/123456789',
        caption: [{ text: 'Filme' }],
        children: [],
      },
      { type: 'media_embed', url: 'https://example.com/x', children: [] },
      { type: 'media_embed', url: 'ftp://nope', children: [] },
      { type: 'media_embed', children: [] },
      { type: 'video', url: '/media/v.mp4', children: [] },
      { type: 'video', url: 'data:text/html,x', children: [] },
      { type: 'file', url: '/media/doc.pdf', name: 'Manual', children: [] },
      { type: 'audio', url: '/media/a.mp3', children: [] },
      { type: 'file', url: 'javascript:x', children: [] },
    ])
    expect(html).toContain(
      '<figure class="s-post-figure"><img src="/media/a.png" alt="Legenda" loading="lazy" decoding="async"><figcaption>Legenda</figcaption></figure>',
    )
    expect(html).toContain('alt="Alt"')
    expect(html).toContain('<figcaption>Texto</figcaption>')
    expect(html).toContain('https://www.youtube.com/embed/dQw4w9WgXcQ')
    expect(html).toContain('title="Vídeo"')
    expect(html).toContain('https://player.vimeo.com/video/123456789')
    expect(html).toContain('title="Filme"')
    expect(html).toContain(
      '<p><a href="https://example.com/x" rel="noopener">example.com/x</a></p>'.replace(
        'example.com/x</a>',
        'https://example.com/x</a>',
      ),
    )
    expect(html).toContain(
      '<video src="/media/v.mp4" controls preload="metadata">',
    )
    expect(html).not.toContain('data:text')
    expect(html).toContain('<a href="/media/doc.pdf" rel="noopener">Manual</a>')
    expect(html).toContain('Baixar arquivo')
    expect(html).not.toContain('javascript')
  })

  it('renders tables with spans', () => {
    const { html } = plateToHtml([
      {
        type: 'table',
        children: [
          {
            type: 'tr',
            children: [
              { type: 'th', colSpan: 2, children: [p('Cabeçalho')] },
              { type: 'th', colSpan: 1, children: [p('X')] },
            ],
          },
          {
            type: 'tr',
            children: [{ type: 'td', rowSpan: 99, children: [p('Célula')] }],
          },
          { type: 'p', children: [{ text: 'ignored' }] },
        ],
      },
    ])
    expect(html).toBe(
      '<div class="s-post-table"><table><tbody><tr><th colspan="2"><p>Cabeçalho</p></th><th><p>X</p></th></tr><tr><td rowspan="50"><p>Célula</p></td></tr></tbody></table></div>',
    )
  })

  it('groups indent lists into nested ul/ol with todos', () => {
    const { html } = plateToHtml([
      p('Um', { listStyleType: 'disc', indent: 1 }),
      p('Sub', { listStyleType: 'decimal', indent: 2, listStart: 3 }),
      p('Sub 2', { listStyleType: 'decimal', indent: 2 }),
      p('Dois', { listStyleType: 'disc', indent: 1 }),
      p('Troca', { listStyleType: 'decimal' }),
      {
        type: 'h3',
        listStyleType: 'disc',
        children: [{ text: 'Título em lista' }],
      },
      p('Feito', { listStyleType: 'todo', checked: true }),
      p('Pendente', { listStyleType: 'todo' }),
      p('Fim'),
    ])
    expect(html).toBe(
      '<ul><li>Um<ol start="3"><li>Sub</li><li>Sub 2</li></ol></li><li>Dois</li></ul><ol><li>Troca</li></ol><ul><li><h3 id="titulo-em-lista">Título em lista</h3></li></ul><ul class="s-todo"><li><input type="checkbox" disabled checked aria-label="Concluído"> Feito</li><li><input type="checkbox" disabled aria-label="Pendente"> Pendente</li></ul><p>Fim</p>',
    )
  })

  it('fills the table of contents with every heading', () => {
    const { html } = plateToHtml([
      { type: 'toc', children: [{ text: '' }] },
      { type: 'h2', children: [{ text: 'A' }] },
      { type: 'h3', children: [{ text: 'B' }] },
    ])
    expect(html).toContain(
      '<nav class="s-post-toc" aria-label="Neste artigo"><ol><li class="s-toc-2"><a href="#a">A</a></li><li class="s-toc-3"><a href="#b">B</a></li></ol></nav>',
    )
    expect(plateToHtml([{ type: 'toc', children: [] }]).html).toBe('')
  })
})

describe('plain text and reading stats', () => {
  it('extracts one line per block, tables and columns included', () => {
    const value: PlateValue = [
      p('Primeiro'),
      {
        type: 'table',
        children: [
          { type: 'tr', children: [{ type: 'td', children: [p('Cel')] }] },
        ],
      },
      {
        type: 'column_group',
        children: [{ type: 'column', children: [p('Col')] }],
      },
      { type: 'th', children: [p('Th')] },
      { type: 'img', url: '/x.png', caption: [{ text: 'Foto' }], children: [] },
      { type: 'img', url: '/y.png', children: [] },
      p(''),
    ]
    expect(plateToPlainText(value)).toBe('Primeiro\nCel\nCol\nTh\nFoto')
    expect(plateToPlainText(value, 5)).toBe('Prime')
    expect(plateToPlainText({})).toBe('')
  })

  it('counts words and minutes (at least one)', () => {
    expect(readingStats('')).toEqual({ wordCount: 0, readingMinutes: 1 })
    expect(readingStats('a '.repeat(401))).toEqual({
      wordCount: 401,
      readingMinutes: 3,
    })
  })

  it('cuts excerpts at a word boundary', () => {
    expect(excerptOf('  curto  ')).toBe('curto')
    expect(excerptOf('uma frase bem longa com várias palavras', 20)).toBe(
      'uma frase bem longa…',
    )
    expect(excerptOf('palavraenormesemespacosnenhumaqui', 10)).toBe(
      'palavraeno…',
    )
  })

  it('reads text from nodes and validates values', () => {
    expect(
      nodeText({ children: [{ text: 'a' }, { children: [{ text: 'b' }] }] }),
    ).toBe('ab')
    expect(nodeText({ type: 'p' })).toBe('')
    expect(isPlateValue([{}])).toBe(true)
    expect(isPlateValue([1])).toBe(false)
  })
})

describe('markdownToPlate', () => {
  it('parses inline marks and safe links', () => {
    expect(
      markdownInline(
        'a **b** _c_ *d* `e` [f](https://x.com) [g](javascript:x) __h__',
      ),
    ).toEqual([
      { text: 'a ' },
      { text: 'b', bold: true },
      { text: ' ' },
      { text: 'c', italic: true },
      { text: ' ' },
      { text: 'd', italic: true },
      { text: ' ' },
      { text: 'e', code: true },
      { text: ' ' },
      { type: 'a', url: 'https://x.com', children: [{ text: 'f' }] },
      { text: ' ' },
      { text: 'g' },
      { text: ' ' },
      { text: 'h', bold: true },
    ])
    expect(markdownInline('')).toEqual([{ text: '' }])
  })

  it('parses blocks', () => {
    const value = markdownToPlate(
      [
        '## Título',
        'linha um',
        'linha dois',
        '',
        '- item',
        '  - sub',
        '1. primeiro',
        '> citação',
        '---',
        '```ts',
        'const a = 1',
        '```',
        '```',
        '```',
        'fim',
      ].join('\r\n'),
    )
    expect(value).toEqual([
      { type: 'h2', children: [{ text: 'Título' }] },
      { type: 'p', children: [{ text: 'linha um linha dois' }] },
      {
        type: 'p',
        listStyleType: 'disc',
        indent: 1,
        children: [{ text: 'item' }],
      },
      {
        type: 'p',
        listStyleType: 'disc',
        indent: 2,
        children: [{ text: 'sub' }],
      },
      {
        type: 'p',
        listStyleType: 'decimal',
        indent: 1,
        children: [{ text: 'primeiro' }],
      },
      { type: 'blockquote', children: [{ text: 'citação' }] },
      { type: 'hr', children: [{ text: '' }] },
      {
        type: 'code_block',
        lang: 'ts',
        children: [{ type: 'code_line', children: [{ text: 'const a = 1' }] }],
      },
      {
        type: 'code_block',
        children: [{ type: 'code_line', children: [{ text: '' }] }],
      },
      { type: 'p', children: [{ text: 'fim' }] },
    ])
    expect(markdownToPlate('   ')).toEqual([
      { type: 'p', children: [{ text: '' }] },
    ])
  })
})
