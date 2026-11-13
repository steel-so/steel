import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  type FetchRoute,
  fetchBody,
  mockFetch,
  renderWithQuery,
} from '@/src/__tests__/component-utils'
import { CrmCompaniesTable } from '../crm-companies-table'

const notify = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}))
vi.mock('@/lib/notify', () => ({ notify }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/acme/crm/companies',
}))

// Valid check digits (11.222.333/0001-81).
const VALID_CNPJ = '11222333000181'

const COMPANY = {
  id: 'c1',
  cnpj: null,
  name: 'Acme Ltda',
  domain: 'acme.com',
  employees: 120,
  linkedin: null,
  address: null,
  arr: 250000,
  icp: true,
  accountOwnerId: 'u1',
  createdById: 'u1',
  updatedById: 'u1',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
  customFields: { cf_seg: 'Varejo' },
}

function baseRoutes(companies: unknown[] = [COMPANY]): FetchRoute[] {
  return [
    { match: /\/crm\/companies$/, data: companies },
    { match: /\/crm\/members$/, data: [{ id: 'u1', name: 'Ana Souza' }] },
    {
      match: '/crm/custom-fields',
      data: [
        {
          id: 'seg',
          entity: 'COMPANY',
          label: 'Segmento',
          type: 'TEXT',
          required: false,
          options: [],
        },
      ],
    },
    { match: '/crm/activities', data: [] },
  ]
}

function renderTable() {
  return renderWithQuery(<CrmCompaniesTable workspaceId='ws1' slug='acme' />)
}

async function rowOf(text: string) {
  const cell = await screen.findByText(text)
  return cell.closest('tr') as HTMLElement
}

describe('<CrmCompaniesTable />', { timeout: 15_000 }, () => {
  it('renders companies with formatted numbers, owner and custom fields', async () => {
    mockFetch(baseRoutes())
    renderTable()

    const row = await rowOf('Acme Ltda')
    expect(within(row).getByText('120')).toBeTruthy()
    expect(within(row).getByText(/R\$\s?250\.000/)).toBeTruthy()
    expect(
      (await within(row).findAllByText('Ana Souza')).length,
    ).toBeGreaterThan(0)
    // Custom field definitions become extra columns fed by `customFields`.
    expect(await screen.findByText('Segmento')).toBeTruthy()
    expect(within(row).getByText('Varejo')).toBeTruthy()
  })

  it('creates a company only after the required name is filled', async () => {
    const fetchSpy = mockFetch([
      ...baseRoutes([]),
      {
        method: 'POST',
        match: /\/crm\/companies$/,
        data: { ...COMPANY, id: 'c2', name: 'Acme Inc', customFields: {} },
      },
    ])
    renderTable()
    await screen.findByText('Nada por aqui ainda')

    fireEvent.click(screen.getAllByText(/^Nov[oa] empresa$/)[0])

    const dialog = await screen.findByRole('dialog')
    const submit = within(dialog).getByRole('button', {
      name: 'Criar',
    }) as HTMLButtonElement
    expect(submit.disabled).toBe(true)
    expect(
      fetchSpy.mock.calls.some(([, init]) => init?.method === 'POST'),
    ).toBe(false)

    fireEvent.change(within(dialog).getByLabelText('Nome'), {
      target: { value: 'Acme Inc' },
    })
    await waitFor(() => expect(submit.disabled).toBe(false))
    fireEvent.click(submit)

    await waitFor(() =>
      expect(fetchBody(fetchSpy, /\/crm\/companies$/)).toMatchObject({
        name: 'Acme Inc',
        icp: false,
      }),
    )
    expect(fetchBody(fetchSpy, /\/crm\/companies$/)).not.toHaveProperty(
      'cnpj',
    )
  })

  it('rejects an invalid CNPJ without saving', async () => {
    const fetchSpy = mockFetch(baseRoutes())
    renderTable()
    const row = await rowOf('Acme Ltda')

    fireEvent.click(within(row).getByText('00.000.000/0000-00'))
    const input = within(row).getByPlaceholderText('00.000.000/0000-00')
    fireEvent.change(input, { target: { value: '11111111111111' } })
    fireEvent.blur(input)

    await waitFor(() =>
      expect(notify.error).toHaveBeenCalledWith('CNPJ inválido'),
    )
    expect(fetchBody(fetchSpy, '/crm/companies/c1', 'PATCH')).toBeUndefined()
  })

  it('formats a valid CNPJ, saves it and autofills from BrasilAPI', async () => {
    const fetchSpy = mockFetch([
      ...baseRoutes(),
      {
        method: 'PATCH',
        match: '/crm/companies/c1',
        handler: () => ({ ...COMPANY, cnpj: VALID_CNPJ }),
      },
      {
        match: 'brasilapi.com.br',
        handler: () =>
          new Response(
            JSON.stringify({
              razao_social: 'ACME COMERCIO LTDA',
              nome_fantasia: 'Acme Store',
            }),
            { status: 200 },
          ),
      },
    ])
    renderTable()
    const row = await rowOf('Acme Ltda')

    fireEvent.click(within(row).getByText('00.000.000/0000-00'))
    const input = within(row).getByPlaceholderText(
      '00.000.000/0000-00',
    ) as HTMLInputElement
    fireEvent.change(input, { target: { value: VALID_CNPJ } })
    expect(input.value).toBe('11.222.333/0001-81')
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() =>
      expect(notify.success).toHaveBeenCalledWith(
        'Empresa preenchida pelo CNPJ',
      ),
    )
    const patches = fetchSpy.mock.calls
      .filter(([, init]) => init?.method === 'PATCH')
      .map(([, init]) => JSON.parse(String(init?.body)))
    expect(patches).toContainEqual({ cnpj: VALID_CNPJ })
    expect(patches).toContainEqual(
      expect.objectContaining({ name: 'Acme Store' }),
    )
    expect(await within(row).findByText('Acme Store')).toBeTruthy()
  })

  it('warns when the CNPJ is not registered at Receita', async () => {
    mockFetch([
      ...baseRoutes(),
      {
        method: 'PATCH',
        match: '/crm/companies/c1',
        handler: () => ({ ...COMPANY, cnpj: VALID_CNPJ }),
      },
      {
        match: 'brasilapi.com.br',
        handler: () => new Response('{}', { status: 404 }),
      },
    ])
    renderTable()
    const row = await rowOf('Acme Ltda')

    fireEvent.click(within(row).getByText('00.000.000/0000-00'))
    const input = within(row).getByPlaceholderText('00.000.000/0000-00')
    fireEvent.change(input, { target: { value: VALID_CNPJ } })
    fireEvent.blur(input)

    await waitFor(() =>
      expect(notify.error).toHaveBeenCalledWith(
        'CNPJ não encontrado na Receita',
      ),
    )
  })

  it('refetches the list when an inline edit is rejected by the API', async () => {
    const fetchSpy = mockFetch([
      ...baseRoutes(),
      {
        method: 'PATCH',
        match: '/crm/companies/c1',
        status: 409,
        error: 'Domínio já cadastrado',
      },
    ])
    renderTable()
    const row = await rowOf('Acme Ltda')
    const listCallsBefore = fetchSpy.mock.calls.filter(
      ([u, init]) => /\/crm\/companies$/.test(String(u)) && !init?.method,
    ).length

    fireEvent.click(within(row).getByText('Acme Ltda'))
    const input = within(row).getByDisplayValue('Acme Ltda')
    fireEvent.change(input, { target: { value: 'Acme S/A' } })
    fireEvent.blur(input)

    await waitFor(() =>
      expect(notify.error).toHaveBeenCalledWith('Domínio já cadastrado'),
    )
    await waitFor(() =>
      expect(
        fetchSpy.mock.calls.filter(
          ([u, init]) => /\/crm\/companies$/.test(String(u)) && !init?.method,
        ).length,
      ).toBeGreaterThan(listCallsBefore),
    )
  })
})
