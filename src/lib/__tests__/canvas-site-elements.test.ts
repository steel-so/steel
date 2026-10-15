import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  nodeOfType,
  renderSite,
  renderSiteEditing,
  siteDoc,
} from '@/src/__tests__/helpers/site-canvas'
import { fragmentForType, validateDocument } from '@/src/lib/canvas/ops'
import type { CanvasFragment } from '@/src/lib/canvas/types'
import { siteCatalog } from '@/src/lib/canvas-site/catalog'
import { mapUrls, whatsappHref } from '@/src/lib/canvas-site/components/contact'
import {
  CarouselControls,
  carouselFragment,
} from '@/src/lib/canvas-site/components/interactive'
import {
  countdownEnd,
  countdownParts,
  formatStat,
  inAWeek,
} from '@/src/lib/canvas-site/components/showcase'
import { SITE_TYPES } from '@/src/lib/canvas-site/constants'
import { compileSiteCss, cssUsage } from '@/src/lib/canvas-site/css'
import {
  getSiteTemplate,
  SITE_ELEMENT_PRESETS,
  SITE_ELEMENT_SECTION_TYPES,
} from '@/src/lib/canvas-site/presets'
import {
  box,
  button,
  heading,
  type NodeSpec,
  section,
  spec,
  text,
  toDocument,
} from '@/src/lib/canvas-site/presets/builder'
import type {
  SiteCountdownProps,
  SiteStatsProps,
} from '@/src/lib/canvas-site/schemas'

const out = (...nodes: NodeSpec[]) => renderSite(siteDoc(nodes))
const edit = (...nodes: NodeSpec[]) => renderSiteEditing(siteDoc(nodes))

/** Strips inline SVG so assertions read the markup around it. */
const bare = (html: string) => html.replace(/<svg.*?<\/svg>/g, '<svg/>')

function slides(count: number, props: Record<string, unknown> = {}) {
  return spec(
    SITE_TYPES.carousel,
    props,
    Array.from({ length: count }, (_, i) =>
      spec(SITE_TYPES.slide, {}, [heading('h3', `Slide ${i + 1}`)]),
    ),
  )
}

describe('gallery', () => {
  it('renders a grid of photos that open in the lightbox', () => {
    const html = bare(out(spec(SITE_TYPES.gallery, {})))
    expect(html).toContain('class="s-gallery s-gallery-grid')
    expect(html).toContain('data-s-gallery=""')
    expect(html.match(/data-s-lightbox=""/g)).toHaveLength(4)
    expect(html).toContain('aria-label="Ampliar Projeto 1"')
    expect(html).not.toContain('<figcaption')
  })

  it('shows captions, skips empty photos and links nothing without the lightbox', () => {
    const html = out(
      spec(SITE_TYPES.gallery, {
        lightbox: false,
        showCaptions: true,
        layout: 'masonry',
        items: [
          { image: { src: '/a.png', alt: '' }, caption: 'Primeira' },
          { image: { src: '', alt: 'vazia' } },
          { image: { src: 'javascript:alert(1)', alt: 'x' } },
        ],
      }),
    )
    expect(html).toContain('s-gallery-masonry')
    expect(html).toContain('<figcaption>Primeira</figcaption>')
    expect(html).not.toContain('data-s-lightbox')
    expect(html).not.toContain('vazia')
    expect(html).not.toContain('javascript')
  })

  it('renders nothing without photos, a hint in the editor', () => {
    const empty = spec(SITE_TYPES.gallery, { items: [] })
    expect(out(empty)).not.toContain('s-gallery')
    expect(edit(empty)).toContain('Adicione fotos')
    expect(edit(spec(SITE_TYPES.gallery, {}))).not.toContain('data-s-gallery')
  })

  it('compiles grid and masonry columns', () => {
    const grid = compileSiteCss(siteDoc([spec(SITE_TYPES.gallery, {})]))
    expect(grid).toContain('grid-template-columns:repeat(3, minmax(0, 1fr))')
    expect(grid).toContain('aspect-ratio:4/3')
    expect(grid).toContain('.s-site .s-gallery-list{list-style:none')
    const masonry = compileSiteCss(
      siteDoc([spec(SITE_TYPES.gallery, { layout: 'masonry', columns: 2 })]),
    )
    expect(masonry).toContain('columns:2')
    expect(masonry).not.toContain('aspect-ratio:4/3')
  })
})

describe('carousel', () => {
  it('renders a region with a scroll-snap track and controls', () => {
    const html = bare(out(slides(3, { autoplay: true, interval: 5 })))
    expect(html).toMatch(/<section class="s-carousel s-[0-9a-z]+" aria-roledescription="carrossel"/)
    expect(html).toContain('aria-label="Destaques"')
    expect(html).toContain('data-s-carousel=""')
    expect(html).toContain('data-autoplay="5"')
    expect(html).toContain('data-loop=""')
    expect(html.match(/class="s-slide /g)).toHaveLength(3)
    expect(html.match(/data-s-dot=/g)).toHaveLength(3)
    expect(html).toContain('aria-current="true"')
    expect(html).toContain('data-s-prev=""')
    expect(html).toContain('data-s-pause=""')
    expect(html).not.toContain('data-canvas-id')
  })

  it('omits controls for a single slide or when all are off', () => {
    expect(out(slides(1))).not.toContain('s-carousel-controls')
    const off = out(
      slides(2, { arrows: false, dots: false, autoplay: false, loop: false }),
    )
    expect(off).not.toContain('s-carousel-controls')
    expect(off).not.toContain('data-loop')
    expect(off).toContain('aria-label="Destaques"')
    expect(out(slides(2, { label: '' }))).toContain('aria-label="Carrossel"')
  })

  it('shows the selected slide in the editor, with selectable dots and arrows', () => {
    const doc = siteDoc([slides(3)])
    const carousel = nodeOfType(doc, SITE_TYPES.carousel)
    const [, second, third] = carousel.children as string[]
    const html = renderSiteEditing(doc, {}, { [carousel.id]: second })
    expect(html).not.toContain('Slide 1')
    expect(html).toContain('Slide 2')
    expect(html).toContain(
      `data-s-dot="1" aria-label="Ir para o slide 2" aria-current="true" data-canvas-id="${second}"`,
    )
    expect(html).toContain(
      `data-s-next="" aria-label="Próximo slide" data-canvas-id="${third}"`,
    )
    expect(html).not.toContain('data-s-carousel')
    expect(html).not.toContain('data-s-pause')
    // Unknown active child: the first slide.
    expect(renderSiteEditing(doc, {}, { [carousel.id]: 'nope' })).toContain(
      'Slide 1',
    )
  })

  it('compiles the slide width from slides per view and gap', () => {
    const css = compileSiteCss(
      siteDoc([
        slides(2, {
          perView: { base: 3, mobile: 1 },
          gap: 20,
          controlColor: 'token:accent',
        }),
      ]),
    )
    expect(css).toContain('flex:0 0 calc((100% - 40px) / 3)')
    expect(css).toContain('flex:0 0 100%')
    expect(css).toContain('background-color:var(--canvas-accent)')
    expect(css).toContain('scroll-snap-type:x mandatory')
  })

  it('builds a palette fragment of three slides', () => {
    const fragment = carouselFragment(2)
    expect(fragment.nodes.carousel.children).toEqual(['slide-0', 'slide-1'])
    expect(
      (fragmentForType(siteCatalog, SITE_TYPES.carousel) as CanvasFragment)
        .nodes,
    ).toBeDefined()
  })

  it('renders the controls on their own for other sliders', () => {
    expect(
      renderToStaticMarkup(
        CarouselControls({
          count: 3,
          arrows: false,
          dots: false,
          autoplay: true,
        }) as never,
      ),
    ).toContain('data-s-pause')
    expect(
      CarouselControls({ count: 1, arrows: true, dots: true, autoplay: false }),
    ).toBeNull()
  })
})

describe('slide', () => {
  it('has its own background and a drop hint when empty (the script names it)', () => {
    const doc = siteDoc([
      spec(SITE_TYPES.carousel, {}, [spec(SITE_TYPES.slide, {}, [])]),
    ])
    expect(renderSiteEditing(doc)).toContain(
      'Arraste elementos para este slide',
    )
    expect(renderSite(doc)).toMatch(/<div class="s-slide s-[0-9a-z]+"><\/div>/)
    expect(compileSiteCss(doc)).toContain(
      'background-color:var(--canvas-surface)',
    )
  })
})

function tabsSpec(props: Record<string, unknown> = {}) {
  return spec(SITE_TYPES.tabs, props, [
    spec(SITE_TYPES.tab, { label: 'Um', icon: 'star' }, [text('Painel um')]),
    spec(SITE_TYPES.tab, { label: '' }, [text('Painel dois')]),
    spec(SITE_TYPES.tab, { label: 'Oculta' }, []),
  ])
}

describe('tabs', () => {
  it('renders the WAI-ARIA tabs pattern with every panel', () => {
    const doc = siteDoc([tabsSpec()])
    const hidden = nodeOfType(doc, SITE_TYPES.tabs).children?.[2] as string
    doc.nodes[hidden] = { ...doc.nodes[hidden], meta: { hidden: true } }
    const html = bare(renderSite(doc))
    expect(html).toContain('data-s-tabs=""')
    expect(html.match(/role="tab"/g)).toHaveLength(2)
    expect(html).toMatch(
      /aria-selected="true" tabindex="0" class="s-tab-btn"><svg\/>Um</,
    )
    expect(html).toContain('Aba 2')
    expect(html).not.toContain('Oculta')
    expect(html.match(/role="tabpanel"/g)).toHaveLength(2)
    expect(html).toContain('Painel dois')
  })

  it('shows the selected tab in the editor and selects tabs by their button', () => {
    const doc = siteDoc([tabsSpec({ orientation: 'vertical' })])
    const tabs = nodeOfType(doc, SITE_TYPES.tabs)
    const second = tabs.children?.[1] as string
    const html = renderSiteEditing(doc, {}, { [tabs.id]: second })
    expect(html).toContain('aria-orientation="vertical"')
    expect(html).toContain('s-tabs-vertical')
    expect(html).toContain('Painel dois')
    expect(html).not.toContain('Painel um')
    expect(html).toContain(`data-canvas-id="${second}">Aba 2`)
    const third = tabs.children?.[2] as string
    expect(renderSiteEditing(doc, {}, { [tabs.id]: third })).toContain(
      'Arraste elementos para esta aba',
    )
  })

  it('compiles the colors and the vertical layout', () => {
    const css = compileSiteCss(
      siteDoc([
        tabsSpec({
          orientation: 'vertical',
          activeColor: '#ff0000',
          align: 'stretch',
        }),
      ]),
    )
    expect(css).toContain('--s-tab-active:#ff0000')
    expect(css).toContain('grid-template-columns:minmax(160px, 260px) 1fr')
    const stretch = compileSiteCss(siteDoc([tabsSpec({ align: 'stretch' })]))
    expect(stretch).toContain('flex:1 1 0')
    expect(compileSiteCss(siteDoc([tabsSpec({ align: 'center' })]))).toContain(
      'justify-content:center',
    )
  })

  it('hints how to add tabs to an empty one', () => {
    const doc = siteDoc([spec(SITE_TYPES.tabs, {}, [])])
    expect(renderSiteEditing(doc)).toContain('Adicione abas')
  })
})

function accordionSpec(props: Record<string, unknown> = {}) {
  return spec(SITE_TYPES.accordion, props, [
    spec(
      SITE_TYPES.accordionItem,
      { title: 'Primeira', open: true, anchor: 'q1' },
      [text('Resposta um')],
    ),
    spec(SITE_TYPES.accordionItem, { title: '' }, []),
  ])
}

describe('accordion', () => {
  it('renders native details grouped by name (exclusive)', () => {
    const html = bare(out(accordionSpec()))
    expect(html.match(/<details/g)).toHaveLength(2)
    expect(html).toMatch(
      /<details id="q1" class="s-acc-item s-[0-9a-z]+" name="acc-[^"]+" open="">/,
    )
    expect(html).toContain('<h3 class="s-acc-title s-t-h6">Primeira</h3>')
    expect(html).toContain('>Pergunta</h3>')
    expect(html).toContain('<div class="s-acc-body">')
  })

  it('lets several stay open and uses the plus icon and heading level', () => {
    const html = out(
      accordionSpec({
        multiple: true,
        icon: 'plus',
        headingLevel: 'h2',
        titlePreset: 'h4',
      }),
    )
    expect(html).not.toContain('name="acc-')
    expect(html).toContain('s-acc-plus')
    expect(html).toContain('<h2 class="s-acc-title s-t-h4">')
  })

  it('opens the item being edited and carries its canvas id', () => {
    const doc = siteDoc([accordionSpec()])
    const accordion = nodeOfType(doc, SITE_TYPES.accordion)
    const second = accordion.children?.[1] as string
    const html = renderSiteEditing(doc, {}, { [accordion.id]: second })
    expect(html).toContain(`open="" data-canvas-id="${second}"`)
    expect(html).toContain('Arraste a resposta para cá')
    expect(
      renderSiteEditing(siteDoc([spec(SITE_TYPES.accordion, {}, [])])),
    ).toContain('Adicione itens')
  })

  it('compiles the item colors, radius and gap', () => {
    const css = compileSiteCss(
      siteDoc([
        accordionSpec({
          itemBackground: '#ffffff',
          borderColor: 'token:border',
          radius: { topLeft: 4, topRight: 4, bottomRight: 4, bottomLeft: 4 },
        }),
      ]),
    )
    expect(css).toContain('--s-acc-bg:#ffffff')
    expect(css).toContain('--s-acc-border:var(--canvas-border)')
    expect(css).toContain('border-radius:4px 4px 4px 4px')
  })
})

function popupDoc(props: Record<string, unknown> = {}) {
  return toDocument([
    section({}, [
      button(
        'Abrir',
        { type: 'url', value: '' },
        { interaction: { action: 'popup', target: 'oferta' } },
      ),
    ]),
    spec(SITE_TYPES.popup, { anchor: 'oferta', ...props }, [
      heading('h2', 'Oferta'),
    ]),
  ])
}

describe('popup', () => {
  it('renders a closed dialog with its trigger settings', () => {
    const html = bare(
      renderSite(popupDoc({ trigger: 'delay', delay: 3, frequency: 'once' })),
    )
    expect(html).toMatch(
      /<dialog id="oferta" class="s-popup s-popup-center s-[0-9a-z]+" aria-label="Oferta" data-s-popup="" data-trigger="delay" data-delay="3" data-freq="once" data-overlay-close="">/,
    )
    expect(html).toContain('data-s-close="" aria-label="Fechar"')
    expect(html).not.toContain(' open')
    // The button that opens it is a real button with the action.
    expect(html).toContain('data-s-action="popup" data-s-target="oferta"')
    expect(html).toContain('<button type="button" class="s-btn s-btn-primary">')
  })

  it('uses a generated id, scroll settings and no close button when asked', () => {
    const doc = popupDoc({
      anchor: '',
      trigger: 'scroll',
      scrollPercent: 40,
      showClose: false,
      closeOnOverlay: false,
      name: '',
    })
    const popup = nodeOfType(doc, SITE_TYPES.popup)
    const html = renderSite(doc)
    expect(html).toContain(`id="popup-${popup.id}"`)
    expect(html).toContain('data-scroll="40"')
    expect(html).toContain('aria-label="Popup"')
    expect(html).not.toContain('data-s-close')
    expect(html).not.toContain('data-overlay-close')
    expect(renderSite(popupDoc())).not.toContain('data-freq')
  })

  it('folds into a chip in the editor until it is selected', () => {
    const doc = popupDoc({ name: 'Boas-vindas' })
    const popup = nodeOfType(doc, SITE_TYPES.popup)
    const folded = bare(renderSiteEditing(doc))
    expect(folded).toContain(
      `class="s-popup-chip" data-canvas-id="${popup.id}"><svg/>Popup: Boas-vindas</button>`,
    )
    expect(folded).not.toContain('s-popup-stage')
    const open = renderSiteEditing(doc, {}, { [doc.rootId]: popup.id })
    expect(open).toContain(`data-canvas-id="${popup.id}" class="s-popup-stage"`)
    expect(open).not.toContain('<dialog')
    expect(open).toContain('tabindex="-1"')
    const empty = toDocument([spec(SITE_TYPES.popup, {}, [])])
    const emptyPopup = nodeOfType(empty, SITE_TYPES.popup)
    expect(
      renderSiteEditing(empty, {}, { [empty.rootId]: emptyPopup.id }),
    ).toContain('Arraste elementos para o popup')
    expect(
      renderSiteEditing(toDocument([spec(SITE_TYPES.popup, { name: '' }, [])])),
    ).toContain('Popup: Popup')
  })

  it('compiles the window size, backdrop and position', () => {
    const css = compileSiteCss(
      popupDoc({
        width: 600,
        overlayColor: 'token:dark',
        overlayOpacity: 40,
        position: 'bottom-right',
      }),
    )
    expect(css).toContain('width:min(600px, calc(100vw - 32px))')
    expect(css).toContain(
      '::backdrop{background:color-mix(in srgb, var(--canvas-dark) 40%, transparent)}',
    )
    expect(css).toContain(
      '.s-site .s-popup-bottom-right{margin:auto 24px 24px auto}',
    )
  })

  it('only lives at the page root', () => {
    const doc = siteDoc([spec(SITE_TYPES.popup, {}, [])])
    expect(validateDocument(doc, siteCatalog).ok).toBe(false)
  })
})

describe('countdown', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-15T12:00:00-03:00'))
  })
  afterEach(() => vi.useRealTimers())

  const countdown = (props: Partial<SiteCountdownProps>) =>
    spec(SITE_TYPES.countdown, { date: '2026-10-17', time: '13:30', ...props })

  it('renders the remaining time with the end instant for the script', () => {
    const html = out(countdown({}))
    expect(html).toContain('role="timer"')
    expect(html).toContain('data-s-countdown="2026-10-17T13:30:00-03:00"')
    expect(html).toContain('data-expired="A oferta terminou."')
    expect(html).toContain(
      'data-unit="d">02</span><span class="s-cd-label">dias',
    )
    expect(html).toContain('data-unit="h">01</span>')
    expect(html).toContain('data-unit="m">30</span>')
    expect(html).toContain('data-unit="s">00</span>')
  })

  it('shows the ended text, hides without a date and omits labels', () => {
    expect(out(countdown({ date: '2026-10-01' }))).toContain(
      '<p class="s-cd-expired">A oferta terminou.</p>',
    )
    expect(out(countdown({ date: '' }))).not.toContain('s-countdown')
    const hours = out(
      countdown({ units: 'hms', showLabels: false, style: 'plain' }),
    )
    expect(hours).toContain('data-unit="h">49</span>')
    expect(hours).not.toContain('s-cd-label')
    expect(hours).toContain('s-countdown-plain')
    expect(out(countdown({ units: 'dhm' }))).not.toContain('data-unit="s"')
  })

  it('shows zeros in the editor without a date and no script data', () => {
    const html = edit(countdown({ date: '' }))
    expect(html).toContain('data-unit="d">00</span>')
    expect(html).not.toContain('data-s-countdown')
    expect(edit(countdown({ date: '2026-10-01' }))).not.toContain(
      's-cd-expired',
    )
  })

  it('computes its end, parts and default date', () => {
    expect(
      countdownEnd({
        date: '2026-12-31',
        time: '',
        offset: '+00:00',
      } as SiteCountdownProps),
    ).toBe('2026-12-31T00:00:00+00:00')
    expect(countdownParts(90_061_000, ['d', 'h', 'm', 's'])).toEqual({
      d: 1,
      h: 1,
      m: 1,
      s: 1,
    })
    expect(countdownParts(-5, ['h', 'm'])).toEqual({ d: 0, h: 0, m: 0, s: 0 })
    expect(inAWeek(Date.parse('2026-10-15T00:00:00Z'))).toBe('2026-10-22')
  })

  it('compiles sizes and colors', () => {
    const css = compileSiteCss(
      siteDoc([
        countdown({
          numberColor: '#111111',
          boxBackground: 'token:surface',
          align: 'left',
        }),
      ]),
    )
    expect(css).toContain('--s-cd-size:48px')
    expect(css).toContain('--s-cd-size:32px')
    expect(css).toContain('.s-cd-num{color:#111111}')
    expect(css).toContain('justify-content:flex-start')
  })
})

describe('stats', () => {
  it('renders formatted numbers with count-up data', () => {
    const html = out(spec(SITE_TYPES.stats, {}))
    expect(html).toContain('data-s-stats="" data-duration="1600"')
    expect(html).toContain('data-s-count="1200" data-prefix="+">+1.200</span>')
    expect(html).toContain('data-s-count="4.9" data-decimals="1">4,9</span>')
    expect(html).toContain('<span class="s-stat-label">de satisfação</span>')
  })

  it('renders static numbers without animation and in the editor', () => {
    const props: Partial<SiteStatsProps> = {
      animate: false,
      dividers: true,
      items: [{ label: 'Sem valor' }],
    }
    const html = out(spec(SITE_TYPES.stats, props))
    expect(html).not.toContain('data-s-count')
    expect(html).toContain('s-stats-divided')
    expect(html).toContain('>0</span>')
    expect(edit(spec(SITE_TYPES.stats, {}))).not.toContain('data-s-stats')
    expect(formatStat(1234.5, 2)).toBe('1.234,50')
  })

  it('compiles columns, size and alignment', () => {
    const css = compileSiteCss(
      siteDoc([spec(SITE_TYPES.stats, { align: 'right' })]),
    )
    expect(css).toContain('grid-template-columns:repeat(4, minmax(0, 1fr))')
    expect(css).toContain('font-size:48px')
    expect(css).toContain('align-items:flex-end')
  })
})

describe('testimonials', () => {
  it('renders cards with stars, quote and author', () => {
    const html = bare(out(spec(SITE_TYPES.testimonials, {})))
    expect(html.match(/class="s-tm-card"/g)).toHaveLength(3)
    expect(html).toContain('role="img" aria-label="5 de 5 estrelas"')
    expect(html).toContain('<blockquote class="s-tm-quote"><p>Atendimento')
    expect(html).toContain('class="s-tm-avatar"')
    expect(html).not.toContain('s-carousel')
  })

  it('becomes a carousel in slider mode', () => {
    const html = out(
      spec(SITE_TYPES.testimonials, {
        layout: 'slider',
        autoplay: true,
        interval: 4,
      }),
    )
    expect(html).toContain('s-testimonials s-carousel')
    expect(html).toContain('data-s-carousel="" data-autoplay="4" data-loop=""')
    expect(html).toContain('class="s-tm-list s-carousel-track"')
    expect(html.match(/data-s-dot=/g)).toHaveLength(3)
  })

  it('hides ratings, avatars and roles when asked', () => {
    const html = out(
      spec(SITE_TYPES.testimonials, {
        showRating: false,
        showAvatar: false,
        items: [{ quote: 'Ótimo', name: 'Ana', rating: 0 }],
      }),
    )
    expect(html).not.toContain('s-stars')
    expect(html).not.toContain('s-tm-avatar')
    expect(html).not.toContain('s-tm-role')
    expect(out(spec(SITE_TYPES.testimonials, { items: [] }))).not.toContain(
      's-testimonials',
    )
    expect(edit(spec(SITE_TYPES.testimonials, { items: [] }))).toContain(
      'Adicione depoimentos',
    )
  })

  it('compiles the grid, the slider width and the cards', () => {
    const grid = compileSiteCss(
      siteDoc([
        spec(SITE_TYPES.testimonials, {
          align: 'center',
          cardBackground: '#fafafa',
        }),
      ]),
    )
    expect(grid).toContain('display:grid')
    expect(grid).toContain('background-color:#fafafa')
    expect(grid).toContain('.s-tm-author{justify-content:center}')
    const slider = compileSiteCss(
      siteDoc([
        spec(SITE_TYPES.testimonials, {
          layout: 'slider',
          columns: 2,
          gap: 24,
        }),
      ]),
    )
    expect(slider).toContain('flex:0 0 calc((100% - 24px) / 2)')
    expect(slider).toContain('scroll-snap-type')
  })
})

describe('pricing', () => {
  it('renders plans with features, badge and buttons', () => {
    const html = bare(out(spec(SITE_TYPES.pricing, {})))
    expect(html.match(/<li class="s-plan/g)).toHaveLength(3)
    expect(html).toContain(
      '<li class="s-plan s-plan-hl"><span class="s-plan-badge">Mais escolhido</span>',
    )
    expect(html).toContain('<h3 class="s-plan-name s-t-h5">Essencial</h3>')
    expect(html).toContain(
      '<span class="s-plan-amount">R$ 49</span><span class="s-plan-period">/mês</span>',
    )
    expect(html).toContain('<li><svg/><span>Suporte por e-mail</span></li>')
    expect(html).toContain(
      '<a href="#contato" class="s-btn s-btn-outline">Começar</a>',
    )
    expect(html).toContain('class="s-btn s-btn-secondary">Assinar agora</a>')
  })

  it('handles plans without link, features, period or name', () => {
    const html = out(
      spec(SITE_TYPES.pricing, {
        plans: [
          {
            name: '',
            price: 'Grátis',
            features: ' \n ',
            buttonLabel: 'Já',
            link: { type: 'url', value: '' },
          },
          {
            name: 'B',
            price: '1',
            features: 'x',
            buttonLabel: '',
            link: { type: 'url', value: '' },
          },
        ],
      }),
    )
    expect(html).toContain('Plano 1')
    expect(html.match(/s-plan-features/g)).toHaveLength(1)
    expect(html).toContain('<span class="s-btn s-btn-outline">Já</span>')
    expect(html).not.toContain('s-plan-period')
  })

  it('compiles card colors and alignment', () => {
    const css = compileSiteCss(
      siteDoc([
        spec(SITE_TYPES.pricing, {
          align: 'center',
          highlightBackground: 'token:dark',
          checkColor: '#00ff00',
        }),
      ]),
    )
    expect(css).toContain('background-color:var(--canvas-dark)')
    expect(css).toContain('.s-plan-features svg{color:#00ff00}')
    expect(css).toContain('.s-plan-badge{align-self:center}')
  })
})

describe('logos', () => {
  it('scrolls a duplicated, hidden copy of the list in marquee mode', () => {
    const html = out(
      spec(SITE_TYPES.logos, {
        items: [
          {
            image: { src: '/a.png', alt: 'Acme' },
            link: { type: 'url', value: 'https://acme.com' },
          },
        ],
      }),
    )
    expect(html).toContain('s-logos s-logos-marquee')
    expect(html.match(/class="s-logos-list"/g)).toHaveLength(2)
    expect(html).toContain('aria-hidden="true"')
    expect(html).toContain(
      '<a href="https://acme.com" tabindex="-1"><img src="/a.png" alt=""',
    )
    expect(html).toContain(
      '<a href="https://acme.com"><img src="/a.png" alt="Acme"',
    )
  })

  it('renders a single grid, and nothing without logos', () => {
    const html = out(spec(SITE_TYPES.logos, { mode: 'grid' }))
    expect(html.match(/class="s-logos-list"/g)).toHaveLength(1)
    expect(html).not.toContain('s-marquee-track')
    expect(out(spec(SITE_TYPES.logos, { items: [] }))).not.toContain('s-logos')
    expect(edit(spec(SITE_TYPES.logos, { items: [] }))).toContain(
      'Adicione logos',
    )
  })

  it('compiles speed, height and grayscale', () => {
    const css = compileSiteCss(siteDoc([spec(SITE_TYPES.logos, { speed: 20 })]))
    expect(css).toContain('animation-duration:20s')
    expect(css).toContain('filter:grayscale(1)')
    expect(css).toContain('li:hover img{filter:none;opacity:1}')
    const grid = compileSiteCss(
      siteDoc([spec(SITE_TYPES.logos, { mode: 'grid', grayscale: false })]),
    )
    expect(grid).toContain('justify-items:center')
    expect(grid).not.toContain('grayscale(1)')
  })
})

describe('map', () => {
  it('waits for a click before loading Google Maps', () => {
    const html = bare(out(spec(SITE_TYPES.map, {})))
    expect(html).not.toContain('<iframe')
    expect(html).toContain(
      'data-s-map-load="https://www.google.com/maps?q=Avenida%20Paulista',
    )
    expect(html).toContain('Abrir no Google Maps')
    expect(html).toContain(
      'Ao carregar, o Google Maps recebe dados da sua visita.',
    )
  })

  it('embeds directly when the owner opts out, and hides without address', () => {
    const html = out(spec(SITE_TYPES.map, { loadOnClick: false, title: '' }))
    expect(html).toContain('<iframe src="https://www.google.com/maps?q=')
    expect(html).toContain('title="Mapa"')
    expect(html).toContain('loading="lazy"')
    expect(out(spec(SITE_TYPES.map, { address: '  ' }))).not.toContain('s-map')
    const editing = edit(
      spec(SITE_TYPES.map, { address: '', loadOnClick: false }),
    )
    expect(editing).toContain('Informe o endereço')
    expect(editing).not.toContain('data-s-map-load')
  })

  it('builds the embed and open URLs', () => {
    expect(mapUrls(' Rua A, 1 ', 12)).toEqual({
      embed: 'https://www.google.com/maps?q=Rua%20A%2C%201&z=12&output=embed',
      open: 'https://www.google.com/maps/search/?api=1&query=Rua%20A%2C%201',
    })
    const css = compileSiteCss(siteDoc([spec(SITE_TYPES.map, {})]))
    expect(css).toContain('height:400px')
    expect(css).toContain('height:300px')
  })
})

describe('whatsapp', () => {
  it('links to wa.me with the starting message', () => {
    expect(whatsappHref('+55 (11) 91234-5678', ' Oi ')).toBe(
      'https://wa.me/5511912345678?text=Oi',
    )
    expect(whatsappHref('5511', '')).toBe('https://wa.me/5511')
    expect(whatsappHref('', 'x')).toBeNull()
  })

  it('floats an icon button by default', () => {
    const html = bare(
      out(spec(SITE_TYPES.whatsapp, { phone: '5511999999999' })),
    )
    expect(html).toContain('s-wa s-wa-floating s-wa-right s-wa-icon')
    expect(html).toContain('aria-label="Fale no WhatsApp"><svg/></a>')
    expect(html).toContain('target="_blank" rel="noopener noreferrer"')
  })

  it('shows its text inline or when asked, large and on the left', () => {
    const inline = bare(
      out(
        spec(SITE_TYPES.whatsapp, {
          phone: '1',
          mode: 'inline',
          size: 'lg',
          label: '',
        }),
      ),
    )
    expect(inline).toContain('s-wa s-wa-inline s-wa-lg')
    expect(inline).toContain('<svg/><span>Fale no WhatsApp</span>')
    const labeled = out(
      spec(SITE_TYPES.whatsapp, { phone: '1', side: 'left', showLabel: true }),
    )
    expect(labeled).toContain('s-wa-left')
    expect(labeled).not.toContain('s-wa-icon')
    expect(out(spec(SITE_TYPES.whatsapp, {}))).not.toContain('s-wa')
    expect(edit(spec(SITE_TYPES.whatsapp, {}))).toContain('s-wa')
  })

  it('compiles the colors and inline alignment', () => {
    const css = compileSiteCss(
      siteDoc([
        spec(SITE_TYPES.whatsapp, {
          mode: 'inline',
          align: 'center',
          phone: '1',
        }),
      ]),
    )
    expect(css).toContain('background-color:#25D366')
    expect(css).toContain('justify-content:center')
  })
})

describe('before and after', () => {
  it('layers both photos under a native range input', () => {
    const html = out(spec(SITE_TYPES.beforeAfter, { start: 30 }))
    expect(html).toContain('data-s-ba=""')
    expect(html).toContain(
      '<div class="s-ba-after"><img src="/landing-page-templates/agency/work-3.png" alt="Depois"',
    )
    expect(html).toContain(
      'type="range" class="s-ba-range" min="0" max="100" aria-label="Comparar Antes e Depois" value="30"',
    )
    expect(html).toContain('s-ba-label-before')
  })

  it('goes vertical, drops empty labels and asks for missing photos', () => {
    const html = out(
      spec(SITE_TYPES.beforeAfter, {
        orientation: 'vertical',
        beforeLabel: '',
        afterLabel: '',
      }),
    )
    expect(html).toContain('s-ba s-ba-v')
    expect(html).toContain('aria-orientation="vertical"')
    expect(html).toContain('aria-label="Comparar antes e depois"')
    expect(html).not.toContain('s-ba-label')
    const missing = spec(SITE_TYPES.beforeAfter, {
      after: { src: '', alt: '' },
    })
    expect(out(missing)).not.toContain('s-ba')
    expect(edit(missing)).toContain('Escolha as imagens de antes e depois')
    expect(edit(spec(SITE_TYPES.beforeAfter, {}))).toContain('disabled=""')
  })

  it('compiles the divider position and a default proportion', () => {
    const css = compileSiteCss(
      siteDoc([
        spec(SITE_TYPES.beforeAfter, {
          aspectRatio: 'auto',
          handleColor: 'token:primary',
        }),
      ]),
    )
    expect(css).toContain('--s-pos:50%')
    expect(css).toContain('aspect-ratio:4/3')
    expect(css).toContain(
      '.s-ba-handle{background-color:var(--canvas-primary)}',
    )
  })
})

describe('structural CSS', () => {
  it('ships element rules only when the page uses them', () => {
    const plain = compileSiteCss(siteDoc([text('Oi')]))
    expect(plain).not.toContain('s-carousel')
    expect(plain).not.toContain('prefers-reduced-motion')
    const used = cssUsage([siteDoc([slides(1)])])
    expect([...used.types]).toContain(SITE_TYPES.carousel)
    expect(used.animations).toBe(false)
  })

  it('adds the editor affordances while editing', () => {
    const css = compileSiteCss(siteDoc([text('Oi')]), { editing: true })
    expect(css).toContain('.s-site.s-editing .s-popup-chip')
  })
})

describe('element presets and the event template', () => {
  it('ships every element section in each kit, valid', () => {
    expect(SITE_ELEMENT_PRESETS).toHaveLength(
      SITE_ELEMENT_SECTION_TYPES.length * 3,
    )
    for (const preset of SITE_ELEMENT_PRESETS) {
      const fragment = preset.fragment()
      const root = fragment.nodes[fragment.rootId]
      const doc =
        root.type === SITE_TYPES.popup || root.type === SITE_TYPES.section
          ? {
              ...toDocument([]),
              nodes: {
                ...toDocument([]).nodes,
                ...fragment.nodes,
                root: {
                  ...toDocument([]).nodes.root,
                  children: [fragment.rootId],
                },
              },
            }
          : null
      expect(doc, preset.id).not.toBeNull()
      const result = validateDocument(doc as never, siteCatalog)
      expect(result.ok ? 'ok' : JSON.stringify(result.error), preset.id).toBe(
        'ok',
      )
    }
  })

  it('renders the event template with every interactive element', () => {
    const template = getSiteTemplate('evento')
    const html = renderSite(template?.document() as never)
    for (const marker of [
      'data-s-carousel',
      'data-s-tabs',
      '<details',
      'data-s-stats',
      'data-s-map-load',
      's-wa-floating',
      'data-s-popup',
      's-pricing',
    ]) {
      expect(html, marker).toContain(marker)
    }
    expect(box({}, [])).toBeDefined()
  })
})

describe('edge cases', () => {
  it('skips missing children and compiles image backgrounds of slides', () => {
    const doc = siteDoc([
      spec(SITE_TYPES.carousel, {}, [
        spec(SITE_TYPES.slide, {
          background: {
            kind: 'image',
            url: '/bg.png',
            position: 'center',
            size: 'cover',
            repeat: false,
          },
        }, [text('Oi')]),
      ]),
    ])
    doc.nodes.root = {
      ...doc.nodes.root,
      children: [...(doc.nodes.root.children ?? []), 'ghost'],
    }
    expect(renderSite(doc)).toContain('s-carousel')
    expect(compileSiteCss(doc)).toContain('background-image:url("/bg.png")')
  })
})
