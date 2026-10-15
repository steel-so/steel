import { describe, expect, it } from 'vitest'
import { emailDocument } from '@/src/__tests__/helpers/email-canvas'
import type { CanvasOpError } from '@/src/lib/canvas/ops'
import {
  emailChecklist,
  GMAIL_CLIP_BYTES,
  variableIssues,
} from '@/src/lib/canvas-email/checklist'
import { createEmailDocumentFromLayout } from '@/src/lib/canvas-email/convert-v1'
import {
  emailRichTextHtml,
  escapeStrayBrackets,
} from '@/src/lib/canvas-email/rich-text'
import { sanitizeEmailHtml } from '@/src/lib/canvas-email/sanitize-html'
import {
  changesHtmlBlocks,
  describeCanvasError,
  MAX_EMAIL_NODES,
  normalizeEmailDocument,
  productIdsOf,
  validateEmailDocument,
} from '@/src/lib/canvas-email/validate'

describe('validateEmailDocument()', () => {
  it('accepts a valid document', () => {
    const doc = createEmailDocumentFromLayout('newsletter')
    const result = validateEmailDocument(doc)
    expect(result.ok && result.value).toBe(doc)
  })

  it('reports engine problems in pt-BR, deduplicated', () => {
    const doc = emailDocument([
      [
        [
          {
            type: 'email.button',
            props: { link: { type: 'url', value: 'javascript:alert(1)' } },
          },
        ],
      ],
    ])
    doc.nodes.s0c0.children?.push('ghost')
    const result = validateEmailDocument(doc)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.join('\n')).toContain(
        'Valores inválidos no elemento b0',
      )
      expect(result.error.join('\n')).toContain('Link inválido')
      expect(result.error).toContain(
        'Um elemento do e-mail não foi encontrado (ghost)',
      )
    }
    const wrong = validateEmailDocument({ ...doc, catalog: 'site' })
    expect(!wrong.ok && wrong.error[0]).toContain('Documento inválido')
  })

  it('requires the footer to be the last element', () => {
    const doc = emailDocument()
    doc.nodes.root.children = ['footer', 's0']
    expect(validateEmailDocument(doc)).toEqual({
      ok: false,
      error: ['O rodapé precisa ser o último elemento do e-mail'],
    })
  })

  it('caps the number of nodes', () => {
    const nodes = Object.fromEntries(
      Array.from({ length: MAX_EMAIL_NODES + 1 }, (_, i) => [`n${i}`, {}]),
    )
    const result = validateEmailDocument({ catalog: 'email', nodes })
    expect(!result.ok && result.error[0]).toContain('limite de 1500')
    expect(validateEmailDocument(null).ok).toBe(false)
  })

  it('describes every engine error code', () => {
    const errors: CanvasOpError[] = [
      {
        code: 'NOT_ACCEPTED',
        parentType: 'email.body',
        childType: 'email.text',
      },
      { code: 'MAX_CHILDREN', parentType: 'email.section', max: 4 },
      { code: 'MIN_CHILDREN', parentType: 'email.section', min: 1 },
      { code: 'REQUIRED', type: 'email.footer' },
      { code: 'UNIQUE', type: 'email.footer' },
      { code: 'UNKNOWN_TYPE', type: 'email.nope' },
      { code: 'CYCLE', id: 'x' },
      { code: 'LOCKED', id: 'x' },
      { code: 'ROOT', op: 'remove' },
      { code: 'DUPLICATE_ID', id: 'x' },
    ]
    expect(errors.map((e) => describeCanvasError(e))).toEqual([
      '"Texto" não pode ficar dentro de "E-mail"',
      '"Seção" aceita no máximo 4 itens',
      '"Seção" precisa de pelo menos 1 item',
      'O e-mail precisa de "Rodapé"',
      'Só pode haver um "Rodapé" no e-mail',
      'Tipo de bloco desconhecido: email.nope',
      'O elemento x aparece em dois lugares',
      'Operação recusada (LOCKED)',
      'Operação recusada (ROOT)',
      'Operação recusada (DUPLICATE_ID)',
    ])
    expect(
      describeCanvasError({
        code: 'NOT_ACCEPTED',
        parentType: 'x.a',
        childType: 'x.b',
      }),
    ).toBe('"x.b" não pode ficar dentro de "x.a"')
  })
})

describe('normalizeEmailDocument()', () => {
  it('moves the footer last and sanitizes text and HTML blocks', () => {
    const doc = emailDocument([
      [
        [
          {
            type: 'email.text',
            props: { html: '<p onclick="x">Oi<script>1</script></p>' },
          },
          {
            type: 'email.html',
            props: { html: '<div onmouseover="x">ok</div>' },
          },
        ],
      ],
    ])
    doc.nodes.root.children = ['footer', 's0']
    const clean = normalizeEmailDocument(doc)
    expect(clean).not.toBe(doc)
    expect(clean.nodes.root.children).toEqual(['s0', 'footer'])
    expect(clean.nodes.b0.props.html).toBe('<p>Oi</p>')
    expect(clean.nodes.b1.props.html).toBe('<div>ok</div>')
    expect(doc.nodes.root.children).toEqual(['footer', 's0'])
  })

  it('leaves malformed input for the validator', () => {
    expect(normalizeEmailDocument(null)).toBeNull()
    expect(normalizeEmailDocument('x')).toBe('x')
    const noNodes = { catalog: 'email' }
    expect(normalizeEmailDocument(noNodes)).toBe(noNodes)
    const odd = {
      rootId: 'root',
      nodes: {
        a: null,
        b: { type: 'email.text' },
        c: { type: 'email.text', props: { html: 3 } },
        root: { type: 'email.section', children: ['b'] },
      },
    }
    expect(normalizeEmailDocument(odd)).toEqual(odd)
  })
})

describe('HTML block permission and products', () => {
  it('detects added or changed HTML blocks, not removed ones', () => {
    const withHtml = emailDocument([[[{ type: 'email.html', id: 'h' }]]])
    const without = emailDocument()
    expect(changesHtmlBlocks(null, withHtml)).toBe(true)
    expect(changesHtmlBlocks(without, withHtml)).toBe(true)
    expect(changesHtmlBlocks(withHtml, withHtml)).toBe(false)
    expect(changesHtmlBlocks(withHtml, without)).toBe(false)
    const changed = structuredClone(withHtml)
    changed.nodes.h.props.html = '<p>outro</p>'
    expect(changesHtmlBlocks(withHtml, changed)).toBe(true)
  })

  it('lists the CRM product ids', () => {
    const doc = emailDocument([
      [
        [
          { type: 'email.product', props: { productId: 'p1' } },
          { type: 'email.product', props: { productId: 'p1' } },
          { type: 'email.product' },
          { type: 'email.text' },
        ],
      ],
    ])
    expect(productIdsOf(doc)).toEqual(['p1'])
  })
})

describe('sanitizers', () => {
  it('keeps e-mail HTML but strips anything that can run', () => {
    const dirty = [
      '<!-- c --><![CDATA[x]]><!doctype html><?php x ?>',
      '<table border="0" cellpadding="4" onload="x()"><tr><td colspan="2" bgcolor="#fff">A</td></tr></table>',
      '<a href="javascript:alert(1)">bad</a><a href="https://ok.example" target="_top">ok</a>',
      '<a href="https://ok.example" target="_blank">blank</a>',
      '<img src="http://insecure.example/a.png" alt="x"><img src="https://s.example/a.png" alt="y" />',
      '<div style="background:url(javascript:x)">s1</div>',
      '<div style="background:url(http://x.example/a.png)">s2</div>',
      '<div style="background:url(\'https://x.example/a.png\');color:red">s3</div>',
      '<font face=\'Ari<al\' color="red">f</font>',
      '<iframe src="https://x"></iframe><form><input></form><svg><g/></svg>',
      '<marquee>m</marquee><br/>',
      '<img src=x onerror=alert(1)',
    ].join('')
    const clean = sanitizeEmailHtml(dirty)
    expect(clean).toContain(
      '<table border="0" cellpadding="4"><tr><td colspan="2" bgcolor="#fff">A</td></tr></table>',
    )
    expect(clean).toContain('<a>bad</a>')
    expect(clean).toContain('<a href="https://ok.example">ok</a>')
    expect(clean).toContain('target="_blank"')
    expect(clean).toContain('<img alt="x">')
    expect(clean).toContain('<img src="https://s.example/a.png" alt="y">')
    expect(clean).toContain('<div>s1</div>')
    expect(clean).toContain('<div>s2</div>')
    expect(clean).toContain(
      'style="background:url(&#39;https://x.example/a.png&#39;);color:red"',
    )
    expect(clean).toContain('<font face="Arial" color="red">f</font>')
    expect(clean).toContain('m<br>')
    expect(clean).toContain('&lt;img src=x onerror=alert(1)')
    for (const bad of [
      '<!--',
      'CDATA',
      'doctype',
      'php',
      'onload',
      'javascript',
      'iframe',
      'form',
      'svg',
      'marquee',
      'http://',
    ]) {
      expect(clean.toLowerCase(), bad).not.toContain(bad)
    }
  })

  it('escapes half-written tags in rich text', () => {
    expect(escapeStrayBrackets('<p>a</p><img src=x onerror=y')).toBe(
      '<p>a</p>&lt;img src=x onerror=y',
    )
    expect(escapeStrayBrackets('<a href="https://x">y</a> > z')).toBe(
      '<a href="https://x">y</a> &gt; z',
    )
    expect(
      emailRichTextHtml(
        '<ul><li>a</li></ul><a href="https://x">l</a>',
        '#123456',
      ),
    ).toBe(
      '<ul style="margin:0 0 16px;padding-left:24px"><li style="margin:0 0 4px">a</li></ul><a href="https://x" style="color:#123456;text-decoration:underline">l</a>',
    )
    expect(emailRichTextHtml('', '#000000')).toBe('')
  })
})

describe('emailChecklist()', () => {
  it('passes a complete e-mail', () => {
    const doc = emailDocument([[[{ type: 'email.text' }]]], {
      root: { preheader: 'Resumo' },
    })
    expect(
      emailChecklist({ doc, subject: 'Oi {{primeiro_nome}}', html: '<p/>' }),
    ).toEqual([])
  })

  it('flags subject, preheader, size, alt, links and variables', () => {
    const doc = emailDocument([
      [
        [
          {
            type: 'email.image',
            id: 'img',
            props: { image: { src: 'https://x/a.png', alt: '' } },
          },
          { type: 'email.image', id: 'noimg' },
          {
            type: 'email.video',
            id: 'vid',
            props: {
              thumbnail: { src: 'https://x/t.png', alt: ' ' },
              link: { type: 'url', value: '' },
            },
          },
          {
            type: 'email.signature',
            id: 'sig',
            props: { photo: { src: 'https://x/p.png', alt: '' } },
          },
          {
            type: 'email.product',
            id: 'prd',
            props: { image: { src: 'https://x/p.png', alt: '' } },
          },
          {
            type: 'email.button',
            id: 'btn',
            props: { link: { type: 'url', value: ' ' } },
          },
          { type: 'email.nps', id: 'nps' },
          {
            type: 'email.text',
            id: 'txt',
            props: {
              html: '<p>{{nome_completo}} {{ Nome }} {{nome}} {{nome_completo}} {{abc</p>',
            },
          },
          {
            type: 'email.list',
            id: 'lst',
            props: { items: [{ title: '{{cargo}}', text: 'x}}' }] },
          },
          {
            type: 'email.text',
            id: 'hid',
            meta: { hidden: true },
            props: { html: '{{oops}}' },
          },
        ],
      ],
    ])
    const items = emailChecklist({
      doc,
      subject: '  {{foo}} {{1x}}',
      html: 'x'.repeat(GMAIL_CLIP_BYTES + 1),
    })
    const summary = items.map((i) => `${i.code}:${i.nodeId ?? ''}:${i.message}`)
    expect(summary).toEqual([
      'PREHEADER_EMPTY:root:Sem texto de pré-visualização: a caixa de entrada mostra o começo do e-mail',
      'SIZE_CLIPPED::O e-mail tem 102 KB: o Gmail corta mensagens acima de 102 KB',
      'VARIABLE_UNKNOWN::Variável desconhecida no assunto: {{foo}}',
      'VARIABLE_MALFORMED::Variável mal escrita no assunto: {{1x}}',
      'IMAGE_ALT_MISSING:img:Imagem sem texto alternativo',
      'IMAGE_ALT_MISSING:vid:Imagem sem texto alternativo',
      'LINK_EMPTY:vid:Vídeo sem link',
      'IMAGE_ALT_MISSING:sig:Imagem sem texto alternativo',
      'IMAGE_ALT_MISSING:prd:Imagem sem texto alternativo',
      'LINK_EMPTY:btn:Botão sem link',
      'VARIABLE_UNKNOWN:txt:Variável desconhecida: {{nome_completo}}',
      'VARIABLE_MALFORMED:txt:Variável mal escrita: {{ Nome }}',
      'VARIABLE_MALFORMED:txt:Variável mal escrita: {{',
      'VARIABLE_MALFORMED:lst:Variável mal escrita: }}',
    ])
    expect(items.find((i) => i.code === 'SIZE_CLIPPED')?.level).toBe('warning')
    expect(emailChecklist({ doc: emailDocument(), subject: ' ' })[0]).toEqual({
      code: 'SUBJECT_EMPTY',
      level: 'error',
      message: 'O e-mail está sem assunto',
    })
  })

  it('handles a document without a root', () => {
    const doc = emailDocument()
    delete (doc.nodes as Record<string, unknown>).root
    expect(emailChecklist({ doc, subject: 'x' }).map((i) => i.code)).toEqual([
      'PREHEADER_EMPTY',
    ])
  })

  it('reports variable issues per string', () => {
    expect(variableIssues('{{primeiro_nome|cliente}}')).toEqual([])
    expect(variableIssues('{{}}')).toEqual([
      { code: 'VARIABLE_MALFORMED', token: '{{}}' },
    ])
  })
})

describe('more sanitizer and checklist cases', () => {
  it('handles unquoted, valueless and closing void attributes/tags', () => {
    expect(
      sanitizeEmailHtml('<td align=center nowrap>a > b</td></br><hr/>'),
    ).toBe('<td align="center" nowrap="">a &gt; b</td><hr>')
  })

  it('accepts images with alt text', () => {
    const doc = emailDocument(
      [
        [
          [
            {
              type: 'email.image',
              props: { image: { src: 'https://x/a.png', alt: 'Foto' } },
            },
          ],
        ],
      ],
      { root: { preheader: 'Resumo' } },
    )
    expect(emailChecklist({ doc, subject: 'Oi' })).toEqual([])
  })
})
