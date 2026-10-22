import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { WorkspacePermissionsProvider } from '@/app/_components/workspace/workspace-permissions'
import {
  type FetchRoute,
  fetchBody,
  mockFetch,
  renderWithQuery,
} from '@/src/__tests__/component-utils'
import type { WhatsAppTeamDTO } from '@/types/whatsapp-team'
import { WhatsappTeamsPage } from '../whatsapp-teams-page'

vi.setConfig({ testTimeout: 20_000 })

const notify = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('@/lib/notify', () => ({ notify }))

const API = '/api/workspaces/ws_1/whatsapp'

const MEMBERS = [
  { id: 'u_1', name: 'Lia Líder', email: 'lia@x.com', image: null },
  { id: 'u_2', name: 'Ana Agente', email: 'ana@x.com', image: null },
  { id: 'u_3', name: 'Caio Costa', email: 'caio@x.com', image: null },
]

const SALES: WhatsAppTeamDTO = {
  id: 'tm_sales',
  workspaceId: 'ws_1',
  name: 'Vendas',
  description: 'Leads de entrada',
  members: [
    {
      userId: 'u_1',
      name: 'Lia Líder',
      email: 'lia@x.com',
      image: null,
      role: 'LEADER',
    },
    {
      userId: 'u_2',
      name: 'Ana Agente',
      email: 'ana@x.com',
      image: null,
      role: 'AGENT',
    },
  ],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

function setup(teams: WhatsAppTeamDTO[], extra: FetchRoute[] = []) {
  return mockFetch([
    ...extra,
    { match: `${API}/assignable-members`, data: MEMBERS },
    { match: `${API}/presence`, data: [] },
    {
      match: `${API}/teams/me`,
      data: { mode: 'ALL', leadsTeamIds: [], memberTeamIds: [] },
    },
    { match: `${API}/teams`, data: teams },
  ])
}

async function pickRole(memberName: string, role: RegExp) {
  fireEvent.click(
    screen.getByRole('combobox', { name: `Papel de ${memberName} na equipe` }),
  )
  const option = within(await screen.findByRole('listbox')).getByRole(
    'option',
    { name: role },
  )
  fireEvent.pointerDown(option)
  fireEvent.click(option)
}

describe('<WhatsappTeamsPage /> presence', () => {
  it('marks who is away or available for who manages the teams', async () => {
    setup(
      [SALES],
      [
        {
          match: `${API}/presence`,
          data: [
            { userId: 'u_1', status: 'AVAILABLE', updatedAt: null },
            {
              userId: 'u_2',
              status: 'AWAY',
              updatedAt: '2026-10-22T12:00:00.000Z',
            },
          ],
        },
      ],
    )
    renderWithQuery(
      <WorkspacePermissionsProvider
        value={{ isPrivileged: true, permissions: null }}
      >
        <WhatsappTeamsPage workspaceId='ws_1' />
      </WorkspacePermissionsProvider>,
    )

    await screen.findByText('Vendas')
    await waitFor(() => expect(screen.getAllByRole('img').length).toBe(2))
    const marks = screen.getAllByRole('img').map((mark) => mark.title)
    expect(marks).toEqual(['Disponível', 'Ausente'])
  })

  it('shows presence to a team leader who is not an admin', async () => {
    setup(
      [SALES],
      [
        {
          match: `${API}/teams/me`,
          data: {
            mode: 'SCOPED',
            leadsTeamIds: ['tm_sales'],
            memberTeamIds: [],
          },
        },
        {
          match: `${API}/presence`,
          data: [{ userId: 'u_2', status: 'AWAY', updatedAt: null }],
        },
      ],
    )
    renderWithQuery(
      <WorkspacePermissionsProvider
        value={{ isPrivileged: false, permissions: null }}
      >
        <WhatsappTeamsPage workspaceId='ws_1' />
      </WorkspacePermissionsProvider>,
    )

    await screen.findByText('Vendas')
    await waitFor(() => expect(screen.getAllByRole('img').length).toBe(2))
  })

  it('shows no presence to a plain member', async () => {
    const fetchSpy = setup([SALES])
    renderWithQuery(
      <WorkspacePermissionsProvider
        value={{ isPrivileged: false, permissions: null }}
      >
        <WhatsappTeamsPage workspaceId='ws_1' />
      </WorkspacePermissionsProvider>,
    )

    await screen.findByText('Vendas')
    expect(screen.queryAllByRole('img')).toHaveLength(0)
    expect(
      fetchSpy.mock.calls.some(([url]) => String(url).includes('/presence')),
    ).toBe(false)
  })
})

describe('<WhatsappTeamsPage />', () => {
  it('lists the teams with leaders and agents', async () => {
    setup([
      SALES,
      { ...SALES, id: 'tm_x', name: 'Solo', members: [], description: null },
    ])
    renderWithQuery(<WhatsappTeamsPage workspaceId='ws_1' />)

    expect(await screen.findByText('Vendas')).toBeTruthy()
    expect(screen.getByText('Leads de entrada')).toBeTruthy()
    expect(screen.getByText('Líderes (1)')).toBeTruthy()
    expect(screen.getByText('Agentes (1)')).toBeTruthy()
    expect(screen.getByText('2 membros')).toBeTruthy()
    expect(screen.getByText('0 membros')).toBeTruthy()
    expect(screen.getAllByText('Ninguém ainda')).toHaveLength(2)
  })

  it('shows the empty state and creates the first team', async () => {
    const fetchSpy = setup(
      [],
      [{ method: 'POST', match: `${API}/teams`, data: SALES, status: 201 }],
    )
    renderWithQuery(<WhatsappTeamsPage workspaceId='ws_1' />)

    fireEvent.click(
      await screen.findByRole('button', { name: 'Criar a primeira equipe' }),
    )
    fireEvent.change(screen.getByLabelText('Nome'), {
      target: { value: 'Vendas' },
    })
    fireEvent.change(screen.getByLabelText('Descrição (opcional)'), {
      target: { value: 'Leads' },
    })
    await screen.findByText('Lia Líder')
    await pickRole('Lia Líder', /^Líder$/)
    await pickRole('Ana Agente', /^Agente$/)
    await pickRole('Ana Agente', /^Fora da equipe$/)
    await pickRole('Ana Agente', /^Agente$/)
    expect(screen.getByText('2 na equipe')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() =>
      expect(fetchBody(fetchSpy, `${API}/teams`, 'POST')).toEqual({
        name: 'Vendas',
        description: 'Leads',
        members: [
          { userId: 'u_1', role: 'LEADER' },
          { userId: 'u_2', role: 'AGENT' },
        ],
      }),
    )
    await waitFor(() =>
      expect(notify.success).toHaveBeenCalledWith('Equipe criada'),
    )
  })

  it('searches members and edits a team', async () => {
    const fetchSpy = setup(
      [SALES],
      [{ method: 'PATCH', match: `${API}/teams/tm_sales`, data: SALES }],
    )
    renderWithQuery(<WhatsappTeamsPage workspaceId='ws_1' />)

    fireEvent.click(await screen.findByRole('button', { name: /Editar/ }))
    expect((screen.getByLabelText('Nome') as HTMLInputElement).value).toBe(
      'Vendas',
    )
    expect(await screen.findByText('2 na equipe')).toBeTruthy()

    fireEvent.change(screen.getByLabelText('Buscar membro'), {
      target: { value: 'caio' },
    })
    await waitFor(() => expect(screen.queryByText('ana@x.com')).toBeNull())
    await pickRole('Caio Costa', /^Agente$/)
    fireEvent.change(screen.getByLabelText('Buscar membro'), {
      target: { value: 'ninguém' },
    })
    expect(screen.getByText('Nenhum membro encontrado')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Descrição (opcional)'), {
      target: { value: '' },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() =>
      expect(fetchBody(fetchSpy, `${API}/teams/tm_sales`, 'PATCH')).toEqual({
        name: 'Vendas',
        description: null,
        members: [
          { userId: 'u_1', role: 'LEADER' },
          { userId: 'u_2', role: 'AGENT' },
          { userId: 'u_3', role: 'AGENT' },
        ],
      }),
    )
    await waitFor(() =>
      expect(notify.success).toHaveBeenCalledWith('Equipe atualizada'),
    )
  })

  it('reports a failed save and closes on cancel', async () => {
    setup(
      [],
      [
        {
          method: 'POST',
          match: `${API}/teams`,
          status: 409,
          error: 'Já existe uma equipe com este nome',
        },
      ],
    )
    renderWithQuery(<WhatsappTeamsPage workspaceId='ws_1' />)

    fireEvent.click(await screen.findByRole('button', { name: 'Nova equipe' }))
    fireEvent.change(screen.getByLabelText('Nome'), {
      target: { value: 'Vendas' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() =>
      expect(notify.error).toHaveBeenCalledWith(
        expect.anything(),
        'Não foi possível salvar a equipe',
      ),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    await waitFor(() => expect(screen.queryByLabelText('Nome')).toBeNull())
  })

  it('deletes a team after confirmation', async () => {
    const fetchSpy = setup(
      [SALES],
      [
        {
          method: 'DELETE',
          match: `${API}/teams/tm_sales`,
          data: { id: 'tm_sales' },
        },
      ],
    )
    renderWithQuery(<WhatsappTeamsPage workspaceId='ws_1' />)

    fireEvent.click(await screen.findByRole('button', { name: /Excluir/ }))
    expect(await screen.findByText('Excluir a equipe Vendas?')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Excluir equipe' }))
    await waitFor(() =>
      expect(
        fetchSpy.mock.calls.some(
          ([url, init]) =>
            String(url).includes('/teams/tm_sales') &&
            init?.method === 'DELETE',
        ),
      ).toBe(true),
    )
    await waitFor(() =>
      expect(notify.success).toHaveBeenCalledWith('Equipe excluída'),
    )
  })

  it('reports a failed deletion', async () => {
    setup(
      [SALES],
      [
        {
          method: 'DELETE',
          match: `${API}/teams/tm_sales`,
          status: 500,
          error: 'boom',
        },
      ],
    )
    renderWithQuery(<WhatsappTeamsPage workspaceId='ws_1' />)
    fireEvent.click(await screen.findByRole('button', { name: /Excluir/ }))
    fireEvent.click(
      await screen.findByRole('button', { name: 'Excluir equipe' }),
    )
    await waitFor(() =>
      expect(notify.error).toHaveBeenCalledWith(
        expect.anything(),
        'Não foi possível excluir a equipe',
      ),
    )
  })

  it('is read-only for members', async () => {
    setup([SALES])
    renderWithQuery(
      <WorkspacePermissionsProvider
        value={{ isPrivileged: false, permissions: null }}
      >
        <WhatsappTeamsPage workspaceId='ws_1' />
      </WorkspacePermissionsProvider>,
    )
    expect(await screen.findByText('Vendas')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Nova equipe' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Editar/ })).toBeNull()
  })

  it('hides the create button in the empty state for members', async () => {
    setup([])
    renderWithQuery(
      <WorkspacePermissionsProvider
        value={{ isPrivileged: false, permissions: null }}
      >
        <WhatsappTeamsPage workspaceId='ws_1' />
      </WorkspacePermissionsProvider>,
    )
    expect(await screen.findByText('Nenhuma equipe ainda')).toBeTruthy()
    expect(
      screen.queryByRole('button', { name: 'Criar a primeira equipe' }),
    ).toBeNull()
  })
})
