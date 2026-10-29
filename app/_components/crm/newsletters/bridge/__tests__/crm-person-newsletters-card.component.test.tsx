import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockFetch, renderWithQuery } from '@/src/__tests__/component-utils'
import type {
  CrmPersonNewsletterSubscriptionDTO,
  CrmPersonNewslettersDTO,
} from '@/src/schemas/crm-newsletter-bridge.schema'
import { CrmPersonNewslettersCard } from '../crm-person-newsletters-card'

vi.mock('@/lib/notify', () => ({
  notify: { success: vi.fn(), error: vi.fn() },
}))

import { notify } from '@/lib/notify'

const URL_BASE = '/api/workspaces/ws1/crm/people/p1/newsletters'

function subscription(
  overrides: Partial<CrmPersonNewsletterSubscriptionDTO> = {},
): CrmPersonNewsletterSubscriptionDTO {
  return {
    subscriberId: 's1',
    newsletterId: 'a',
    newsletterName: 'Novidades',
    newsletterArchived: false,
    email: 'ana@x.com',
    status: 'ACTIVE',
    source: 'MANUAL',
    consentAt: '2026-10-01T12:00:00.000Z',
    confirmedAt: '2026-10-02T12:00:00.000Z',
    unsubscribedAt: null,
    lastOpenedAt: '2026-10-20T12:00:00.000Z',
    lastClickedAt: null,
    canUnsubscribe: true,
    welcome: null,
    ...overrides,
  }
}

const data: CrmPersonNewslettersDTO = {
  personId: 'p1',
  emails: ['ana@x.com', 'ana@pessoal.com'],
  subscriptions: [
    subscription(),
    subscription({
      subscriberId: 's2',
      newsletterId: 'b',
      newsletterName: 'Antiga',
      newsletterArchived: true,
      status: 'UNSUBSCRIBED',
      unsubscribedAt: '2026-10-10T12:00:00.000Z',
      canUnsubscribe: false,
    }),
  ],
  available: [{ id: 'd', name: 'Dicas' }],
}

beforeEach(() => vi.clearAllMocks())

describe('<CrmPersonNewslettersCard />', () => {
  it('lists the subscriptions with status and dates', async () => {
    mockFetch([{ match: URL_BASE, data }])
    renderWithQuery(
      <CrmPersonNewslettersCard workspaceId='ws1' personId='p1' />,
    )

    expect(await screen.findByText('Novidades')).toBeTruthy()
    expect(screen.getByText('Ativo')).toBeTruthy()
    expect(screen.getByText('Descadastrado')).toBeTruthy()
    expect(screen.getByText('(arquivada)')).toBeTruthy()
    expect(
      screen.getByText(
        'ana@x.com · Desde 02/10/2026 · última abertura 20/10/2026',
      ),
    ).toBeTruthy()
    expect(screen.getByText('ana@x.com · Saiu em 10/10/2026')).toBeTruthy()
    // Only the active row offers "Descadastrar".
    expect(
      screen.getAllByRole('button', { name: 'Descadastrar' }),
    ).toHaveLength(1)
  })

  it('explains the empty states and hides "Inscrever" without e-mail', async () => {
    mockFetch([
      {
        match: URL_BASE,
        data: { ...data, emails: [], subscriptions: [] },
      },
    ])
    renderWithQuery(
      <CrmPersonNewslettersCard workspaceId='ws1' personId='p1' />,
    )
    expect(
      await screen.findByText(
        'Cadastre um e-mail para inscrever esta pessoa em uma newsletter.',
      ),
    ).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Inscrever' })).toBeNull()
  })

  it('shows the welcome series engagement', async () => {
    mockFetch([
      {
        match: URL_BASE,
        data: {
          ...data,
          subscriptions: [
            subscription({
              lastOpenedAt: null,
              welcome: { sent: 3, opened: 2, clicked: 1 },
            }),
            subscription({
              subscriberId: 's9',
              newsletterId: 'c',
              newsletterName: 'Dicas',
              email: 'ana@pessoal.com',
              lastOpenedAt: null,
              welcome: { sent: 1, opened: 0, clicked: 0 },
            }),
          ],
        },
      },
    ])
    renderWithQuery(
      <CrmPersonNewslettersCard workspaceId='ws1' personId='p1' />,
    )
    expect(
      await screen.findByText(
        'ana@x.com · Desde 02/10/2026 · boas-vindas: 2 de 3 abertos, 1 com clique',
      ),
    ).toBeTruthy()
    expect(
      screen.getByText(
        'ana@pessoal.com · Desde 02/10/2026 · boas-vindas: 0 de 1 aberto',
      ),
    ).toBeTruthy()
  })

  it('says when the person has no subscription', async () => {
    mockFetch([{ match: URL_BASE, data: { ...data, subscriptions: [] } }])
    renderWithQuery(
      <CrmPersonNewslettersCard workspaceId='ws1' personId='p1' />,
    )
    expect(
      await screen.findByText('Não assina nenhuma newsletter.'),
    ).toBeTruthy()
  })

  it('renders nothing without access', async () => {
    const fetchSpy = mockFetch([
      { match: URL_BASE, status: 403, error: 'Sem acesso' },
    ])
    const { container } = renderWithQuery(
      <CrmPersonNewslettersCard workspaceId='ws1' personId='p1' />,
    )
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled())
    await waitFor(() => expect(container.textContent).toBe(''))
  })

  it('subscribes the person to an available newsletter', async () => {
    const fetchSpy = mockFetch([
      { match: URL_BASE, data },
      {
        match: URL_BASE,
        method: 'POST',
        status: 201,
        data: {
          ...data,
          subscriptions: [
            ...data.subscriptions,
            subscription({
              subscriberId: 's3',
              newsletterId: 'd',
              newsletterName: 'Dicas',
              status: 'PENDING',
            }),
          ],
          available: [],
        },
      },
    ])
    renderWithQuery(
      <CrmPersonNewslettersCard workspaceId='ws1' personId='p1' />,
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Inscrever' }))
    expect(await screen.findByText('Inscrever em uma newsletter')).toBeTruthy()
    fireEvent.click(
      screen.getByRole('checkbox', {
        name: 'Pedir confirmação por e-mail antes de ativar',
      }),
    )
    const dialogButtons = screen.getAllByRole('button', { name: 'Inscrever' })
    fireEvent.click(dialogButtons[dialogButtons.length - 1])

    await waitFor(() =>
      expect(notify.success).toHaveBeenCalledWith(
        'Enviamos o e-mail de confirmação',
      ),
    )
    const post = fetchSpy.mock.calls.find((c) => c[1]?.method === 'POST')
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({
      newsletterId: 'd',
      email: 'ana@x.com',
      sendConfirmation: true,
    })
    expect(await screen.findByText('Dicas')).toBeTruthy()
  })

  it('reports a failed subscription', async () => {
    mockFetch([
      { match: URL_BASE, data: { ...data, emails: ['ana@x.com'] } },
      { match: URL_BASE, method: 'POST', status: 409, error: 'Já inscrito' },
    ])
    renderWithQuery(
      <CrmPersonNewslettersCard workspaceId='ws1' personId='p1' />,
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Inscrever' }))
    expect(await screen.findByText('E-mail:')).toBeTruthy()
    const buttons = screen.getAllByRole('button', { name: 'Inscrever' })
    fireEvent.click(buttons[buttons.length - 1])
    await waitFor(() => expect(notify.error).toHaveBeenCalled())
  })

  it('unsubscribes after confirming', async () => {
    const fetchSpy = mockFetch([
      { match: URL_BASE, data },
      {
        match: `${URL_BASE}/s1`,
        method: 'DELETE',
        data: {
          ...data,
          subscriptions: [
            subscription({ status: 'UNSUBSCRIBED', canUnsubscribe: false }),
          ],
        },
      },
    ])
    renderWithQuery(
      <CrmPersonNewslettersCard workspaceId='ws1' personId='p1' />,
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Descadastrar' }))
    expect(await screen.findByText('Descadastrar da newsletter?')).toBeTruthy()
    const confirm = screen.getAllByRole('button', { name: 'Descadastrar' })
    fireEvent.click(confirm[confirm.length - 1])

    await waitFor(() =>
      expect(notify.success).toHaveBeenCalledWith(
        'Pessoa descadastrada da newsletter',
      ),
    )
    expect(
      fetchSpy.mock.calls.some(
        (c) => String(c[0]).endsWith('/s1') && c[1]?.method === 'DELETE',
      ),
    ).toBe(true)
  })

  it('reports a failed unsubscribe', async () => {
    mockFetch([
      { match: URL_BASE, data },
      { match: `${URL_BASE}/s1`, method: 'DELETE', status: 500, error: 'x' },
    ])
    renderWithQuery(
      <CrmPersonNewslettersCard workspaceId='ws1' personId='p1' />,
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Descadastrar' }))
    await screen.findByText('Descadastrar da newsletter?')
    const confirm = screen.getAllByRole('button', { name: 'Descadastrar' })
    fireEvent.click(confirm[confirm.length - 1])
    await waitFor(() => expect(notify.error).toHaveBeenCalled())
  })
})
