import { describe, expect, it } from 'vitest'
import { emailBlock } from '@/src/__tests__/helpers/email-canvas'
import type { CanvasFragment } from '@/src/lib/canvas/types'
import {
  buildAiSection,
  EMAIL_AI_FIELDS,
  type EmailAiBlockSpec,
  EmailAiSectionOutputSchema,
  fitAiText,
  plainToParagraphs,
} from '@/src/lib/canvas-email/ai-blocks'
import {
  defaultColumnProps,
  defaultSectionProps,
} from '@/src/lib/canvas-email/components/layout'
import {
  fragmentKindOf,
  fragmentPreviewDocument,
  fragmentTypes,
  MAX_FRAGMENT_NODES,
  validateEmailFragment,
} from '@/src/lib/canvas-email/fragments'
import {
  desktopValue,
  mobileFontSize,
  mobileOverride,
  mobilePadding,
  toggleDevice,
  withMobileFontSize,
  withMobileOverride,
} from '@/src/lib/canvas-email/mobile-overrides'

function blockFragment(
  type = 'email.heading',
  props: Record<string, unknown> = {},
): CanvasFragment {
  const node = emailBlock({ type, id: 'h', props })
  return { rootId: 'h', nodes: { h: node } }
}

function sectionFragment(): CanvasFragment {
  return {
    rootId: 's',
    nodes: {
      s: {
        id: 's',
        type: 'email.section',
        props: defaultSectionProps(),
        children: ['c'],
      },
      c: {
        id: 'c',
        type: 'email.column',
        props: defaultColumnProps(),
        children: ['t'],
      },
      t: emailBlock({
        type: 'email.text',
        id: 't',
        props: { html: '<p onclick="x()">Oi <script>x</script></p>' },
      }),
    },
  }
}

describe('validateEmailFragment()', () => {
  it('accepts a block and returns it normalized', () => {
    const result = validateEmailFragment(blockFragment())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.kind).toBe('block')
    expect(result.value.nodeCount).toBe(1)
    expect(result.value.hasHtml).toBe(false)
    expect(Object.keys(result.value.fragment.nodes)).toEqual(['h'])
  })

  it('accepts a section and sanitizes its rich text', () => {
    const result = validateEmailFragment(sectionFragment())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.kind).toBe('section')
    expect(Object.keys(result.value.fragment.nodes).sort()).toEqual([
      'c',
      's',
      't',
    ])
    const html = String(result.value.fragment.nodes.t.props.html)
    expect(html).not.toContain('script')
    expect(html).not.toContain('onclick')
  })

  it('flags HTML blocks', () => {
    const result = validateEmailFragment(
      blockFragment('email.html', { html: '<b>x</b>' }),
    )
    expect(result.ok && result.value.hasHtml).toBe(true)
  })

  it.each([
    ['not an object', null],
    ['no root id', { nodes: {} }],
    ['nodes not a record', { rootId: 'a', nodes: [] }],
  ])('refuses a malformed fragment (%s)', (_label, input) => {
    expect(validateEmailFragment(input)).toEqual({
      ok: false,
      error: ['Bloco inválido'],
    })
  })

  it('refuses multi-root fragments, the reserved root id and oversized ones', () => {
    expect(validateEmailFragment({ ...blockFragment(), roots: ['h'] })).toEqual(
      { ok: false, error: ['Salve um bloco ou uma seção por vez'] },
    )
    const withRoot = blockFragment()
    withRoot.nodes.root = { ...withRoot.nodes.h, id: 'root' }
    expect(validateEmailFragment(withRoot).ok).toBe(false)
    const big: CanvasFragment = { rootId: 'n0', nodes: {} }
    for (let i = 0; i <= MAX_FRAGMENT_NODES; i++) {
      big.nodes[`n${i}`] = emailBlock({ type: 'email.spacer', id: `n${i}` })
    }
    const result = validateEmailFragment(big)
    expect(!result.ok && result.error[0]).toContain('limite')
  })

  it('refuses roots that are not sections or blocks', () => {
    for (const type of ['email.column', 'email.footer', 'email.body', 'x']) {
      const result = validateEmailFragment({
        rootId: 'a',
        nodes: { a: { id: 'a', type, props: {} } },
      })
      expect(result).toEqual({
        ok: false,
        error: ['Só seções e blocos de conteúdo podem ser salvos'],
      })
    }
    expect(
      validateEmailFragment({ rootId: 'a', nodes: { a: 'oops' } }).ok,
    ).toBe(false)
  })

  it('reports catalog problems (invalid props, orphans)', () => {
    const invalid = blockFragment('email.button', {
      link: { type: 'url', value: 'javascript:alert(1)' },
    })
    const result = validateEmailFragment(invalid)
    expect(!result.ok && result.error.join(' ')).toContain('Link inválido')

    const orphan = blockFragment()
    orphan.nodes.extra = emailBlock({ type: 'email.text', id: 'extra' })
    expect(validateEmailFragment(orphan).ok).toBe(false)
  })

  it('knows fragment kinds, types and builds a preview document', () => {
    expect(fragmentKindOf('email.section')).toBe('section')
    expect(fragmentKindOf('email.button')).toBe('block')
    expect(fragmentKindOf('email.footer')).toBeNull()
    expect(fragmentKindOf(undefined)).toBeNull()
    expect(fragmentTypes(sectionFragment()).sort()).toEqual([
      'email.column',
      'email.section',
      'email.text',
    ])
    const preview = fragmentPreviewDocument(blockFragment())
    const root = preview?.nodes[preview.rootId]
    expect(root?.children).toHaveLength(1)
    expect(
      Object.values(preview?.nodes ?? {}).some(
        (n) => n.type === 'email.footer',
      ),
    ).toBe(false)
    expect(
      fragmentPreviewDocument({
        rootId: 'a',
        nodes: { a: { id: 'a', type: 'email.footer', props: {} } },
      }),
    ).toBeNull()
  })
})

// ─── AI blocks ────────────────────────────────────────────────────────────

const spec = (overrides: Partial<EmailAiBlockSpec>): EmailAiBlockSpec => ({
  type: 'heading',
  text: '',
  level: 'h2',
  items: [],
  url: '',
  author: '',
  role: '',
  code: '',
  ...overrides,
})

describe('fitAiText()', () => {
  const heading = EMAIL_AI_FIELDS['email.heading']
  const rich = EMAIL_AI_FIELDS['email.text']

  it('keeps plain fields on one line, unquoted and capped', () => {
    expect(fitAiText('"Olá\n  mundo"', heading)).toBe('Olá mundo')
    expect(fitAiText('<b>Oi</b>', heading)).toBe('Oi')
    expect(fitAiText('x'.repeat(400), heading)).toHaveLength(300)
    expect(fitAiText('   ', heading)).toBeNull()
  })

  it('turns plain text into paragraphs and sanitizes HTML', () => {
    expect(fitAiText('Um\n\nDois & três', rich)).toBe(
      '<p>Um</p><p>Dois &amp; três</p>',
    )
    expect(fitAiText('<p>Oi <script>x</script></p>', rich)).not.toContain(
      'script',
    )
    expect(fitAiText('<p> </p>', rich)).toBeNull()
    expect(fitAiText(`<p>${'a'.repeat(7000)}</p>`, rich)).toBeNull()
  })

  it('keeps line breaks inside a paragraph', () => {
    expect(plainToParagraphs('a\nb')).toBe('<p>a<br>b</p>')
  })
})

describe('buildAiSection()', () => {
  it('builds every supported block from the catalog defaults', () => {
    const result = buildAiSection(
      {
        background: 'soft',
        columns: [
          {
            blocks: [
              spec({ type: 'heading', text: 'Título', level: 'h1' }),
              spec({ type: 'text', text: 'Parágrafo um\n\nDois' }),
              spec({
                type: 'button',
                text: 'Fale conosco',
                url: 'https://x.com',
              }),
              spec({
                type: 'list',
                items: [
                  { title: 'A', text: 'a' },
                  { title: '', text: '' },
                ],
              }),
              spec({
                type: 'quote',
                text: 'Ótimo',
                author: 'Ana',
                role: 'CEO',
              }),
              spec({ type: 'coupon', code: 'promo10', text: 'Use já' }),
              spec({ type: 'divider' }),
              spec({ type: 'product' }),
            ],
          },
          { blocks: [spec({ type: 'heading', text: 'Coluna 2' })] },
        ],
      },
      { productId: 'p1' },
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const nodes = Object.values(result.value.fragment.nodes)
    const byType = (type: string) => nodes.filter((n) => n.type === type)
    expect(byType('email.column')).toHaveLength(2)
    expect(byType('email.heading')).toHaveLength(2)
    expect(byType('email.coupon')[0].props.code).toBe('PROMO10')
    expect(byType('email.product')[0].props.productId).toBe('p1')
    expect(byType('email.list')[0].props.items).toHaveLength(1)
    expect(byType('email.button')[0].props.link).toEqual({
      type: 'url',
      value: 'https://x.com',
    })
    const section = result.value.fragment.nodes[result.value.fragment.rootId]
    expect(section.props.background).toEqual({
      kind: 'color',
      color: 'token:primary-soft',
    })
    expect(byType('email.column')[0].props.padding).toMatchObject({
      left: 8,
      right: 8,
    })
  })

  it('drops empty or invalid blocks and uses the campaign link', () => {
    const result = buildAiSection({
      background: 'none',
      columns: [
        {
          blocks: [
            spec({ type: 'heading', text: '' }),
            spec({ type: 'text', text: '' }),
            spec({ type: 'button', text: '' }),
            spec({ type: 'list', items: [] }),
            spec({ type: 'quote', text: '' }),
            spec({ type: 'coupon', code: '' }),
            spec({ type: 'product' }),
            spec({ type: 'button', text: 'Ir', url: 'javascript:x' }),
            // A heading level the props schema refuses.
            spec({ type: 'heading', text: 'x', level: 'h9' as 'h1' }),
          ],
        },
        { blocks: [] },
      ],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const nodes = Object.values(result.value.fragment.nodes)
    const button = nodes.find((n) => n.type === 'email.button')
    expect(button?.props.link).toEqual({
      type: 'url',
      value: '{{campaign_link}}',
    })
    expect(nodes.filter((n) => n.type === 'email.column')).toHaveLength(1)
    expect(
      nodes.find((n) => n.type === 'email.column')?.props.padding,
    ).toMatchObject({ left: 0, right: 0 })
    expect(
      result.value.fragment.nodes[result.value.fragment.rootId].props
        .background,
    ).toEqual({ kind: 'none' })
  })

  it('fails when nothing usable came back', () => {
    const result = buildAiSection({
      background: 'none',
      columns: [{ blocks: [spec({ type: 'heading', text: ' ' })] }],
    })
    expect(result.ok).toBe(false)
  })

  it('parses the provider output shape', () => {
    expect(
      EmailAiSectionOutputSchema.safeParse({
        reply: 'ok',
        section: { background: 'none', columns: [] },
      }).success,
    ).toBe(false)
  })
})

// ─── mobile overrides ─────────────────────────────────────────────────────

describe('mobile overrides', () => {
  const pad = { top: 8, right: 0, bottom: 8, left: 0 }
  const mobilePad = { top: 4, right: 4, bottom: 4, left: 4 }

  it('reads and writes the mobile value of a responsive prop', () => {
    expect(mobileOverride(pad)).toBeUndefined()
    expect(desktopValue(pad)).toBe(pad)
    const stored = withMobileOverride(pad, mobilePad)
    expect(stored).toEqual({ base: pad, mobile: mobilePad })
    expect(mobilePadding(stored)).toEqual(mobilePad)
    expect(desktopValue(stored)).toBe(pad)
    expect(withMobileOverride(stored, undefined)).toBe(pad)
    expect(withMobileOverride(pad, undefined)).toBe(pad)
    const tablet = { base: pad, tablet: mobilePad, mobile: mobilePad }
    expect(withMobileOverride(tablet, undefined)).toEqual({
      base: pad,
      tablet: mobilePad,
    })
  })

  it('sets and clears only the mobile font size', () => {
    expect(mobileFontSize(undefined)).toBeUndefined()
    const set = withMobileFontSize(undefined, 14)
    expect(set).toEqual({ base: {}, mobile: { fontSize: 14 } })
    expect(mobileFontSize(set)).toBe(14)
    expect(withMobileFontSize(set, undefined)).toBeUndefined()
    expect(withMobileFontSize(undefined, undefined)).toBeUndefined()

    const plain = { fontSize: 20, fontWeight: 700 }
    expect(withMobileFontSize(plain, undefined)).toBe(plain)
    const both = withMobileFontSize(
      { base: plain, mobile: { lineHeight: 1.2, fontSize: 18 } },
      undefined,
    )
    expect(both).toEqual({ base: plain, mobile: { lineHeight: 1.2 } })
  })

  it('toggles devices but never hides on both', () => {
    const all = { base: true, tablet: true, mobile: true }
    expect(toggleDevice(all, 'mobile', false)).toEqual({
      base: true,
      tablet: false,
      mobile: false,
    })
    expect(toggleDevice(all, 'base', false)).toEqual({
      base: false,
      tablet: true,
      mobile: true,
    })
    const desktopOnly = { base: true, tablet: false, mobile: false }
    expect(toggleDevice(desktopOnly, 'base', false)).toBe(desktopOnly)
  })
})
