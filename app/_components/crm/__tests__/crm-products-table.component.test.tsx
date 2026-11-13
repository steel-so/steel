import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  type FetchRoute,
  fetchBody,
  mockFetch,
  renderWithQuery,
} from '@/src/__tests__/component-utils'
import { CrmProductsTable } from '../crm-products-table'

const notify = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}))
vi.mock('@/lib/notify', () => ({ notify }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/acme/crm/products',
}))

const PRODUCT = {
  id: 'pr1',
  name: 'Plano Pro',
  sku: 'PRO-001',
  unitPrice: 199.9,
  billingType: 'MONTHLY',
  description: null,
  active: true,
  createdById: 'u1',
  updatedById: 'u1',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
}

function baseRoutes(products: unknown[] = [PRODUCT]): FetchRoute[] {
  return [
    { match: /\/crm\/products$/, data: products },
    { match: /\/crm\/members$/, data: [{ id: 'u1', email: 'ana@acme.com' }] },
  ]
}

function renderTable() {
  return renderWithQuery(<CrmProductsTable workspaceId='ws1' slug='acme' />)
}

/** Fills the required field of the create dialog and submits it. */
async function createFromDialog(label: string, value: string) {
  const dialog = await screen.findByRole('dialog')
  const input = within(dialog).getByLabelText(label)
  fireEvent.change(input, { target: { value } })
  const submit = within(dialog).getByRole('button', {
    name: 'Criar',
  }) as HTMLButtonElement
  await waitFor(() => expect(submit.disabled).toBe(false))
  fireEvent.click(submit)
}

describe('<CrmProductsTable />', { timeout: 15_000 }, () => {
  it('renders price, billing label and the active switch', async () => {
    mockFetch(baseRoutes())
    renderTable()

    const row = (await screen.findByText('Plano Pro')).closest(
      'tr',
    ) as HTMLElement
    expect(within(row).getByText('PRO-001')).toBeTruthy()
    // Grid money cells round to whole reais.
    expect(within(row).getByText(/R\$\s?200$/)).toBeTruthy()
    expect(within(row).getByText('Mensal')).toBeTruthy()
    const toggle = within(row).getByLabelText('Alternar')
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    // Members without a name fall back to their e-mail as label.
    expect(
      (await within(row).findAllByText('ana@acme.com')).length,
    ).toBeGreaterThan(0)
  })

  it('creates a product with the default billing type and inactive flag', async () => {
    const fetchSpy = mockFetch([
      ...baseRoutes([]),
      {
        method: 'POST',
        match: /\/crm\/products$/,
        data: { ...PRODUCT, id: 'pr2', name: 'Sem título' },
      },
    ])
    renderTable()
    await screen.findByText('Nada por aqui ainda')

    fireEvent.click(screen.getAllByText(/^Nov[oa] produto$/)[0])
    await createFromDialog('Nome', 'Plano Basic')

    await waitFor(() =>
      expect(fetchBody(fetchSpy, /\/crm\/products$/)).toEqual({
        name: 'Plano Basic',
        billingType: 'ONE_TIME',
        active: false,
      }),
    )
  })

  it('toggles the active flag inline', async () => {
    const fetchSpy = mockFetch([
      ...baseRoutes(),
      {
        method: 'PATCH',
        match: '/crm/products/pr1',
        data: { ...PRODUCT, active: false },
      },
    ])
    renderTable()
    const row = (await screen.findByText('Plano Pro')).closest(
      'tr',
    ) as HTMLElement

    fireEvent.click(within(row).getByLabelText('Alternar'))

    await waitFor(() =>
      expect(fetchBody(fetchSpy, '/crm/products/pr1', 'PATCH')).toEqual({
        active: false,
      }),
    )
  })

  it('shows loading skeletons before the list resolves', async () => {
    let release: (v: unknown) => void = () => {}
    mockFetch([
      {
        match: /\/crm\/products$/,
        handler: () =>
          new Promise((r) => {
            release = r
          }),
      },
      { match: /\/crm\/members$/, data: [] },
    ])
    const { container } = renderTable()

    await waitFor(() =>
      expect(
        container.querySelectorAll('[data-slot="skeleton"]').length,
      ).toBeGreaterThan(0),
    )
    expect(screen.queryByText('Nada por aqui ainda')).toBeNull()

    release([])
    expect(await screen.findByText('Nada por aqui ainda')).toBeTruthy()
  })
})
