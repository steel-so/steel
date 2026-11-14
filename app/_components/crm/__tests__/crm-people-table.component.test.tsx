import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  type FetchRoute,
  fetchBody,
  mockFetch,
  renderWithQuery,
} from '@/src/__tests__/component-utils'
import { CrmPeopleTable } from '../crm-people-table'

const notify = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}))
vi.mock('@/lib/notify', () => ({ notify }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/acme/crm/people',
}))

const PEOPLE = [
  {
    id: 'p1',
    name: 'Ada Lovelace',
    emails: ['ada@acme.com'],
    phones: [],
    city: 'Londres',
    jobTitle: 'Head of Sales',
    linkedin: null,
    companyId: 'c1',
    createdById: 'u1',
    updatedById: 'u1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    customFields: {},
  },
  {
    id: 'p2',
    name: 'Grace Hopper',
    emails: [],
    phones: [],
    city: 'Nova York',
    jobTitle: null,
    linkedin: null,
    companyId: null,
    createdById: 'u1',
    updatedById: 'u1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    customFields: {},
  },
]

function baseRoutes(people: unknown[] = PEOPLE): FetchRoute[] {
  return [
    { match: /\/crm\/people$/, data: people },
    { match: /\/crm\/companies$/, data: [{ id: 'c1', name: 'Acme Ltda' }] },
    { match: /\/crm\/members$/, data: [{ id: 'u1', name: 'Ana Souza' }] },
    { match: '/crm/custom-fields', data: [] },
    { match: '/crm/activities', data: [] },
  ]
}

function renderTable() {
  return renderWithQuery(<CrmPeopleTable workspaceId='ws1' slug='acme' />)
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

describe('<CrmPeopleTable />', { timeout: 15_000 }, () => {
  beforeEach(() => {
    window.localStorage?.clear?.()
  })

  it('lists people with their columns and resolved relations', async () => {
    mockFetch(baseRoutes())
    renderTable()

    expect(await screen.findByText('Ada Lovelace')).toBeTruthy()
    expect(screen.getByText('Grace Hopper')).toBeTruthy()
    expect(screen.getByText('ada@acme.com')).toBeTruthy()
    expect(screen.getByText('Head of Sales')).toBeTruthy()
    expect(await screen.findByText('Acme Ltda')).toBeTruthy()
    expect(screen.getByPlaceholderText('Buscar pessoas…')).toBeTruthy()
  })

  it('shows the empty state with a create call-to-action', async () => {
    mockFetch(baseRoutes([]))
    renderTable()

    expect(await screen.findByText('Nada por aqui ainda')).toBeTruthy()
    expect(screen.getAllByText('Nova pessoa').length).toBeGreaterThan(0)
    expect(screen.queryByText('Novo pessoa')).toBeNull()
  })

  it('filters rows through the global search', async () => {
    mockFetch(baseRoutes())
    renderTable()
    await screen.findByText('Ada Lovelace')

    fireEvent.change(screen.getByPlaceholderText('Buscar pessoas…'), {
      target: { value: 'grace' },
    })

    await waitFor(() => expect(screen.queryByText('Ada Lovelace')).toBeNull())
    expect(screen.getByText('Grace Hopper')).toBeTruthy()
  })

  it('asks for the required name before creating a person', async () => {
    const created = { ...PEOPLE[1], id: 'p3', name: 'Maria Silva' }
    const fetchSpy = mockFetch([
      ...baseRoutes([]),
      { method: 'POST', match: /\/crm\/people$/, data: created },
    ])
    renderTable()
    await screen.findByText('Nada por aqui ainda')

    fireEvent.click(screen.getAllByText(/^Nov[oa] pessoa$/)[0])

    // No junk record: the form opens and nothing is posted yet.
    const dialog = await screen.findByRole('dialog')
    const submit = within(dialog).getByRole('button', {
      name: 'Criar',
    }) as HTMLButtonElement
    expect(submit.disabled).toBe(true)
    expect(
      within(dialog).getByText(/Preencha para continuar: Nome/),
    ).toBeTruthy()
    expect(
      fetchSpy.mock.calls.some(([, init]) => init?.method === 'POST'),
    ).toBe(false)

    await createFromDialog('Nome', 'Maria Silva')

    await waitFor(() =>
      expect(fetchBody(fetchSpy, /\/crm\/people$/)).toEqual({
        name: 'Maria Silva',
      }),
    )
  })

  it('notifies and adds nothing when creation fails', async () => {
    mockFetch([
      ...baseRoutes([]),
      {
        method: 'POST',
        match: /\/crm\/people$/,
        status: 403,
        error: 'Limite de registros atingido',
      },
    ])
    renderTable()
    await screen.findByText('Nada por aqui ainda')

    fireEvent.click(screen.getAllByText(/^Nov[oa] pessoa$/)[0])
    await createFromDialog('Nome', 'Maria Silva')

    await waitFor(() =>
      expect(notify.error).toHaveBeenCalledWith('Limite de registros atingido'),
    )
    expect(screen.getByText('Nada por aqui ainda')).toBeTruthy()
  })

  it('saves an inline edit via PATCH', async () => {
    const fetchSpy = mockFetch([
      ...baseRoutes(),
      {
        method: 'PATCH',
        match: '/crm/people/p2',
        data: { ...PEOPLE[1], city: 'Recife' },
      },
    ])
    renderTable()
    await screen.findByText('Nova York')

    fireEvent.click(screen.getByText('Nova York'))
    const input = screen.getByDisplayValue('Nova York')
    fireEvent.change(input, { target: { value: 'Recife' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() =>
      expect(fetchBody(fetchSpy, '/crm/people/p2', 'PATCH')).toEqual({
        city: 'Recife',
      }),
    )
    expect(screen.getByText('Recife')).toBeTruthy()
  })

  it('reverts an optimistic delete when the API rejects it', async () => {
    mockFetch([
      ...baseRoutes(),
      {
        method: 'DELETE',
        match: '/crm/people/p1',
        status: 403,
        error: 'Sem permissão',
      },
    ])
    renderTable()
    const cell = await screen.findByText('Ada Lovelace')
    const row = cell.closest('tr') as HTMLElement

    fireEvent.click(within(row).getByRole('button', { name: 'Excluir' }))
    const confirm = await screen.findByRole('alertdialog')
    fireEvent.click(within(confirm).getByRole('button', { name: 'Excluir' }))

    await waitFor(() =>
      expect(notify.error).toHaveBeenCalledWith('Sem permissão'),
    )
    expect(await screen.findByText('Ada Lovelace')).toBeTruthy()
  })

  it('opens the details panel with the activity timeline', async () => {
    mockFetch(baseRoutes())
    renderTable()
    const cell = await screen.findByText('Ada Lovelace')
    const row = cell.closest('tr') as HTMLElement

    fireEvent.click(within(row).getByRole('button', { name: 'Abrir detalhes' }))

    expect(await screen.findByText('Atividade')).toBeTruthy()
    expect(await screen.findByText('Sem atividade ainda.')).toBeTruthy()
    expect(screen.getByText('Salvar')).toBeTruthy()
  })
})
