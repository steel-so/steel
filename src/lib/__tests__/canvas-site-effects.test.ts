import { createElement } from 'react'
import { describe, expect, it } from 'vitest'
import {
  nodeOfType,
  renderSite,
  renderSiteEditing,
  siteDoc,
} from '@/src/__tests__/helpers/site-canvas'
import type { CanvasNode } from '@/src/lib/canvas/types'
import { createSiteCatalog, siteCatalog } from '@/src/lib/canvas-site/catalog'
import { SITE_TYPES } from '@/src/lib/canvas-site/constants'
import { compileSiteCss } from '@/src/lib/canvas-site/css'
import {
  decorate,
  effectAttributes,
  effectRules,
  effectSections,
  hasEffects,
} from '@/src/lib/canvas-site/effects'
import {
  box,
  button,
  heading,
  image,
  section,
  spec,
  text,
  toDocument,
  url,
} from '@/src/lib/canvas-site/presets/builder'
import {
  SITE_BOOT_SCRIPT,
  siteRuntimeFeatures,
  siteRuntimeScripts,
} from '@/src/lib/canvas-site/runtime'

const node = (props: Record<string, unknown>, type = SITE_TYPES.text) =>
  ({ id: 'n1', type, props }) as CanvasNode

describe('click interactions', () => {
  it('turns a non-interactive element into a keyboard-reachable button', () => {
    const html = renderSite(
      siteDoc([
        box({ interaction: { action: 'scroll', target: 'contato' } }, [
          text('Card'),
        ]),
      ]),
    )
    expect(html).toContain(
      'data-s-action="scroll" data-s-target="contato" role="button" tabindex="0"',
    )
  })

  it('resolves link actions through the site pages and opens new tabs', () => {
    const ctx = {
      pages: [{ id: 'p2', title: 'Sobre', path: '/sobre' }],
    }
    const page = effectAttributes(
      node({
        interaction: { action: 'link', link: { type: 'page', value: 'p2' } },
      }),
      ctx,
    )
    expect(page.attrs).toEqual({
      'data-s-action': 'link',
      'data-s-href': '/sobre',
    })
    const blank = effectAttributes(
      node({
        interaction: {
          action: 'link',
          link: { type: 'url', value: 'https://a.com', newTab: true },
        },
      }),
      {},
    )
    expect(blank.attrs['data-s-blank']).toBe('')
    const html = renderSite(
      siteDoc([
        heading('h2', 'Ir', {
          interaction: { action: 'link', link: url('https://a.com') },
        }),
      ]),
    )
    expect(html).toContain('role="link" tabindex="0"')
  })

  it('ignores incomplete actions and close needs no target', () => {
    expect(
      effectAttributes(node({ interaction: { action: 'link' } }), {}).attrs,
    ).toEqual({})
    expect(
      effectAttributes(node({ interaction: { action: 'popup' } }), {}).attrs,
    ).toEqual({})
    expect(
      effectAttributes(node({ interaction: { action: 'close' } }), {}).attrs,
    ).toEqual({ 'data-s-action': 'close' })
    expect(
      effectAttributes(node({ interaction: { action: 'none' } }), {}).attrs,
    ).toEqual({})
    expect(
      effectAttributes(
        node(
          { interaction: { action: 'toggle', target: 'x' } },
          SITE_TYPES.slide,
        ),
        {},
      ).attrs,
    ).toEqual({})
  })

  it('keeps links and buttons as they are', () => {
    const link = decorate(
      createElement('a', { href: '#a' }),
      node({ interaction: { action: 'toggle', target: 'x' } }),
      {},
    ) as { props: Record<string, unknown> }
    expect(link.props.role).toBeUndefined()
    expect(link.props['data-s-action']).toBe('toggle')
    const html = renderSite(
      siteDoc([
        button('Abrir', url(''), {
          interaction: { action: 'popup', target: 'p' },
        }),
      ]),
    )
    expect(html).not.toContain('role="button"')
    expect(decorate('texto', node({}), {})).toBe('texto')
    const plain = createElement('div')
    expect(decorate(plain, node({}), {})).toBe(plain)
  })

  it('leaves the editor canvas untouched', () => {
    const html = renderSiteEditing(
      siteDoc([
        text('Oi', {
          interaction: { action: 'scroll', target: 'a' },
          animation: { effect: 'fade' },
        }),
      ]),
    )
    expect(html).not.toContain('data-s-action')
    expect(html).not.toContain('s-anim')
  })
})

describe('entrance animations', () => {
  it('adds the effect classes and compiles timing', () => {
    const doc = siteDoc([
      heading('h2', 'Oi', {
        animation: {
          effect: 'fade-up',
          duration: 900,
          delay: 200,
          easing: 'spring',
        },
      }),
      text('Já', { animation: { effect: 'zoom', trigger: 'load' } }),
    ])
    const html = renderSite(doc)
    expect(html).toMatch(
      /class="s-t-h2 s-[0-9a-z]+ s-anim s-anim-fade-up s-reveal"/,
    )
    expect(html).toMatch(/s-anim s-anim-zoom"/)
    const css = compileSiteCss(doc)
    expect(css).toContain(
      'animation-duration:900ms;animation-delay:200ms;animation-timing-function:cubic-bezier(.34,1.56,.64,1)',
    )
    expect(css).toContain('animation-duration:600ms')
    expect(css).toContain('@keyframes s-fade-up')
    expect(css).toContain(
      '.s-js .s-site .s-reveal:not(.s-in){animation-name:none;opacity:0}',
    )
    expect(css).toContain('@media (prefers-reduced-motion:reduce)')
  })

  it('ignores "none" and types without effects', () => {
    expect(
      effectRules(SITE_TYPES.text, { animation: { effect: 'none' } }),
    ).toEqual({})
    expect(
      effectRules(SITE_TYPES.slide, { animation: { effect: 'fade' } }),
    ).toEqual({})
    expect(
      effectAttributes(node({ animation: { effect: 'none' } }), {}).className,
    ).toBeUndefined()
  })
})

describe('hover and focus states', () => {
  it('compiles hover/focus rules on the element target', () => {
    const doc = siteDoc([
      button('Comprar', url('/'), {
        hover: {
          background: 'token:dark',
          textColor: '#ffffff',
          borderColor: '#000000',
          scale: 105,
          lift: 4,
          opacity: 90,
          duration: 300,
          shadow: { x: 0, y: 8, blur: 24, spread: 0, color: '#00000033' },
        },
      }),
      box({ hover: { lift: 6 } }, [text('Card')]),
      image('/a.png', 'A', { hover: { scale: 110 } }),
    ])
    const css = compileSiteCss(doc)
    expect(css).toMatch(
      /\.s-[0-9a-z]+ \.s-btn:hover\{background-color:var\(--canvas-dark\);color:#ffffff;border-color:#000000;box-shadow:0px 8px 24px 0px #00000033;transform:translateY\(-4px\) scale\(1\.05\);opacity:0\.9\}/,
    )
    expect(css).toMatch(/\.s-[0-9a-z]+ \.s-btn:focus-visible\{/)
    expect(css).toContain('transition:background-color 300ms')
    expect(css).toMatch(
      /\.s-[0-9a-z]+:focus-within\{transform:translateY\(-6px\)\}/,
    )
    expect(css).toMatch(/\.s-[0-9a-z]+ img:hover\{transform:scale\(1\.1\)\}/)
  })

  it('skips empty hover styles and types without a target', () => {
    expect(effectRules(SITE_TYPES.button, { hover: { scale: 100 } })).toEqual(
      {},
    )
    expect(effectRules(SITE_TYPES.text, { hover: { lift: 4 } })).toEqual({})
  })
})

describe('free positioning', () => {
  it('places the children of a free container by x/y per breakpoint', () => {
    const doc = siteDoc([
      box({ positioning: { base: 'free', mobile: 'flow' } }, [
        heading('h2', 'Livre', {
          place: {
            x: { base: 40, mobile: 0 },
            y: 24,
            width: { value: 300, unit: 'px' },
            z: 2,
          },
        }),
      ]),
    ])
    const css = compileSiteCss(doc)
    expect(css).toMatch(
      /\.s-[0-9a-z]+\{position:relative;[^}]*min-height:320px/,
    )
    expect(css).toMatch(
      /> \*\{position:absolute;left:var\(--s-x,0px\);top:var\(--s-y,0px\);width:var\(--s-w,auto\);z-index:var\(--s-z,auto\)\}/,
    )
    expect(css).toContain('--s-x:40px;--s-y:24px;--s-w:300px;--s-z:2')
    // Mobile goes back to the flow and to x 0.
    expect(css).toMatch(/@media \(max-width: 767\.98px\)\{.*position:initial/)
    expect(css).toMatch(/@media \(max-width: 767\.98px\)\{.*--s-x:0px/)
  })

  it('tells the editor which breakpoints are free', () => {
    const container = siteCatalog.components[SITE_TYPES.container]
    const layout = container.freeLayout as NonNullable<
      typeof container.freeLayout
    >
    expect(layout.childPath).toBe('place')
    const props = { positioning: { base: 'free', mobile: 'flow' } }
    expect(layout.enabled(props, 'base')).toBe(true)
    expect(layout.enabled(props, 'tablet')).toBe(true)
    expect(layout.enabled(props, 'mobile')).toBe(false)
    expect(layout.enabled({}, 'base')).toBe(false)
  })
})

describe('inspector sections', () => {
  it('adds hover, interaction, animation and position where they apply', () => {
    const ids = (type: string) =>
      effectSections(type, {}).map((section) => section.id)
    expect(ids(SITE_TYPES.button)).toEqual([
      'hover',
      'interaction',
      'animation',
      'place',
    ])
    expect(ids(SITE_TYPES.text)).toEqual(['interaction', 'animation', 'place'])
    expect(ids(SITE_TYPES.section)).toEqual(['interaction', 'animation'])
    expect(ids(SITE_TYPES.slide)).toEqual(['hover'])
    expect(ids(SITE_TYPES.page)).toEqual([])
    expect(hasEffects(SITE_TYPES.popup)).toBe(false)
  })

  it('uses the anchor picker and the child adder of the editor', () => {
    const picker = () => null
    const adder = () => null
    const catalog = createSiteCatalog({
      anchorPicker: picker,
      childAdder: adder,
    })
    const target = catalog.components[SITE_TYPES.text].inspector
      .find((section) => section.id === 'interaction')
      ?.fields.find((field) => field.path === 'interaction.target')
    expect(target?.control).toEqual({ kind: 'custom', component: picker })
    const carousel = catalog.components[SITE_TYPES.carousel].inspector[0]
    expect(carousel.id).toBe('children')
    expect(carousel.fields[0].control).toEqual({
      kind: 'custom',
      component: adder,
    })
    expect(siteCatalog.components[SITE_TYPES.carousel].inspector[0].id).toBe(
      'content',
    )
    const plain = siteCatalog.components[SITE_TYPES.text].inspector
      .find((section) => section.id === 'interaction')
      ?.fields.find((field) => field.path === 'interaction.target')
    expect(plain?.control.kind).toBe('text')
  })
})

describe('runtime scripts', () => {
  const features = (...nodes: Parameters<typeof siteDoc>[0]) =>
    siteRuntimeFeatures([siteDoc(nodes)])

  it('picks only the features the page uses', () => {
    expect(features(text('Oi'))).toEqual([])
    expect(siteRuntimeScripts([siteDoc([text('Oi')])])).toEqual({
      boot: null,
      scripts: [],
    })
    expect(
      features(
        spec(SITE_TYPES.form, { formToken: 'abc' }),
        spec(SITE_TYPES.carousel, {}, [spec(SITE_TYPES.slide, {}, [])]),
        spec(SITE_TYPES.tabs, {}, []),
        spec(SITE_TYPES.gallery, {}),
        spec(SITE_TYPES.countdown, {}),
        spec(SITE_TYPES.stats, {}),
        spec(SITE_TYPES.map, {}),
        spec(SITE_TYPES.beforeAfter, {}),
        text('x', { animation: { effect: 'fade' } }),
        text('y', { interaction: { action: 'close' } }),
      ),
    ).toEqual([
      'form',
      'carousel',
      'tabs',
      'actions',
      'lightbox',
      'countdown',
      'stats',
      'map',
      'before-after',
      'reveal',
    ])
  })

  it('skips features turned off', () => {
    expect(
      features(
        spec(SITE_TYPES.form, {}),
        spec(SITE_TYPES.testimonials, {}),
        spec(SITE_TYPES.gallery, { lightbox: false }),
        spec(SITE_TYPES.stats, { animate: false }),
        spec(SITE_TYPES.map, { loadOnClick: false }),
        text('x', { animation: { effect: 'fade', trigger: 'load' } }),
        text('y', {
          animation: { effect: 'none' },
          interaction: { action: 'none' },
        }),
      ),
    ).toEqual([])
    expect(
      features(spec(SITE_TYPES.testimonials, { layout: 'slider' })),
    ).toEqual(['carousel'])
  })

  it('needs the boot snippet for everything but the form', () => {
    const form = siteRuntimeScripts([
      siteDoc([spec(SITE_TYPES.form, { formToken: 'abc' })]),
    ])
    expect(form.boot).toBeNull()
    expect(form.scripts.map((script) => script.id)).toEqual(['form'])
    const popup = toDocument([section({}, []), spec(SITE_TYPES.popup, {}, [])])
    const runtime = siteRuntimeScripts([popup])
    expect(runtime.boot).toBe(SITE_BOOT_SCRIPT)
    expect(runtime.scripts[0].id).toBe('actions')
    expect(runtime.scripts[0].code).toContain('data-s-popup')
  })

  it('ignores hidden subtrees', () => {
    const doc = siteDoc([spec(SITE_TYPES.tabs, {}, [])])
    const tabs = nodeOfType(doc, SITE_TYPES.tabs)
    doc.nodes[tabs.id] = { ...tabs, meta: { hidden: true } }
    expect(siteRuntimeFeatures([doc])).toEqual([])
  })
})
