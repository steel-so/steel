import { existsSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { renderSite } from '@/src/__tests__/helpers/site-canvas'
import {
  createDocument,
  fragmentForType,
  validateDocument,
} from '@/src/lib/canvas/ops'
import type {
  CanvasDocument,
  CanvasFragment,
  CanvasProps,
} from '@/src/lib/canvas/types'
import {
  createSiteCatalog,
  siteCatalog,
  validateSiteDocument,
} from '@/src/lib/canvas-site/catalog'
import { columnsFragment } from '@/src/lib/canvas-site/components/layout'
import {
  SITE_ADMIN_ONLY_TYPES,
  SITE_CATALOG_ID,
  SITE_TYPES,
} from '@/src/lib/canvas-site/constants'
import { defaultFormAction } from '@/src/lib/canvas-site/context'
import { compileSiteCss } from '@/src/lib/canvas-site/css'
import {
  getSiteTemplate,
  SITE_KIT_IDS,
  SITE_PRESETS,
  SITE_SECTION_PRESETS,
  SITE_SECTION_TYPES,
  SITE_TEMPLATES,
  sectionPreset,
} from '@/src/lib/canvas-site/presets'
import { toDocument } from '@/src/lib/canvas-site/presets/builder'
import { siteThemeSchema } from '@/src/lib/canvas-site/theme'

/** A page document holding the fragment (sections go to the root, other
 * nodes inside a section). */
function wrap(fragment: CanvasFragment): CanvasDocument {
  const doc = createDocument(siteCatalog)
  const root = fragment.nodes[fragment.rootId]
  if (root.type === SITE_TYPES.section || root.type === SITE_TYPES.popup) {
    return {
      ...doc,
      nodes: {
        ...doc.nodes,
        ...fragment.nodes,
        root: { ...doc.nodes.root, children: [fragment.rootId] },
      },
    }
  }
  return {
    ...doc,
    nodes: {
      ...doc.nodes,
      ...fragment.nodes,
      s: {
        id: 's',
        type: SITE_TYPES.section,
        props: siteCatalog.components[SITE_TYPES.section].defaultProps(),
        children: [fragment.rootId],
      },
      root: { ...doc.nodes.root, children: ['s'] },
    },
  }
}

describe('site catalog', () => {
  it('registers every component with valid default props', () => {
    expect(siteCatalog.id).toBe(SITE_CATALOG_ID)
    expect(Object.keys(siteCatalog.components)).toHaveLength(33)
    for (const definition of Object.values(siteCatalog.components)) {
      const parsed = definition.propsSchema.safeParse(definition.defaultProps())
      expect(parsed.success, definition.type).toBe(true)
    }
  })

  it('inserts every palette type into a valid document', () => {
    // Slides, tabs and accordion items only live in their parent (whose
    // template inserts them).
    const nested = new Set<string>([
      SITE_TYPES.page,
      SITE_TYPES.slide,
      SITE_TYPES.tab,
      SITE_TYPES.accordionItem,
    ])
    for (const type of Object.keys(siteCatalog.components)) {
      if (nested.has(type)) continue
      const fragment = fragmentForType(siteCatalog, type) as CanvasFragment
      const result = validateDocument(wrap(fragment), siteCatalog)
      expect(result.ok, type).toBe(true)
    }
    expect(columnsFragment(3).nodes.grid.children).toHaveLength(3)
  })

  it('evaluates every conditional inspector field', () => {
    const samples: CanvasProps[] = [
      { layout: 'grid', shape: 'none', icon: 'arrow', autoplay: false },
      { layout: 'flex', shape: 'circle', icon: '', trigger: 'click' },
      {
        layout: 'slider',
        autoplay: true,
        trigger: 'delay',
        interaction: { action: 'popup' },
        animation: { effect: 'fade-up' },
      },
      { interaction: { action: 'link' }, animation: { effect: 'none' } },
    ]
    let calls = 0
    for (const definition of Object.values(siteCatalog.components)) {
      for (const section of definition.inspector) {
        for (const field of section.fields) {
          if (typeof field.showIf === 'function') {
            const results = new Set(
              samples.map((props) =>
                (field.showIf as (p: CanvasProps) => boolean)(props),
              ),
            )
            expect(results.size, `${definition.type} ${field.path}`).toBe(2)
            calls++
          }
        }
      }
    }
    expect(calls).toBeGreaterThan(5)
  })

  it('shows the embed only to admins and takes a form picker', () => {
    expect(siteCatalog.components[SITE_TYPES.embed].category).toBeUndefined()
    const picker = () => null
    const admin = createSiteCatalog({ canEmbed: true, formPicker: picker })
    expect(admin.components[SITE_TYPES.embed].category).toBe('Avançado')
    const tokenField = admin.components[SITE_TYPES.form].inspector[0].fields[0]
    expect(tokenField.control).toEqual({ kind: 'custom', component: picker })
    expect(
      siteCatalog.components[SITE_TYPES.form].inspector[0].fields[0].control
        .kind,
    ).toBe('text')
    expect(SITE_ADMIN_ONLY_TYPES).toEqual([SITE_TYPES.embed])
    expect(defaultFormAction('a b')).toBe('/api/crm/forms/a%20b/submit')
  })

  it('rejects documents of other catalogs and invalid props', () => {
    expect(
      validateSiteDocument({
        catalog: 'email',
        version: 1,
        rootId: 'root',
        nodes: {},
      }).ok,
    ).toBe(false)
    const doc = toDocument([])
    expect(validateSiteDocument(doc).ok).toBe(true)
    doc.nodes.root = {
      ...doc.nodes.root,
      props: { background: { kind: 'nope' } },
    }
    const result = validateSiteDocument(doc)
    expect(result.ok).toBe(false)
  })
})

describe('presets', () => {
  it('rebuilds the 15 section types in 3 styles', () => {
    expect(SITE_SECTION_TYPES).toHaveLength(15)
    expect(SITE_KIT_IDS).toEqual(['agency', 'b2b', 'saas'])
    expect(SITE_SECTION_PRESETS).toHaveLength(45)
    expect(new Set(SITE_PRESETS.map((preset) => preset.id)).size).toBe(
      SITE_PRESETS.length,
    )
  })

  it('every preset passes the engine validation', () => {
    for (const preset of SITE_PRESETS) {
      const result = validateDocument(wrap(preset.fragment()), siteCatalog)
      expect(result.ok ? 'ok' : JSON.stringify(result.error), preset.id).toBe(
        'ok',
      )
    }
  })

  it('returns fresh ids on every call', () => {
    const preset = sectionPreset('hero', 'saas')
    expect(preset.id).toBe('hero-saas')
    const a = preset.fragment()
    const b = preset.fragment()
    expect(a.rootId).not.toBe(b.rootId)
    expect(Object.keys(a.nodes).some((id) => id in b.nodes)).toBe(false)
  })

  it('only references images that exist in public/', () => {
    const sources = new Set<string>()
    for (const preset of SITE_SECTION_PRESETS) {
      for (const node of Object.values(preset.fragment().nodes)) {
        const src = (node.props.image as { src?: string } | undefined)?.src
        if (src) sources.add(src)
      }
    }
    expect(sources.size).toBeGreaterThan(10)
    for (const src of sources) {
      expect(existsSync(path.join(process.cwd(), 'public', src)), src).toBe(
        true,
      )
    }
  })
})

describe('templates', () => {
  it('ships 6 valid full-page templates with their theme', () => {
    expect(SITE_TEMPLATES).toHaveLength(6)
    for (const template of SITE_TEMPLATES) {
      const doc = template.document()
      const result = validateSiteDocument(doc)
      expect(result.ok ? 'ok' : JSON.stringify(result.error), template.id).toBe(
        'ok',
      )
      expect(doc.nodes.root.children).toHaveLength(template.sections.length)
      expect(siteThemeSchema.safeParse(template.theme()).success).toBe(true)
      expect(template.theme()).not.toBe(template.theme())
    }
    expect(getSiteTemplate('saas')?.kit).toBe('saas')
    expect(getSiteTemplate('nope')).toBeUndefined()
  })

  it('renders each template to stable html and css', () => {
    for (const template of SITE_TEMPLATES) {
      const doc = template.document()
      const html = renderSite(doc)
      expect(html.match(/<h1[ >]/g), template.id).toHaveLength(1)
      expect(html).not.toContain('style=')
      expect(html).not.toContain('data-canvas-id')
      expect(renderSite(template.document())).toBe(html)
    }
    const saas = getSiteTemplate('saas') as (typeof SITE_TEMPLATES)[number]
    expect(
      compileSiteCss(saas.document(), { theme: saas.theme() }),
    ).toMatchSnapshot()
    expect(renderSite(saas.document())).toMatchSnapshot()
  })
})
