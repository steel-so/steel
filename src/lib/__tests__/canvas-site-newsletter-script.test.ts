// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { renderSite, siteDoc } from '@/src/__tests__/helpers/site-canvas'
import { SITE_NEWSLETTER_SCRIPT } from '@/src/lib/canvas-site/components/newsletter'
import { SITE_TYPES } from '@/src/lib/canvas-site/constants'
import { spec } from '@/src/lib/canvas-site/presets/builder'

function mount(doubleOptIn = true, siteId: string | undefined = 'site1') {
  document.body.innerHTML = renderSite(
    siteDoc([
      spec(SITE_TYPES.newsletterSubscribe, {
        newsletterId: 'nl1',
        showName: true,
      }),
    ]),
    {
      siteId,
      newsletters: {
        nl1: {
          workspaceSlug: 'acme',
          slug: 'novidades',
          name: 'Novidades',
          doubleOptIn,
          archiveEnabled: true,
          archiveUrl: 'https://app.steel/n/acme/novidades',
          issues: [],
        },
      },
    },
  )
  const form = document.querySelector('form') as HTMLFormElement
  const field = (name: string) =>
    form.querySelector(`[name=${name}]`) as HTMLInputElement
  field('email').value = ' ana@acme.com '
  field('name').value = ' Ana '
  field('consent').checked = true
  return { form, field }
}

const submit = (form: HTMLElement) =>
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))
const respond = (status: number, body: unknown) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status }))
const statusText = () =>
  document.querySelector('.s-form-status')?.textContent ?? ''

describe('SITE_NEWSLETTER_SCRIPT', () => {
  beforeAll(() => {
    // biome-ignore lint/security/noGlobalEval: runs the inline page script under test
    window.eval(SITE_NEWSLETTER_SCRIPT)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('should post the subscription and ask to confirm by e-mail', async () => {
    const fetchMock = respond(201, { success: true, data: {} })
    vi.stubGlobal('fetch', fetchMock)
    const { form } = mount()
    submit(form)
    await flush()
    await flush()

    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ]
    expect(url).toMatch(/\/api\/newsletters\/subscribe$/)
    expect(JSON.parse(init.body as string)).toEqual({
      workspaceSlug: 'acme',
      newsletterSlug: 'novidades',
      email: 'ana@acme.com',
      name: 'Ana',
      consent: true,
      source: 'SITE',
      sourceRef: 'site1',
    })
    expect(document.querySelector('form')).toBeNull()
    expect(statusText()).toMatch(/Confira seu e-mail/)
  })

  it('should say "inscrição feita" from the answer or the setting', async () => {
    vi.stubGlobal(
      'fetch',
      respond(201, { success: true, data: { requiresConfirmation: false } }),
    )
    submit(mount().form)
    await flush()
    await flush()
    expect(statusText()).toMatch(/Inscrição feita/)

    vi.stubGlobal(
      'fetch',
      respond(201, { success: true, data: { status: 'PENDING' } }),
    )
    submit(mount(false).form)
    await flush()
    await flush()
    expect(statusText()).toMatch(/Confira/)

    vi.stubGlobal('fetch', respond(200, { success: true }))
    submit(mount(false, undefined).form)
    await flush()
    await flush()
    expect(statusText()).toMatch(/Inscrição feita/)
  })

  it('should require the consent box and drop bots silently', async () => {
    const fetchMock = respond(201, { success: true })
    vi.stubGlobal('fetch', fetchMock)
    const first = mount()
    first.field('consent').checked = false
    submit(first.form)
    expect(statusText()).toMatch(/Marque a autorização/)

    const bot = mount()
    bot.field('website').value = 'spam'
    submit(bot.form)
    expect(statusText()).toMatch(/Confira/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('should show validation, rate-limit, generic and network errors', async () => {
    vi.stubGlobal(
      'fetch',
      respond(400, { success: false, error: { message: 'E-mail inválido' } }),
    )
    const a = mount()
    a.field('name').value = ''
    submit(a.form)
    await flush()
    await flush()
    expect(statusText()).toBe('E-mail inválido')

    vi.stubGlobal('fetch', respond(429, {}))
    submit(mount().form)
    await flush()
    await flush()
    expect(statusText()).toMatch(/Muitas tentativas/)

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('x', { status: 500 })),
    )
    submit(mount().form)
    await flush()
    await flush()
    expect(statusText()).toMatch(/Não foi possível/)

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline')
      }),
    )
    submit(mount().form)
    await flush()
    await flush()
    expect(statusText()).toMatch(/Sem conexão/)
  })
})
