import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  fetchBody,
  mockFetch,
  renderWithQuery,
} from '@/src/__tests__/component-utils'
import { CrmMailingListsTable } from '../crm-mailing-lists-table'

const WS = 'ws_1'

const notify = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}))
vi.mock('@/lib/notify', () => ({ notify }))
vi.mock('@/src/hooks/use-crm-workspace-lookups', () => ({
  useCrmWorkspaceLookups: () => ({ lookups: undefined }),
}))
vi.mock('@/app/_components/crm/table/data-table', () => ({
  DataTable: (props: {
    data: { id: string; name: string }[]
    headerAction?: React.ReactNode
    onOpenRecord?: (r: { id: string }) => void
  }) => (
    <div>
      {props.headerAction}
      {props.data.map((row) => (
        <button
          key={row.id}
          type='button'
          onClick={() => props.onOpenRecord?.(row)}
        >
          abrir {row.name}
        </button>
      ))}
    </div>
  ),
}))

const LIST = {
  id: 'l1',
  name: 'Clientes VIP',
  description: 'Quem mais compra',
  memberCount: 1,
}
const MEMBERS = [{ id: 'm1', email: 'ana@acme.com', name: 'Ana' }]
const LEADS = [
  { id: 'd1', name: 'Ana', emails: ['ANA@acme.com'], stage: 'RECEIVED' },
  { id: 'd2', name: 'Bruno', emails: ['bruno@acme.com'], stage: 'QUALIFIED' },
  { id: 'd3', name: 'Sem email', emails: [], stage: 'RECEIVED' },
  { id: 'd4', name: 'Carla', emails: ['carla@acme.com'], stage: 'PROPOSAL' },
]

function setup(extra: Parameters<typeof mockFetch>[0] = []) {
  const spy = mockFetch([
    ...extra,
    {
      method: 'POST',
      match: /mailing-lists\/l1\/members$/,
      handler: (_u, init) => ({ id: 'mx', ...JSON.parse(String(init?.body)) }),
    },
    { method: 'DELETE', match: '/mailing-lists/l1/members/', data: null },
    { method: 'DELETE', match: /mailing-lists\/l1$/, data: null },
    { method: 'POST', match: /crm\/mailing-lists$/, data: { id: 'l2' } },
    { match: '/mailing-lists/l1/members', data: MEMBERS },
    { match: '/crm/mailing-lists', data: [LIST] },
    { match: '/crm/leads', data: LEADS },
  ])
  renderWithQuery(<CrmMailingListsTable workspaceId={WS} slug='acme' />)
  return spy
}

describe('<CrmMailingListsTable /> create', () => {
  it('requires a name', async () => {
    const spy = setup()
    fireEvent.click(screen.getByRole('button', { name: /nova lista/i }))
    fireEvent.click(await screen.findByRole('button', { name: 'Criar lista' }))
    await waitFor(() =>
      expect(notify.error).toHaveBeenCalledWith('Informe o nome da lista'),
    )
    expect(fetchBody(spy, /crm\/mailing-lists$/)).toBeUndefined()
  })

  it('creates the list with trimmed values and omits an empty description', async () => {
    const spy = setup()
    fireEvent.click(screen.getByRole('button', { name: /nova lista/i }))
    fireEvent.change(await screen.findByPlaceholderText('Ex: Clientes VIP'), {
      target: { value: '  Newsletter  ' },
    })
    fireEvent.change(screen.getByPlaceholderText('Descrição da lista…'), {
      target: { value: '   ' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Criar lista' }))

    await waitFor(() =>
      expect(notify.success).toHaveBeenCalledWith('Lista criada'),
    )
    expect(fetchBody(spy, /crm\/mailing-lists$/)).toEqual({
      name: 'Newsletter',
    })
    await waitFor(() =>
      expect(screen.queryByPlaceholderText('Ex: Clientes VIP')).toBeNull(),
    )
  })
})

describe('<CrmMailingListsTable /> detail', () => {
  async function openDetail() {
    fireEvent.click(
      await screen.findByRole('button', { name: 'abrir Clientes VIP' }),
    )
    return screen.findByText('Membros (1)')
  }

  it('shows the description and members, and removes a member', async () => {
    const spy = setup()
    await openDetail()
    expect(screen.getByText('Quem mais compra')).toBeTruthy()
    expect(screen.getByText('ana@acme.com')).toBeTruthy()

    fireEvent.click(
      screen.getByRole('button', { name: 'Remover ana@acme.com da lista' }),
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Remover' }))
    await waitFor(() =>
      expect(
        spy.mock.calls.some(
          ([u, init]) =>
            String(u).endsWith('/members/m1') && init?.method === 'DELETE',
        ),
      ).toBe(true),
    )
  })

  it('shows the empty members state', async () => {
    setup([{ match: '/mailing-lists/l1/members', data: [] }])
    fireEvent.click(
      await screen.findByRole('button', { name: 'abrir Clientes VIP' }),
    )
    expect(
      await screen.findByText(
        'Esta lista ainda não tem membros. Escolha leads existentes, cole e-mails ou importe um arquivo CSV acima.',
      ),
    ).toBeTruthy()
  })

  it('lead picker hides existing members (case-insensitive) and leads without e-mail', async () => {
    const spy = setup()
    await openDetail()
    fireEvent.click(screen.getByRole('button', { name: /adicionar leads/i }))

    expect(await screen.findByText('Bruno')).toBeTruthy()
    expect(screen.getByText('Carla')).toBeTruthy()
    expect(screen.getByText('Lead qualificado')).toBeTruthy()
    expect(screen.queryByText('Sem email')).toBeNull()
    // "Ana" appears only as the existing member, not as a pickable lead.
    expect(screen.queryByText('ANA@acme.com')).toBeNull()

    const add = screen.getByRole('button', {
      name: 'Adicionar',
    }) as HTMLButtonElement
    expect(add.disabled).toBe(true)

    fireEvent.change(
      screen.getByPlaceholderText('Buscar lead por nome ou email…'),
      { target: { value: 'carla' } },
    )
    expect(screen.queryByText('Bruno')).toBeNull()
    const carla = screen
      .getByText('Carla')
      .closest('label')
      ?.querySelector('input') as HTMLInputElement
    fireEvent.click(carla)
    expect(screen.getByText('1 selecionado(s)')).toBeTruthy()
    fireEvent.click(add)

    await waitFor(() =>
      expect(fetchBody(spy, /members$/)).toEqual({
        email: 'carla@acme.com',
        name: 'Carla',
      }),
    )
  })

  it('removes the list and closes the panel', async () => {
    setup()
    await openDetail()
    fireEvent.click(screen.getByRole('button', { name: /remover lista/i }))
    fireEvent.click(
      (await screen.findAllByRole('button', { name: /remover lista/i })).at(
        -1,
      ) as HTMLElement,
    )
    await waitFor(() =>
      expect(notify.success).toHaveBeenCalledWith('Lista removida'),
    )
  })

  it('reports a failure when removing the list', async () => {
    setup([
      {
        method: 'DELETE',
        match: /mailing-lists\/l1$/,
        status: 403,
        error: 'Sem permissão',
      },
    ])
    await openDetail()
    fireEvent.click(screen.getByRole('button', { name: /remover lista/i }))
    fireEvent.click(
      (await screen.findAllByRole('button', { name: /remover lista/i })).at(
        -1,
      ) as HTMLElement,
    )
    await waitFor(() => expect(notify.error).toHaveBeenCalled())
    expect((notify.error.mock.lastCall?.[0] as Error)?.message).toBe(
      'Sem permissão',
    )
  })
})
