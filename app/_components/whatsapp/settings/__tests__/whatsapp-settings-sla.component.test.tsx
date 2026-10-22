import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { WorkspacePermissionsProvider } from '@/app/_components/workspace/workspace-permissions'
import {
  fetchBody,
  mockFetch,
  renderWithQuery,
} from '@/src/__tests__/component-utils'
import { WhatsappSettingsSla } from '../whatsapp-settings-sla'

vi.setConfig({ testTimeout: 20_000 })

const notify = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('@/lib/notify', () => ({ notify }))

const POLICIES = '/api/workspaces/ws_1/whatsapp/sla/policies'

function policy(overrides: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    teamId: null,
    teamName: null,
    enabled: false,
    firstResponseMinutes: 15,
    resolutionMinutes: null,
    businessHoursOnly: true,
    warnAtPercent: 80,
    countAiAsResponse: false,
    notifyAssignee: true,
    notifyTeamLeaders: true,
    notifySupervisors: true,
    supervisorIds: [],
    notifyInApp: true,
    notifyEmail: false,
    createdAt: '2026-10-22T12:00:00.000Z',
    updatedAt: '2026-10-22T12:00:00.000Z',
    ...overrides,
  }
}

const members = [{ id: 'u1', name: 'Ana', email: 'a@x.com', image: null }]

function routes(list: unknown[]) {
  return [
    { method: 'POST', match: POLICIES, data: policy({ id: 'new' }) },
    {
      method: 'PATCH',
      match: `${POLICIES}/p1`,
      data: policy({ enabled: true }),
    },
    { method: 'DELETE', match: `${POLICIES}/p1`, data: { id: 'p1' } },
    { match: POLICIES, data: list },
    { match: '/whatsapp/assignable-members', data: members },
    {
      match: '/whatsapp/teams',
      data: [
        {
          id: 't1',
          workspaceId: 'ws_1',
          name: 'Suporte',
          description: null,
          members: [],
        },
      ],
    },
  ]
}

describe('<WhatsappSettingsSla />', () => {
  it('offers to create the default policy when none exists', async () => {
    const fetchSpy = mockFetch(routes([]))
    renderWithQuery(<WhatsappSettingsSla workspaceId='ws_1' />)

    const create = await screen.findByRole('button', {
      name: 'Criar política padrão',
    })
    await waitFor(() =>
      expect((create as HTMLButtonElement).disabled).toBe(false),
    )
    fireEvent.click(create)

    await waitFor(() =>
      expect(fetchBody(fetchSpy, POLICIES, 'POST')).toEqual({ teamId: null }),
    )
    expect(notify.success).toHaveBeenCalled()
  })

  it('saves the edited targets of a policy', async () => {
    const fetchSpy = mockFetch(routes([policy()]))
    renderWithQuery(<WhatsappSettingsSla workspaceId='ws_1' />)

    const first = (await screen.findByLabelText(
      'Primeira resposta (min)',
    )) as HTMLInputElement
    await waitFor(() => expect(first.value).toBe('15'))
    fireEvent.change(first, { target: { value: '30' } })
    fireEvent.click(
      screen.getByRole('switch', { name: 'Ativar esta política de SLA' }),
    )
    fireEvent.click(
      screen.getByRole('switch', { name: 'Medir também a resolução' }),
    )
    fireEvent.change(screen.getByLabelText('Resolução (min)'), {
      target: { value: '240' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar política' }))

    await waitFor(() =>
      expect(fetchBody(fetchSpy, `${POLICIES}/p1`, 'PATCH')).toMatchObject({
        enabled: true,
        firstResponseMinutes: 30,
        resolutionMinutes: 240,
        warnAtPercent: 80,
        businessHoursOnly: true,
        countAiAsResponse: false,
      }),
    )
    expect(notify.success).toHaveBeenCalledWith('Política de SLA salva')
  })

  it.each([
    ['first response below one minute', 'Primeira resposta (min)', '0'],
    ['warning below 10%', 'Avisar em (% do prazo)', '5'],
    ['warning above 99%', 'Avisar em (% do prazo)', '100'],
  ])('does not submit %s (native validation)', async (_name, label, value) => {
    const fetchSpy = mockFetch(routes([policy()]))
    renderWithQuery(<WhatsappSettingsSla workspaceId='ws_1' />)

    const input = await screen.findByLabelText(label)
    fireEvent.change(input, { target: { value } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar política' }))

    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(fetchBody(fetchSpy, `${POLICIES}/p1`, 'PATCH')).toBeUndefined()
  })

  it('refuses a resolution shorter than the first response', async () => {
    const fetchSpy = mockFetch(routes([policy({ resolutionMinutes: 60 })]))
    renderWithQuery(<WhatsappSettingsSla workspaceId='ws_1' />)

    const first = await screen.findByLabelText('Primeira resposta (min)')
    fireEvent.change(first, { target: { value: '120' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar política' }))

    await waitFor(() =>
      expect(notify.error).toHaveBeenCalledWith(
        'O prazo de resolução não pode ser menor que o da primeira resposta',
      ),
    )
    expect(fetchBody(fetchSpy, `${POLICIES}/p1`, 'PATCH')).toBeUndefined()
  })

  it('toggles supervisors and removes the policy', async () => {
    const fetchSpy = mockFetch(routes([policy()]))
    renderWithQuery(<WhatsappSettingsSla workspaceId='ws_1' />)

    const ana = await screen.findByRole('button', { name: 'Ana' })
    fireEvent.click(ana)
    expect(ana.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(ana)
    expect(ana.getAttribute('aria-pressed')).toBe('false')

    fireEvent.click(screen.getByRole('button', { name: /Remover/ }))
    await waitFor(() =>
      expect(
        fetchSpy.mock.calls.some(
          ([url, init]) =>
            String(url).endsWith('/p1') && init?.method === 'DELETE',
        ),
      ).toBe(true),
    )
  })

  it('adds a team override and lists the existing ones', async () => {
    const fetchSpy = mockFetch(
      routes([
        policy(),
        policy({ id: 'p2', teamId: 't9', teamName: 'Vendas' }),
      ]),
    )
    renderWithQuery(<WhatsappSettingsSla workspaceId='ws_1' />)

    expect(await screen.findByText('Equipe Vendas')).toBeTruthy()
    expect(screen.getByText('Política padrão do workspace')).toBeTruthy()

    fireEvent.click(screen.getByLabelText('Equipe'))
    fireEvent.click(await screen.findByRole('option', { name: 'Suporte' }))
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar' }))

    await waitFor(() =>
      expect(fetchBody(fetchSpy, POLICIES, 'POST')).toEqual({ teamId: 't1' }),
    )
  })

  it('is hidden from non-admins', () => {
    mockFetch(routes([]))
    const { container } = renderWithQuery(
      <WorkspacePermissionsProvider
        value={{ isPrivileged: false, permissions: null }}
      >
        <WhatsappSettingsSla workspaceId='ws_1' />
      </WorkspacePermissionsProvider>,
    )
    expect(container.textContent).toBe('')
  })
})
