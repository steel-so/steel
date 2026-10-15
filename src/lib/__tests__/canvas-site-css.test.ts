import { describe, expect, it } from 'vitest'
import { siteDoc } from '@/src/__tests__/helpers/site-canvas'
import type { CanvasNode } from '@/src/lib/canvas/types'
import { spacing } from '@/src/lib/canvas/values'
import { SITE_TYPES } from '@/src/lib/canvas-site/constants'
import {
  classNames,
  compiledNode,
  compileNode,
  compileNodesCss,
  compileSiteCss,
  hashString,
  nodeClass,
  visibilityClasses,
} from '@/src/lib/canvas-site/css'
import {
  box,
  heading,
  section,
  spec,
  toDocument,
  toFragment,
} from '@/src/lib/canvas-site/presets/builder'
import { resolveProps } from '@/src/lib/canvas-site/resolve'
import { SITE_STYLE_FNS } from '@/src/lib/canvas-site/styles'
import { defaultSiteTheme } from '@/src/lib/canvas-site/theme'

function built(node: ReturnType<typeof spec>): CanvasNode {
  const fragment = toFragment(node)
  return fragment.nodes[fragment.rootId]
}

describe('resolveProps', () => {
  it('resolves responsive values per breakpoint, nested too', () => {
    const props = {
      gap: { base: 32, mobile: 16 },
      nested: { size: { base: 1, tablet: 2 } },
      list: [{ base: 1 }],
      visibility: { base: true, tablet: false, mobile: true },
      plain: 'x',
      empty: null,
    }
    expect(resolveProps(props, 'mobile')).toEqual({
      gap: 16,
      nested: { size: 2 },
      list: [{ base: 1 }],
      visibility: { base: true, tablet: false, mobile: true },
      plain: 'x',
      empty: null,
    })
    expect(resolveProps(props, 'base').gap).toBe(32)
  })
})

describe('compileNode', () => {
  it('emits base declarations and only the per-breakpoint differences', () => {
    const compiled = compileNode(
      built(
        box(
          {
            layout: { base: 'grid', mobile: 'flex' },
            columns: { base: 3, tablet: 2 },
            gap: { base: 32, mobile: 16 },
            padding: spacing(8),
          },
          [],
        ),
      ),
    )
    expect(compiled?.className).toMatch(/^s-[0-9a-z]+$/)
    expect(compiled?.rules.base[0][1]).toEqual(
      expect.arrayContaining([
        ['display', 'grid'],
        ['grid-template-columns', 'repeat(3, minmax(0, 1fr))'],
        ['gap', '32px'],
        ['padding', '8px 8px 8px 8px'],
      ]),
    )
    expect(compiled?.rules.tablet).toEqual([
      ['', [['grid-template-columns', 'repeat(2, minmax(0, 1fr))']]],
    ])
    // Mobile switches to flex: grid-only props reset to `initial`.
    expect(compiled?.rules.mobile[0][1]).toEqual(
      expect.arrayContaining([
        ['display', 'flex'],
        ['flex-direction', 'column'],
        ['gap', '16px'],
        ['grid-template-columns', 'initial'],
      ]),
    )
  })

  it('gives equal styles the same class and different styles another', () => {
    const a = built(heading('h2', 'A', { align: 'center' }))
    const b = built(heading('h3', 'B', { align: 'center' }))
    const c = built(heading('h2', 'C', { align: 'right' }))
    expect(nodeClass(a)).toBe(nodeClass(b))
    expect(nodeClass(a)).not.toBe(nodeClass(c))
  })

  it('returns null for types without styles or declarations', () => {
    expect(compileNode({ type: SITE_TYPES.columns, props: {} })).toBeNull()
    expect(compileNode({ type: 'site.unknown', props: {} })).toBeNull()
    expect(compileNode({ type: 'constructor', props: {} })).toBeNull()
    const original = SITE_STYLE_FNS[SITE_TYPES.spacer]
    SITE_STYLE_FNS[SITE_TYPES.spacer] = () => ({
      '': { gap: undefined, x: '' },
    })
    try {
      expect(compileNode({ type: SITE_TYPES.spacer, props: {} })).toBeNull()
    } finally {
      SITE_STYLE_FNS[SITE_TYPES.spacer] = original
    }
  })

  it('caches per node object', () => {
    const node = built(heading('h2', 'A'))
    expect(compiledNode(node)).toBe(compiledNode(node))
    const none = { id: 'x', type: SITE_TYPES.columns, props: {} }
    expect(compiledNode(none)).toBeNull()
    expect(compiledNode(none)).toBeNull()
  })

  it('compiles section overlays, video layering and boxed widths', () => {
    const overlay = compileNode(
      built(
        section(
          {
            overlay: { color: 'token:dark' },
            video: { src: '/v.mp4' },
            maxWidth: 900,
            radius: { topLeft: 4, topRight: 4, bottomRight: 4, bottomLeft: 4 },
          },
          [],
        ),
      ),
    )
    const css = JSON.stringify(overlay?.rules.base)
    expect(css).toContain('["isolation","isolate"]')
    expect(css).toContain('["opacity","0.5"]')
    expect(css).toContain('["max-width","900px"]')
    const full = compileNode(
      built(section({ width: 'full', overlay: { opacity: 30 } }, [])),
    )
    expect(JSON.stringify(full?.rules.base)).toContain('["max-width","none"]')
    expect(JSON.stringify(full?.rules.base)).not.toContain('::before')
  })
})

describe('per-breakpoint selectors', () => {
  it('adds or resets selectors that exist on one breakpoint only', () => {
    const grows = compileNode(
      built(
        spec(SITE_TYPES.button, { align: { base: 'left', mobile: 'stretch' } }),
      ),
    )
    expect(grows?.rules.mobile).toEqual(
      expect.arrayContaining([[' > a', [['width', '100%']]]]),
    )
    const shrinks = compileNode(
      built(
        spec(SITE_TYPES.button, {
          align: { base: 'stretch', tablet: 'center' },
        }),
      ),
    )
    expect(shrinks?.rules.tablet).toEqual(
      expect.arrayContaining([[' > a', [['width', 'initial']]]]),
    )
  })

  it('writes background images as safe quoted urls', () => {
    const compiled = compileNode(
      built(
        section(
          {
            background: {
              kind: 'image',
              url: 'data:image/png;base64,AA"}</style>',
              position: 'center',
              size: 'cover',
              repeat: false,
            },
          },
          [],
        ),
      ),
    )
    const css = compileNodesCss([toDocument([])])
    expect(css).toContain('s-')
    expect(JSON.stringify(compiled?.rules.base)).toContain(
      'url(\\"data:image/png;base64,AA%22}%3C/style%3E\\")',
    )
  })
})

describe('visibility', () => {
  it('adds hide classes for the breakpoints turned off', () => {
    const node = built(
      heading('h2', 'A', {
        visibility: { base: true, tablet: false, mobile: false },
      }),
    )
    expect(visibilityClasses(node)).toEqual(['s-hide-tablet', 's-hide-mobile'])
    expect(classNames(node, 'x', false, null)).toBe(
      `x ${nodeClass(node)} s-hide-tablet s-hide-mobile`,
    )
    expect(
      classNames({ id: 'c', type: SITE_TYPES.columns, props: {} }),
    ).toBeUndefined()
  })
})

describe('compileSiteCss', () => {
  const doc = siteDoc([
    heading('h1', 'Título', { align: { base: 'left', mobile: 'center' } }),
    heading('h2', 'Outro', { align: { base: 'left', mobile: 'center' } }),
  ])

  it('dedupes classes and groups media queries at the end', () => {
    const css = compileNodesCss([doc])
    const headingClass = css.match(/\.(s-[0-9a-z]+)\{text-align:left\}/)?.[1]
    expect(headingClass).toBeTruthy()
    expect(css.split(`.${headingClass}{text-align:left}`)).toHaveLength(2)
    expect(css).toMatch(/@media \(max-width: 767\.98px\)\{[^\n]*\}$/)
    expect(css).toContain(`.${headingClass}{text-align:center}}`)
    expect(css).not.toContain('@media (max-width: 1023.98px)')
  })

  it('skips hidden subtrees and missing children', () => {
    const hidden = toDocument([
      section({}, [heading('h2', 'Oculto', { color: '#123456' })]),
    ])
    const sectionId = hidden.nodes.root.children?.[0] as string
    hidden.nodes[sectionId] = {
      ...hidden.nodes[sectionId],
      meta: { hidden: true },
    }
    hidden.nodes.root = { ...hidden.nodes.root, children: [sectionId, 'ghost'] }
    expect(compileNodesCss([hidden])).not.toContain('#123456')
  })

  it('wraps theme and structural rules in a cascade layer', () => {
    const css = compileSiteCss(doc, { theme: defaultSiteTheme() })
    expect(css.startsWith('@layer s-base{')).toBe(true)
    expect(css).toContain('--canvas-primary:#473bf0')
    expect(css).toContain('display:none!important')
    expect(css).not.toContain('.s-empty')
    const editing = compileSiteCss([doc], { editing: true })
    expect(editing).not.toContain('--canvas-primary:')
    expect(editing).toContain('.s-empty')
    expect(editing).toContain('opacity:.35')
    expect(compileSiteCss(doc)).toBe(compileSiteCss(doc))
  })

  it('hashes strings deterministically', () => {
    expect(hashString('abc')).toBe(hashString('abc'))
    expect(hashString('abc')).not.toBe(hashString('abd'))
  })
})
