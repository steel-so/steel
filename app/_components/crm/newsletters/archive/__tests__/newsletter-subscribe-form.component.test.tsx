import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NewsletterSubscribeForm } from '../newsletter-subscribe-form'

/** `POST /api/newsletters/subscribe` belongs to nl-core: mocked here. */
function mockSubscribe(status: number, body: unknown) {
  const spy = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
  )
  vi.stubGlobal('fetch', spy)
  return spy
}

function renderForm(doubleOptIn = true) {
  render(
    <NewsletterSubscribeForm
      workspaceSlug='acme'
      newsletterSlug='novidades'
      newsletterName='Novidades'
      doubleOptIn={doubleOptIn}
      description='Uma vez por mês.'
    />,
  )
  fireEvent.change(screen.getByLabelText('E-mail'), {
    target: { value: ' ana@acme.com ' },
  })
}

const submit = () =>
  fireEvent.click(screen.getByRole('button', { name: 'Assinar' }))
const consent = () =>
  fireEvent.click(
    screen.getByRole('checkbox', { name: /Quero receber esta newsletter/ }),
  )

afterEach(() => vi.unstubAllGlobals())

describe('NewsletterSubscribeForm', () => {
  it('should post the subscription and ask to check the inbox', async () => {
    const spy = mockSubscribe(201, { success: true, data: {} })
    renderForm()
    expect(screen.getByText('Uma vez por mês.')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Nome (opcional)'), {
      target: { value: ' Ana ' },
    })
    consent()
    submit()

    expect(await screen.findByText('Confira seu e-mail')).toBeTruthy()
    const [url, init] = spy.mock.calls[0]
    expect(url).toBe('/api/newsletters/subscribe')
    expect(JSON.parse(String(init?.body))).toEqual({
      workspaceSlug: 'acme',
      newsletterSlug: 'novidades',
      email: 'ana@acme.com',
      name: 'Ana',
      consent: true,
      source: 'PUBLIC_PAGE',
    })
  })

  it('should confirm right away without double opt-in', async () => {
    const spy = mockSubscribe(201, { success: true, data: {} })
    renderForm(false)
    consent()
    submit()
    expect(await screen.findByText('Inscrição feita')).toBeTruthy()
    expect(JSON.parse(String(spy.mock.calls[0][1]?.body))).not.toHaveProperty(
      'name',
    )
  })

  it('should require the consent before posting', () => {
    const spy = mockSubscribe(201, { success: true })
    renderForm()
    submit()
    expect(screen.getByRole('alert').textContent).toMatch(
      /Marque a autorização/,
    )
    expect(spy).not.toHaveBeenCalled()
  })

  it('should show the API validation message', async () => {
    mockSubscribe(400, {
      success: false,
      error: { message: 'E-mail inválido' },
    })
    renderForm()
    consent()
    submit()
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe('E-mail inválido'),
    )
  })

  it('should handle a network failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline')
      }),
    )
    renderForm()
    consent()
    submit()
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toMatch(/Sem conexão/),
    )
  })

  it('should fake success for a bot that filled the honeypot', async () => {
    const spy = mockSubscribe(201, { success: true })
    const { container } = render(
      <NewsletterSubscribeForm
        workspaceSlug='acme'
        newsletterSlug='novidades'
        newsletterName='Novidades'
        doubleOptIn={false}
      />,
    )
    fireEvent.change(
      container.querySelector('input[name=website]') as HTMLInputElement,
      { target: { value: 'http://spam' } },
    )
    fireEvent.change(screen.getByLabelText('E-mail'), {
      target: { value: 'bot@spam.com' },
    })
    submit()
    expect(await screen.findByText('Inscrição feita')).toBeTruthy()
    expect(spy).not.toHaveBeenCalled()
  })
})
