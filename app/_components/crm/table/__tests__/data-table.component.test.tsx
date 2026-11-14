import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GridColumn } from '@/app/_components/crm/table/grid'
import type { Lookups } from '@/src/hooks/use-crm-workspace-lookups'
import { DataTable } from '../data-table'

vi.mock('@/lib/notify', () => ({
  notify: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() },
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/acme/crm/people',
}))

const LOOKUPS: Lookups = {
  maps: {
    users: {},
    companies: {},
    people: {},
    opportunities: {},
    pipelines: {},
    stages: {},
    products: {},
  },
  options: {
    users: [],
    companies: [],
    people: [],
    opportunities: [],
    pipelines: [],
    stages: [],
    products: [],
  },
}

const COLUMNS: GridColumn[] = [
  { key: 'name', header: 'Nome', kind: 'text', required: true, primary: true },
  { key: 'city', header: 'Cidade', kind: 'text' },
]

// 25 people: "Pessoa 01".."Pessoa 25"; the odd ones live in Recife.
const ROWS = Array.from({ length: 25 }, (_, i) => {
  const n = String(i + 1).padStart(2, '0')
  return {
    id: `p${n}`,
    name: `Pessoa ${n}`,
    city: i % 2 === 0 ? 'Recife' : 'Natal',
  }
})

function renderEmptyTable(props: { error?: string | null } = {}) {
  const refetch = vi.fn()
  render(
    <DataTable
      columns={COLUMNS}
      data={[]}
      workspaceId='ws1'
      slug='acme'
      resource='people'
      createTitle='pessoa'
      lookups={LOOKUPS}
      refetch={refetch}
      {...props}
    />,
  )
  return { refetch }
}

function renderTable() {
  return render(
    <DataTable
      columns={COLUMNS}
      data={ROWS}
      workspaceId='ws1'
      slug='acme'
      resource='people'
      createTitle='pessoa'
      lookups={LOOKUPS}
      refetch={vi.fn()}
    />,
  )
}

/** Names of the rendered rows, in order. */
function renderedNames(): string[] {
  return screen.getAllByText(/^Pessoa \d{2}$/).map((el) => el.textContent ?? '')
}

/** Pager buttons carry their name as screen-reader text. */
function pagerButton(name: string): HTMLElement {
  return screen.getByText(name).closest('button') as HTMLElement
}

function openHeaderMenu(label: string) {
  const header = screen
    .getAllByRole('columnheader')
    .find((th) => th.textContent?.includes(label)) as HTMLElement
  fireEvent.click(within(header).getByRole('button'))
}

describe('<DataTable /> (CRM grid on TanStack Table v9)', () => {
  // Filters and sorting persist in localStorage; start each test clean.
  beforeEach(() => window.localStorage.clear())

  it('pages the rows ten at a time', () => {
    renderTable()

    expect(renderedNames()).toHaveLength(10)
    expect(screen.getByText(/Página 1 de/).textContent).toContain('de 3')

    fireEvent.click(pagerButton('Próxima página'))
    expect(screen.getByText(/Página 2 de/)).toBeTruthy()
    expect(renderedNames()[0]).toBe('Pessoa 11')

    fireEvent.click(pagerButton('Última página'))
    expect(renderedNames()).toEqual([
      'Pessoa 21',
      'Pessoa 22',
      'Pessoa 23',
      'Pessoa 24',
      'Pessoa 25',
    ])
  })

  it('searches every column through the global filter', () => {
    renderTable()

    fireEvent.change(screen.getByLabelText('Pesquisar…'), {
      target: { value: 'pessoa 2' },
    })

    expect(renderedNames()).toEqual([
      'Pessoa 20',
      'Pessoa 21',
      'Pessoa 22',
      'Pessoa 23',
      'Pessoa 24',
      'Pessoa 25',
    ])
  })

  it('filters a column from its header menu', () => {
    renderTable()

    openHeaderMenu('Cidade')
    fireEvent.change(screen.getByPlaceholderText('Filtrar Cidade…'), {
      target: { value: 'natal' },
    })

    // 12 people live in Natal: two pages, all of them even-numbered.
    expect(screen.getByText(/Página 1 de/).textContent).toContain('de 2')
    expect(renderedNames().every((n) => Number(n.slice(-2)) % 2 === 0)).toBe(
      true,
    )
  })

  it('sorts a column descending from its header menu', () => {
    renderTable()

    openHeaderMenu('Nome')
    fireEvent.click(screen.getByRole('button', { name: /Desc/ }))

    expect(renderedNames()[0]).toBe('Pessoa 25')
    expect(renderedNames()[9]).toBe('Pessoa 16')
  })

  it('selects every row of the page', () => {
    renderTable()

    fireEvent.click(screen.getByLabelText('Selecionar tudo'))

    const summary = screen.getByText(/linha\(s\) selecionada\(s\)/)
    expect(summary.textContent?.replace(/\s+/g, ' ')).toContain('10 de 25')
  })

  it('offers "Limpar filtros" when the search hides every row', async () => {
    renderTable()
    fireEvent.change(screen.getByLabelText('Pesquisar…'), {
      target: { value: 'zzz' },
    })

    expect(
      await screen.findByText('Nenhum registro com estes filtros'),
    ).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Limpar filtros' }))

    expect(await screen.findByText('Pessoa 01')).toBeTruthy()
  })

  it('shows the load error with a retry button', () => {
    const { refetch } = renderEmptyTable({
      error: 'Erro de rede. Tente novamente.',
    })

    expect(screen.getByText('Não foi possível carregar a lista')).toBeTruthy()
    expect(screen.getByText('Erro de rede. Tente novamente.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it('opens the create form instead of inserting a placeholder record', () => {
    renderEmptyTable()

    fireEvent.click(screen.getAllByText('Nova pessoa')[0])

    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByText('Criar pessoa')).toBeTruthy()
  })
})

describe('<DataTable /> persisted view state', () => {
  beforeEach(() => window.localStorage.clear())

  it('restores the column filters saved for the same workspace and resource', async () => {
    window.localStorage.setItem(
      'steel:crm-table-state:ws1:people',
      JSON.stringify({
        filters: [{ id: 'city', value: 'natal' }],
        sorting: [],
      }),
    )
    renderTable()

    // 12 people live in Natal: two pages instead of three.
    await waitFor(() =>
      expect(screen.getByText(/Página 1 de/).textContent).toContain('de 2'),
    )
  })

  it('ignores a corrupted saved state', () => {
    window.localStorage.setItem('steel:crm-table-state:ws1:people', '{nope')
    renderTable()

    expect(renderedNames()).toHaveLength(10)
  })
})
