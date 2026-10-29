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
import { SITE_FORM_SCRIPT } from '@/src/lib/canvas-site/components/form'
import { form } from '@/src/lib/canvas-site/presets/builder'
import type { SiteFormField } from '@/src/lib/canvas-site/schemas'

const fields: SiteFormField[] = [
  { key: 'nome', label: 'Nome', type: 'text', required: false },
  { key: 'vazio', label: 'Vazio', type: 'text', required: false },
  { key: 'aceite', label: 'Aceito', type: 'checkbox', required: false },
]

function mount(redirect?: string) {
  document.body.innerHTML = renderSite(
    siteDoc([form({ formToken: 'tok', fields })]),
    {
      forms: redirect ? { tok: { fields, redirectUrl: redirect } } : undefined,
    },
  )
  const element = document.querySelector('form') as HTMLFormElement
  ;(element.querySelector('[name=nome]') as HTMLInputElement).value = 'Ana'
  ;(element.querySelector('[name=aceite]') as HTMLInputElement).checked = true
  return element
}

const submit = (element: HTMLElement) =>
  element.dispatchEvent(
    new Event('submit', { bubbles: true, cancelable: true }),
  )

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('SITE_FORM_SCRIPT', () => {
  beforeAll(() => {
    window.history.replaceState(
      null,
      '',
      '/?utm_campaign=outubro&utm_source=ig&ref=c1',
    )
    // biome-ignore lint/security/noGlobalEval: runs the inline page script under test
    window.eval(SITE_FORM_SCRIPT)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('posts the fields as JSON with the campaign and shows the success message', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ success: true }), { status: 201 }),
    )
    vi.stubGlobal('fetch', fetchMock)
    submit(mount())
    await flush()
    await flush()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [action, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ]
    expect(action).toContain('/api/crm/forms/tok/submit')
    expect(JSON.parse(init.body as string)).toEqual({
      values: { nome: 'Ana', aceite: true },
      campaign: { ref: 'c1', utmCampaign: 'outubro', utmSource: 'ig' },
    })
    expect(document.querySelector('form')).toBeNull()
    expect(document.querySelector('.s-form-status')?.textContent).toBe(
      'Recebemos suas informações. Em breve entraremos em contato.',
    )
  })

  it('shows the server error and re-enables the button', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              success: false,
              error: { message: 'Formulário fechado' },
            }),
            { status: 400 },
          ),
      ),
    )
    const element = mount()
    submit(element)
    await flush()
    await flush()
    const status = element.querySelector('.s-form-status') as HTMLElement
    expect(status.hidden).toBe(false)
    expect(status.textContent).toBe('Formulário fechado')
    expect(
      (element.querySelector('[type=submit]') as HTMLButtonElement).disabled,
    ).toBe(false)
  })

  it('ignores bots and other forms', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const element = mount()
    ;(
      element.querySelector('[name=company_website]') as HTMLInputElement
    ).value = 'spam'
    submit(element)
    const other = document.createElement('form')
    document.body.append(other)
    submit(other)
    await flush()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('falls back to a generic error on network failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('oops', { status: 500 })),
    )
    const element = mount('/obrigado')
    submit(element)
    await flush()
    await flush()
    expect(element.querySelector('.s-form-status')?.textContent).toBe(
      'Não foi possível enviar. Tente novamente.',
    )
  })

  it('announces a sent form to the site runtime (conversions)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ success: true }), { status: 201 }),
      ),
    )
    const events: string[] = []
    const listener = (event: Event) =>
      events.push((event as CustomEvent<{ action: string }>).detail.action)
    document.addEventListener('steel:site-form-submitted', listener)
    submit(mount())
    await flush()
    await flush()
    document.removeEventListener('steel:site-form-submitted', listener)
    expect(events).toHaveLength(1)
    expect(events[0]).toContain('/api/crm/forms/tok/submit')
  })

  describe('CRM campaign parameters on a site page', () => {
    function config(value: Record<string, unknown>) {
      const el = document.createElement('script')
      el.id = 'ss-config'
      el.type = 'application/json'
      el.textContent = JSON.stringify(value)
      document.body.append(el)
    }
    async function sentCampaign() {
      const fetchMock = vi.fn(
        async () =>
          new Response(JSON.stringify({ success: true }), { status: 201 }),
      )
      vi.stubGlobal('fetch', fetchMock)
      const element = mount()
      config(currentConfig)
      submit(element)
      await flush()
      const [, init] = fetchMock.mock.calls[0] as unknown as [
        string,
        RequestInit,
      ]
      return JSON.parse(init.body as string).campaign
    }
    let currentConfig: Record<string, unknown> = {}
    let consent: string | null = null

    beforeEach(() => {
      window.history.replaceState(
        null,
        '',
        '/?utm_campaign=bf&utm_source=email&stc=r1-e.sig',
      )
      consent = null
      vi.stubGlobal('localStorage', {
        getItem: () => consent,
        setItem: () => {},
      })
    })

    it('sends the token, the site and the page when no consent is needed', async () => {
      currentConfig = { slug: 'clinica', pageId: 'home', banner: false }
      expect(await sentCampaign()).toEqual({
        ref: 'r1-e.sig',
        utmCampaign: 'bf',
        utmSource: 'email',
        siteSlug: 'clinica',
        sitePageId: 'home',
      })
    })

    it('drops the recipient token until the visitor accepts cookies', async () => {
      currentConfig = {
        slug: 'clinica',
        pageId: 'home',
        banner: false,
        tracking: { ga: 'G-1' },
      }
      expect(await sentCampaign()).toEqual({
        utmCampaign: 'bf',
        utmSource: 'email',
        siteSlug: 'clinica',
        sitePageId: 'home',
      })
      consent = 'accepted'
      currentConfig = { slug: 'clinica', banner: true }
      expect(await sentCampaign()).toEqual({
        ref: 'r1-e.sig',
        utmCampaign: 'bf',
        utmSource: 'email',
        siteSlug: 'clinica',
      })
    })

    it('ignores a broken config and storage errors', async () => {
      vi.stubGlobal('localStorage', {
        getItem: () => {
          throw new Error('blocked')
        },
      })
      currentConfig = { slug: 'clinica', banner: true }
      expect(await sentCampaign()).toEqual({
        utmCampaign: 'bf',
        utmSource: 'email',
        siteSlug: 'clinica',
      })
      const fetchMock = vi.fn(
        async () =>
          new Response(JSON.stringify({ success: true }), { status: 201 }),
      )
      vi.stubGlobal('fetch', fetchMock)
      const element = mount()
      const broken = document.createElement('script')
      broken.id = 'ss-config'
      broken.type = 'application/json'
      broken.textContent = '{'
      document.body.append(broken)
      submit(element)
      await flush()
      const [, init] = fetchMock.mock.calls[0] as unknown as [
        string,
        RequestInit,
      ]
      expect(JSON.parse(init.body as string).campaign).toEqual({
        ref: 'r1-e.sig',
        utmCampaign: 'bf',
        utmSource: 'email',
      })
    })
  })

  describe('newsletter consent', () => {
    const newsletter = {
      name: 'Boletim',
      consentText: 'Quero receber a newsletter Boletim por e-mail.',
    }
    const mountWithNewsletter = () => {
      document.body.innerHTML = renderSite(
        siteDoc([form({ formToken: 'tok', fields })]),
        { forms: { tok: { fields, newsletter } } },
      )
      return document.querySelector('form') as HTMLFormElement
    }
    const sentBody = async (tick: boolean) => {
      const fetchMock = vi.fn(
        async () =>
          new Response(JSON.stringify({ success: true }), { status: 201 }),
      )
      vi.stubGlobal('fetch', fetchMock)
      const element = mountWithNewsletter()
      const box = element.querySelector(
        '[data-newsletter-consent]',
      ) as HTMLInputElement
      box.checked = tick
      submit(element)
      await flush()
      const [, init] = fetchMock.mock.calls[0] as unknown as [
        string,
        RequestInit,
      ]
      return JSON.parse(init.body as string)
    }

    it('renders the unticked consent box with the newsletter text', () => {
      const element = mountWithNewsletter()
      const box = element.querySelector(
        '[data-newsletter-consent]',
      ) as HTMLInputElement
      expect(box.checked).toBe(false)
      expect(box.hasAttribute('data-field')).toBe(false)
      expect(element.textContent).toContain(newsletter.consentText)
    })

    it('sends newsletterConsent apart from the form values', async () => {
      const ticked = await sentBody(true)
      expect(ticked.newsletterConsent).toBe(true)
      expect(ticked.values).not.toHaveProperty('newsletterConsent')
      expect((await sentBody(false)).newsletterConsent).toBe(false)
    })

    it('omits the consent when the form has no newsletter', async () => {
      const fetchMock = vi.fn(
        async () =>
          new Response(JSON.stringify({ success: true }), { status: 201 }),
      )
      vi.stubGlobal('fetch', fetchMock)
      const element = mount()
      expect(element.querySelector('[data-newsletter-consent]')).toBeNull()
      submit(element)
      await flush()
      const [, init] = fetchMock.mock.calls[0] as unknown as [
        string,
        RequestInit,
      ]
      expect(JSON.parse(init.body as string)).not.toHaveProperty(
        'newsletterConsent',
      )
    })
  })
})
