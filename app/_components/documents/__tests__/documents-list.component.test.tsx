import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockFetch, renderWithQuery } from '@/src/__tests__/component-utils'
import { DocumentsList } from '../documents-list'
import { BASE, fakeDocument, fakeListItem, SLUG, WS } from './fixtures'

const push = vi.hoisted(() => vi.fn())
const notify = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))
vi.mock('@/lib/notify', () => ({ notify }))
vi.mock('@/app/_components/documents/import/document-import-dialog', () => ({
  DocumentImportDialog: () => null,
}))

const DOCS = [
  fakeListItem(),
  fakeListItem({
    id: 'doc_2',
    title: 'Contrato de suporte',
    kind: 'CONTRACT',
    status: 'DRAFT',
    company: null,
    person: null,
    opportunity: null,
    totalValue: null,
    viewCount: 0,
  }),
]

const TEMPLATES = [
  fakeListItem({
    id: 'tpl_1',
    title: 'Proposta padrão',
    isTemplate: true,
    status: 'DRAFT',
  }),
]

function listUrl(url: string) {
  return new URL(url, 'http://localhost').searchParams
}

function setup({ docs = DOCS }: { docs?: typeof DOCS } = {}) {
  const spy = mockFetch([
    { match: '/crm/members', data: [{ id: 'u1', name: 'João Lima' }] },
    {
      match: new RegExp(`${BASE}(\\?|$)`),
      handler: (url) => {
        const params = listUrl(url)
        const q = params.get('q') ?? ''
        let items = params.get('isTemplate') === 'true' ? TEMPLATES : docs
        if (q) items = items.filter((doc) => doc.title.includes(q))
        return { items, total: items.length, page: 1, pageSize: 25 }
      },
    },
    {
      method: 'POST',
      match: `${BASE}/doc_1/duplicate`,
      status: 201,
      data: fakeDocument({ id: 'doc_9', title: 'Proposta — Acme (cópia)' }),
    },
    { method: 'DELETE', match: `${BASE}/doc_2`, data: null },
  ])
  renderWithQuery(<DocumentsList workspaceId={WS} slug={SLUG} />)
  return spy
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('<DocumentsList />', () => {
  it('lists documents with kind, status, client, value and reads', async () => {
    setup()
    const row = await screen.findByTestId('document-row-doc_1')
    expect(within(row).getByText('Proposta — Acme')).toBeTruthy()
    expect(within(row).getByText('Proposta')).toBeTruthy()
    expect(within(row).getByText('Enviado')).toBeTruthy()
    expect(within(row).getByText('Acme Ltda')).toBeTruthy()
    expect(within(row).getByText('Implantação 2027')).toBeTruthy()
    expect(within(row).getByText(/48\.000,00/)).toBeTruthy()
    expect(within(row).getByText('Nunca')).toBeTruthy()
    expect(
      within(row)
        .getByRole('link', { name: 'Proposta — Acme' })
        .getAttribute('href'),
    ).toBe('/acme/crm/documents/doc_1')
    const draft = screen.getByTestId('document-row-doc_2')
    expect(within(draft).getByText('Rascunho')).toBeTruthy()
    expect(within(draft).getAllByText('Contrato').length).toBeGreaterThan(0)
  })

  it('shows the empty state of a new workspace', async () => {
    setup({ docs: [] })
    expect(await screen.findByText('Crie seu primeiro documento')).toBeTruthy()
  })

  it('searches after a pause and offers to clear the filters', async () => {
    const spy = setup()
    await screen.findByTestId('document-row-doc_1')
    fireEvent.change(screen.getByLabelText('Buscar'), {
      target: { value: 'nada' },
    })
    expect(
      await screen.findByText('Nada encontrado com esses filtros.'),
    ).toBeTruthy()
    expect(
      spy.mock.calls.some(([url]) => listUrl(String(url)).get('q') === 'nada'),
    ).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Limpar filtros' }))
    expect(await screen.findByTestId('document-row-doc_1')).toBeTruthy()
  })

  it('switches to the templates tab', async () => {
    const spy = setup()
    await screen.findByTestId('document-row-doc_1')
    fireEvent.click(screen.getByRole('tab', { name: 'Modelos' }))
    const row = await screen.findByTestId('document-row-tpl_1')
    expect(within(row).getByText('Proposta padrão')).toBeTruthy()
    expect(within(row).getByRole('button', { name: 'Usar' })).toBeTruthy()
    expect(
      spy.mock.calls.some(
        ([url]) => listUrl(String(url)).get('isTemplate') === 'true',
      ),
    ).toBe(true)
    expect(screen.getByTestId('new-document').textContent).toContain(
      'Novo modelo',
    )
  })

  it('duplicates into the editor and deletes after confirming', async () => {
    const spy = setup()
    const row = await screen.findByTestId('document-row-doc_1')
    fireEvent.click(
      within(row).getByRole('button', { name: 'Ações de Proposta — Acme' }),
    )
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Duplicar' }))
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith('/acme/crm/documents/doc_9/edit'),
    )

    const draft = screen.getByTestId('document-row-doc_2')
    fireEvent.click(
      within(draft).getByRole('button', {
        name: 'Ações de Contrato de suporte',
      }),
    )
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Excluir' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Excluir' }))
    await waitFor(() =>
      expect(
        spy.mock.calls.some(
          ([url, init]) =>
            String(url).endsWith(`${BASE}/doc_2`) && init?.method === 'DELETE',
        ),
      ).toBe(true),
    )
    expect(notify.success).toHaveBeenCalledWith(
      '“Contrato de suporte” excluído.',
    )
  })

  it('opens the new document dialog', async () => {
    setup()
    fireEvent.click(await screen.findByTestId('new-document'))
    expect(
      await screen.findByRole('heading', { name: 'Novo documento' }),
    ).toBeTruthy()
  })
})
