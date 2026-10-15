// @vitest-environment jsdom
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { renderSite, siteDoc } from '@/src/__tests__/helpers/site-canvas'
import type { CanvasDocument } from '@/src/lib/canvas/types'
import { SITE_TYPES } from '@/src/lib/canvas-site/constants'
import {
  box,
  button,
  heading,
  section,
  spec,
  text,
  toDocument,
  url,
} from '@/src/lib/canvas-site/presets/builder'
import {
  SITE_ACTIONS_SCRIPT,
  SITE_BEFORE_AFTER_SCRIPT,
  SITE_BOOT_SCRIPT,
  SITE_CAROUSEL_SCRIPT,
  SITE_COUNTDOWN_SCRIPT,
  SITE_LIGHTBOX_SCRIPT,
  SITE_MAP_SCRIPT,
  SITE_REVEAL_SCRIPT,
  SITE_STATS_SCRIPT,
  SITE_TABS_SCRIPT,
} from '@/src/lib/canvas-site/runtime'

/** Runs an inline page script the way the browser does. */
function run(code: string) {
  // biome-ignore lint/security/noGlobalEval: runs the inline page script under test
  window.eval(code)
}

function mount(doc: CanvasDocument) {
  document.body.innerHTML = renderSite(doc)
}

const click = (element: Element | null) =>
  (element as HTMLElement).dispatchEvent(
    new MouseEvent('click', { bubbles: true, cancelable: true }),
  )

const key = (element: Element | null, value: string) =>
  (element as HTMLElement).dispatchEvent(
    new KeyboardEvent('keydown', {
      key: value,
      bubbles: true,
      cancelable: true,
    }),
  )

const scrollTo = vi.fn()

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
    configurable: true,
    value: scrollTo,
  })
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  scrollTo.mockClear()
  document.documentElement.className = ''
})

describe('boot', () => {
  it('marks JavaScript as available', () => {
    run(SITE_BOOT_SCRIPT)
    expect(document.documentElement.classList.contains('s-js')).toBe(true)
  })
})

function carouselDoc(props: Record<string, unknown> = {}) {
  return siteDoc([
    spec(
      SITE_TYPES.carousel,
      props,
      [1, 2, 3].map((n) =>
        spec(SITE_TYPES.slide, {}, [heading('h3', `Slide ${n}`)]),
      ),
    ),
  ])
}

describe('carousel', () => {
  it('labels the slides and moves with arrows, dots and keys', () => {
    mount(carouselDoc())
    run(SITE_CAROUSEL_SCRIPT)
    const slides = document.querySelectorAll('.s-slide')
    expect(slides[2].getAttribute('aria-label')).toBe('3 de 3')
    click(document.querySelector('[data-s-next]'))
    click(document.querySelector('[data-s-prev]'))
    click(document.querySelectorAll('[data-s-dot]')[2])
    key(document.querySelector('.s-carousel'), 'ArrowRight')
    key(document.querySelector('.s-carousel'), 'ArrowLeft')
    key(document.querySelector('.s-slide'), 'Enter')
    expect(scrollTo).toHaveBeenCalledTimes(5)
    expect(scrollTo.mock.calls[0][0]).toMatchObject({ behavior: 'smooth' })
  })

  it('autoplays until paused, with the pause button labelled', () => {
    vi.useFakeTimers()
    mount(carouselDoc({ autoplay: true, interval: 3 }))
    run(SITE_CAROUSEL_SCRIPT)
    const root = document.querySelector('.s-carousel') as HTMLElement
    const pause = document.querySelector('[data-s-pause]') as HTMLButtonElement
    expect(pause.getAttribute('aria-pressed')).toBe('false')
    vi.advanceTimersByTime(3000)
    expect(scrollTo).toHaveBeenCalledTimes(1)
    root.dispatchEvent(new MouseEvent('mouseenter'))
    vi.advanceTimersByTime(6000)
    expect(scrollTo).toHaveBeenCalledTimes(1)
    root.dispatchEvent(new MouseEvent('mouseleave'))
    root.dispatchEvent(new FocusEvent('focusin'))
    root.dispatchEvent(new FocusEvent('focusout', { relatedTarget: null }))
    click(pause)
    expect(pause.getAttribute('aria-pressed')).toBe('true')
    expect(pause.getAttribute('aria-label')).toBe(
      'Retomar a passagem automática',
    )
    vi.advanceTimersByTime(9000)
    expect(scrollTo).toHaveBeenCalledTimes(1)
    click(pause)
    vi.advanceTimersByTime(3000)
    expect(scrollTo).toHaveBeenCalledTimes(2)
    const track = document.querySelector('.s-carousel-track') as HTMLElement
    track.dispatchEvent(new Event('pointerdown'))
    track.dispatchEvent(new Event('scroll'))
    vi.advanceTimersByTime(9000)
    expect(scrollTo).toHaveBeenCalledTimes(2)
  })

  it('disables the arrows at the ends without loop', () => {
    mount(carouselDoc({ loop: false }))
    run(SITE_CAROUSEL_SCRIPT)
    expect(
      (document.querySelector('[data-s-prev]') as HTMLButtonElement).disabled,
    ).toBe(true)
    expect(
      (document.querySelector('[data-s-next]') as HTMLButtonElement).disabled,
    ).toBe(true)
    click(document.querySelector('[data-s-next]'))
    expect(scrollTo).not.toHaveBeenCalled()
  })

  it('stays still for visitors who prefer reduced motion', () => {
    vi.useFakeTimers()
    vi.stubGlobal('matchMedia', () => ({ matches: true }))
    mount(carouselDoc({ autoplay: true, interval: 2 }))
    run(SITE_CAROUSEL_SCRIPT)
    expect(
      (document.querySelector('[data-s-pause]') as HTMLElement).hidden,
    ).toBe(true)
    vi.advanceTimersByTime(10_000)
    expect(scrollTo).not.toHaveBeenCalled()
    click(document.querySelector('[data-s-next]'))
    expect(scrollTo.mock.calls[0][0]).toMatchObject({ behavior: 'auto' })
  })
})

describe('tabs', () => {
  function tabsDoc() {
    return siteDoc([
      spec(SITE_TYPES.tabs, {}, [
        spec(SITE_TYPES.tab, { label: 'Um' }, [text('Painel um')]),
        spec(SITE_TYPES.tab, { label: 'Dois' }, [
          text('Painel dois', { anchor: 'dois' }),
        ]),
        spec(SITE_TYPES.tab, { label: 'Três' }, []),
      ]),
    ])
  }

  it('shows one panel and moves with click, arrows, Home and End', () => {
    mount(tabsDoc())
    run(SITE_TABS_SCRIPT)
    const tabs = document.querySelectorAll<HTMLElement>('[role=tab]')
    const panels = document.querySelectorAll<HTMLElement>('[role=tabpanel]')
    expect(
      document.querySelector('[data-s-tabs]')?.hasAttribute('data-ready'),
    ).toBe(true)
    expect(panels[1].hidden).toBe(true)
    click(tabs[1])
    expect(tabs[1].getAttribute('aria-selected')).toBe('true')
    expect(panels[0].hidden).toBe(true)
    key(tabs[1], 'ArrowRight')
    expect(document.activeElement).toBe(tabs[2])
    key(tabs[2], 'ArrowRight')
    expect(tabs[0].tabIndex).toBe(0)
    key(tabs[0], 'ArrowLeft')
    expect(tabs[2].getAttribute('aria-selected')).toBe('true')
    key(tabs[2], 'Home')
    expect(tabs[0].getAttribute('aria-selected')).toBe('true')
    key(tabs[0], 'End')
    expect(tabs[2].getAttribute('aria-selected')).toBe('true')
    key(tabs[2], 'a')
    expect(tabs[2].getAttribute('aria-selected')).toBe('true')
  })

  it('opens the tab that holds the anchor of the URL', () => {
    window.history.replaceState(null, '', '/#dois')
    mount(tabsDoc())
    run(SITE_TABS_SCRIPT)
    expect(
      document.querySelectorAll('[role=tab]')[1].getAttribute('aria-selected'),
    ).toBe('true')
    window.history.replaceState(null, '', '/')
  })
})

describe('actions and popups', () => {
  function popupDoc(popup: Record<string, unknown> = {}) {
    return toDocument([
      section({ anchor: 'topo' }, [
        button('Abrir', url(''), {
          interaction: { action: 'popup', target: 'oferta' },
        }),
        button('Link', { type: 'anchor', value: 'oferta' }),
        box({ anchor: 'caixa' }, [text('Caixa')]),
        text('Alternar', {
          interaction: { action: 'toggle', target: 'caixa' },
        }),
        text('Rolar', { interaction: { action: 'scroll', target: 'topo' } }),
        text('Fechar tudo', { interaction: { action: 'close' } }),
        text('Ir', { interaction: { action: 'link', link: url('/sobre') } }),
        text('Nova aba', {
          interaction: {
            action: 'link',
            link: { type: 'url', value: 'https://a.com', newTab: true },
          },
        }),
      ]),
      spec(SITE_TYPES.popup, { anchor: 'oferta', ...popup }, [
        heading('h2', 'Oferta'),
        text('Rolar e fechar', {
          interaction: { action: 'scroll', target: 'topo' },
        }),
      ]),
    ])
  }

  beforeAll(() => run(SITE_ACTIONS_SCRIPT))

  const dialog = () => document.querySelector('dialog') as HTMLDialogElement

  it('opens the popup from an interaction and an #anchor link, and closes it', () => {
    mount(popupDoc())
    run(SITE_ACTIONS_SCRIPT)
    const opener = document.querySelector('.s-btn') as HTMLElement
    opener.focus()
    click(opener)
    expect(dialog().hasAttribute('open')).toBe(true)
    click(document.querySelector('[data-s-close]'))
    expect(dialog().hasAttribute('open')).toBe(false)
    click(document.querySelector('a[href="#oferta"]'))
    expect(dialog().hasAttribute('open')).toBe(true)
    click(document.querySelector('dialog [data-s-action="scroll"]'))
    expect(dialog().hasAttribute('open')).toBe(false)
  })

  it('toggles, scrolls, closes everything and follows links', () => {
    const open = vi.fn()
    vi.stubGlobal('open', open)
    mount(popupDoc())
    const toggle = document.querySelector(
      '[data-s-action="toggle"]',
    ) as HTMLElement
    click(toggle)
    expect(document.getElementById('caixa')?.classList.contains('s-off')).toBe(
      true,
    )
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    key(toggle, 'Enter')
    expect(document.getElementById('caixa')?.classList.contains('s-off')).toBe(
      false,
    )
    click(document.querySelector('[data-s-action="scroll"]'))
    expect(document.getElementById('topo')?.scrollIntoView).toHaveBeenCalled()
    dialog().setAttribute('open', '')
    click(document.querySelector('[data-s-action="close"]'))
    expect(dialog().hasAttribute('open')).toBe(false)
    click(document.querySelector('[data-s-blank]'))
    expect(open).toHaveBeenCalledWith('https://a.com', '_blank', 'noopener')
  })

  it('uses the native modal and closes on the backdrop', () => {
    const showModal = vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute('open', '')
    })
    const close = vi.fn(function (this: HTMLDialogElement) {
      this.removeAttribute('open')
      this.dispatchEvent(new Event('close'))
    })
    const proto = HTMLElement.prototype as unknown as Record<string, unknown>
    proto.showModal = showModal
    proto.close = close
    try {
      mount(popupDoc())
      run(SITE_ACTIONS_SCRIPT)
      click(document.querySelector('.s-btn'))
      expect(showModal).toHaveBeenCalled()
      Object.defineProperty(dialog(), 'open', {
        configurable: true,
        get: () => dialog().hasAttribute('open'),
      })
      dialog().getBoundingClientRect = () =>
        ({ left: 10, right: 20, top: 10, bottom: 20 }) as DOMRect
      dialog().dispatchEvent(
        new MouseEvent('click', { bubbles: true, clientX: 15, clientY: 15 }),
      )
      expect(close).not.toHaveBeenCalled()
      dialog().dispatchEvent(
        new MouseEvent('click', { bubbles: true, clientX: 1, clientY: 1 }),
      )
      expect(close).toHaveBeenCalledTimes(1)
    } finally {
      delete proto.showModal
      delete proto.close
    }
  })

  it('opens automatically on load, delay, scroll and exit, once per visit', () => {
    vi.useFakeTimers()
    const memory = () => {
      const data = new Map<string, string>()
      return {
        getItem: (k: string) => data.get(k) ?? null,
        setItem: (k: string, v: string) => void data.set(k, v),
        get length() {
          return data.size
        },
      }
    }
    const local = memory()
    vi.stubGlobal('sessionStorage', memory())
    vi.stubGlobal('localStorage', local)
    const script = SITE_ACTIONS_SCRIPT
    mount(popupDoc({ trigger: 'load', frequency: 'session' }))
    run(script)
    expect(dialog().hasAttribute('open')).toBe(true)
    mount(popupDoc({ trigger: 'load', frequency: 'session' }))
    run(script)
    expect(dialog().hasAttribute('open')).toBe(false)

    mount(popupDoc({ trigger: 'delay', delay: 2, frequency: 'always' }))
    run(script)
    vi.advanceTimersByTime(1900)
    expect(dialog().hasAttribute('open')).toBe(false)
    vi.advanceTimersByTime(200)
    expect(dialog().hasAttribute('open')).toBe(true)

    mount(popupDoc({ trigger: 'scroll', scrollPercent: 50, frequency: 'once' }))
    run(script)
    window.dispatchEvent(new Event('scroll'))
    expect(dialog().hasAttribute('open')).toBe(true)
    expect(local.length).toBe(1)

    mount(popupDoc({ trigger: 'exit', frequency: 'always' }))
    run(script)
    document.dispatchEvent(new MouseEvent('mouseout', { clientY: 30 }))
    expect(dialog().hasAttribute('open')).toBe(false)
    document.dispatchEvent(new MouseEvent('mouseout', { clientY: 0 }))
    expect(dialog().hasAttribute('open')).toBe(true)
  })

  it('opens the popup named by the URL hash', () => {
    window.history.replaceState(null, '', '/#oferta')
    mount(popupDoc())
    run(SITE_ACTIONS_SCRIPT)
    expect(dialog().hasAttribute('open')).toBe(true)
    window.history.replaceState(null, '', '/')
  })
})

describe('lightbox', () => {
  beforeAll(() => run(SITE_LIGHTBOX_SCRIPT))

  it('opens the photos full screen and navigates between them', () => {
    mount(
      siteDoc([
        spec(SITE_TYPES.gallery, {
          items: [
            { image: { src: '/a.png', alt: 'A' }, caption: 'Primeira' },
            { image: { src: '/b.png', alt: 'B' } },
          ],
        }),
      ]),
    )
    click(
      document.querySelectorAll('[data-s-lightbox]')[0].querySelector('img'),
    )
    const box = document.querySelector('.s-lightbox') as HTMLElement
    expect(box.closest('.s-site')).not.toBeNull()
    const img = box.querySelector('img') as HTMLImageElement
    expect(img.getAttribute('src')).toBe('/a.png')
    expect(box.querySelector('figcaption')?.textContent).toBe('Primeira')
    click(box.querySelector('.s-lb-next'))
    expect(img.getAttribute('src')).toBe('/b.png')
    expect((box.querySelector('figcaption') as HTMLElement).hidden).toBe(true)
    key(box, 'ArrowRight')
    expect(img.getAttribute('src')).toBe('/a.png')
    key(box, 'ArrowLeft')
    click(box.querySelector('.s-lb-prev'))
    expect(img.getAttribute('src')).toBe('/a.png')
    const closeSpy = vi.fn(() => box.dispatchEvent(new Event('close')))
    ;(box as unknown as { close: () => void }).close = closeSpy
    click(box)
    click(box.querySelector('.s-lb-close'))
    expect(closeSpy).toHaveBeenCalledTimes(2)
    expect(document.querySelector('.s-lightbox')).toBeNull()
  })
})

describe('countdown', () => {
  it('ticks every second and shows the ended text', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-15T12:00:00-03:00'))
    mount(
      siteDoc([
        spec(SITE_TYPES.countdown, {
          date: '2026-10-15',
          time: '12:01',
          units: 'hms',
        }),
      ]),
    )
    // Render a few seconds before the end.
    const root = document.querySelector('[data-s-countdown]') as HTMLElement
    root.setAttribute('data-s-countdown', '2026-10-15T12:00:03-03:00')
    run(SITE_COUNTDOWN_SCRIPT)
    expect(root.querySelector('[data-unit=s]')?.textContent).toBe('03')
    vi.advanceTimersByTime(1000)
    expect(root.querySelector('[data-unit=s]')?.textContent).toBe('02')
    vi.advanceTimersByTime(3000)
    expect(root.textContent).toBe('A oferta terminou.')
    expect(root.hasAttribute('role')).toBe(false)
  })
})

describe('stats', () => {
  it('counts up from zero when the numbers come into view', () => {
    let callback: (
      entries: Array<{ isIntersecting: boolean; target: Element }>,
    ) => void = () => {}
    const unobserve = vi.fn()
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(cb: typeof callback) {
          callback = cb
        }
        observe() {}
        unobserve = unobserve
      },
    )
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) =>
      frames.push(cb),
    )
    mount(siteDoc([spec(SITE_TYPES.stats, { duration: 1000 })]))
    run(SITE_STATS_SCRIPT)
    const first = document.querySelector('.s-stat-num') as HTMLElement
    expect(first.textContent).toBe('+0')
    const list = document.querySelector('[data-s-stats]') as Element
    callback([{ isIntersecting: false, target: list }])
    callback([{ isIntersecting: true, target: list }])
    expect(unobserve).toHaveBeenCalledWith(list)
    for (const time of [0, 500, 1000]) {
      for (const frame of frames.splice(0)) frame(time)
    }
    expect(first.textContent).toBe('+1.200')
    expect(document.querySelectorAll('.s-stat-num')[3].textContent).toBe('4,9')
  })

  it('does nothing without IntersectionObserver or with reduced motion', () => {
    mount(siteDoc([spec(SITE_TYPES.stats, {})]))
    run(SITE_STATS_SCRIPT)
    expect(document.querySelector('.s-stat-num')?.textContent).toBe('+1.200')
  })
})

describe('map', () => {
  beforeAll(() => run(SITE_MAP_SCRIPT))

  it('loads Google Maps only after the click', () => {
    mount(siteDoc([spec(SITE_TYPES.map, {})]))
    expect(document.querySelector('iframe')).toBeNull()
    click(document.querySelector('[data-s-map-load]'))
    const frame = document.querySelector('iframe') as HTMLIFrameElement
    expect(frame.src).toContain('https://www.google.com/maps?q=')
    expect(frame.title).toBe('Mapa com a nossa localização')
  })

  it('refuses other origins', () => {
    mount(siteDoc([spec(SITE_TYPES.map, {})]))
    const button = document.querySelector('[data-s-map-load]') as HTMLElement
    button.setAttribute('data-s-map-load', 'https://evil.example/')
    click(button)
    expect(document.querySelector('iframe')).toBeNull()
  })
})

describe('before and after', () => {
  it('moves the divider with the range input', () => {
    mount(siteDoc([spec(SITE_TYPES.beforeAfter, { start: 30 })]))
    run(SITE_BEFORE_AFTER_SCRIPT)
    const root = document.querySelector('[data-s-ba]') as HTMLElement
    expect(root.style.getPropertyValue('--s-pos')).toBe('30%')
    const range = root.querySelector('input') as HTMLInputElement
    range.value = '75'
    range.dispatchEvent(new Event('input'))
    expect(root.style.getPropertyValue('--s-pos')).toBe('75%')
  })
})

describe('reveal', () => {
  it('reveals right away without IntersectionObserver', () => {
    mount(siteDoc([text('Oi', { animation: { effect: 'fade-up' } })]))
    run(SITE_REVEAL_SCRIPT)
    expect(
      document.querySelector('.s-reveal')?.classList.contains('s-in'),
    ).toBe(true)
  })

  it('reveals each element as it scrolls into view', () => {
    let callback: (
      entries: Array<{ isIntersecting: boolean; target: Element }>,
    ) => void = () => {}
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(cb: typeof callback) {
          callback = cb
        }
        observe() {}
        unobserve() {}
      },
    )
    mount(siteDoc([text('Oi', { animation: { effect: 'fade-up' } })]))
    run(SITE_REVEAL_SCRIPT)
    const element = document.querySelector('.s-reveal') as Element
    expect(element.classList.contains('s-in')).toBe(false)
    callback([{ isIntersecting: false, target: element }])
    expect(element.classList.contains('s-in')).toBe(false)
    callback([{ isIntersecting: true, target: element }])
    expect(element.classList.contains('s-in')).toBe(true)
  })

  it('does nothing on a page without animations', () => {
    mount(siteDoc([text('Oi')]))
    expect(() => run(SITE_REVEAL_SCRIPT)).not.toThrow()
  })
})

beforeEach(() => {
  document.body.innerHTML = ''
})
