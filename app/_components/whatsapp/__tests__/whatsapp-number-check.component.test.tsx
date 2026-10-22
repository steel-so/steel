import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  type FetchRoute,
  fetchBody,
  mockFetch,
  renderWithQuery,
} from '@/src/__tests__/component-utils'
import type { WhatsAppAiCampaignDTO } from '@/types/whatsapp-ai-campaign'
import { WorkspacePermissionsProvider } from '../../workspace/workspace-permissions'
import { AiCampaignNoWhatsapp } from '../ai-campaigns/ai-campaign-no-whatsapp'
import { WhatsappSettingsBroadcasts } from '../settings/whatsapp-settings-broadcasts'
import { WhatsappSettingsNumberCheck } from '../settings/whatsapp-settings-number-check'
import { WhatsappContactsPage } from '../whatsapp-contacts-page'

// Dialog/select flows render Base UI portals and wait on several fetches;
// the project default (5s) is too tight when the suite runs under load.
vi.setConfig({ testTimeout: 20_000 })

const notify = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('@/lib/notify', () => ({ notify }))

const API = '/api/workspaces/ws_1/whatsapp'
const VALIDATIONS = `${API}/number-validations`

function contact(overrides: Record<string, unknown> = {}) {
  return {
    id: 'c1',
    workspaceId: 'ws_1',
    waId: '5511911111111',
    name: 'Ana Souza',
    avatarUrl: null,
    description: null,
    conversationCount: 0,
    broadcastOptedOutAt: null,
    broadcastOptOutSource: null,
    hasWhatsapp: null,
    whatsappCheckedAt: null,
    createdAt: '2026-03-15T12:00:00.000Z',
    updatedAt: '2026-03-15T12:00:00.000Z',
    ...overrides,
  }
}

function connection(provider: 'ZAPI' | 'META') {
  return {
    id: `conn-${provider}`,
    workspaceId: 'ws_1',
    provider,
    label: provider === 'ZAPI' ? 'Z-API' : 'Oficial',
    phoneNumber: '5511999990000',
    status: 'CONNECTED',
    statusError: null,
    zapiInstanceId: null,
    metaPhoneNumberId: null,
    metaWabaId: null,
    createdById: 'u1',
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  }
}

function run(overrides: Record<string, unknown> = {}) {
  return {
    id: 'run1',
    workspaceId: 'ws_1',
    connectionId: 'conn-ZAPI',
    scope: 'CONTACTS',
    scopeId: null,
    status: 'DONE',
    total: 3,
    processed: 3,
    withWhatsapp: 2,
    withoutWhatsapp: 1,
    failed: 0,
    cached: 0,
    errorMessage: null,
    startedAt: null,
    finishedAt: null,
    createdAt: '2026-10-22T12:00:00.000Z',
    ...overrides,
  }
}

async function pickOption(name: string | RegExp) {
  const option = within(await screen.findByRole('listbox')).getByRole(
    'option',
    { name },
  )
  fireEvent.pointerDown(option)
  fireEvent.click(option)
  await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull())
}

function startRoutes(extra: FetchRoute[] = []): FetchRoute[] {
  return [
    ...extra,
    { method: 'POST', match: VALIDATIONS, status: 201, data: run() },
    { match: `${VALIDATIONS}/run1`, data: run() },
    { match: `${API}/connections`, data: [connection('ZAPI')] },
  ]
}

describe('contacts page "tem zap?"', () => {
  const list = [
    contact({
      id: 'c1',
      hasWhatsapp: true,
      whatsappCheckedAt: '2026-10-20T10:00:00.000Z',
    }),
    contact({
      id: 'c2',
      name: 'Bruno',
      waId: '5521988887777',
      hasWhatsapp: false,
    }),
    contact({ id: 'c3', name: 'Carla', waId: '5531977776666' }),
  ]

  it('shows a badge per contact with the three states', async () => {
    mockFetch([...startRoutes(), { match: `${API}/contacts`, data: list }])
    renderWithQuery(<WhatsappContactsPage workspaceId='ws_1' />)

    expect(await screen.findByText('Tem WhatsApp')).toBeTruthy()
    expect(screen.getByText('Sem WhatsApp')).toBeTruthy()
    expect(screen.getByText('Não verificado')).toBeTruthy()
  })

  it('filters by the checked state on the server', async () => {
    const spy = mockFetch([
      ...startRoutes(),
      { match: `${API}/contacts?whatsapp=no`, data: [list[1]] },
      { match: `${API}/contacts`, data: list },
    ])
    renderWithQuery(<WhatsappContactsPage workspaceId='ws_1' />)
    await screen.findByText('Carla')

    fireEvent.click(
      screen.getByRole('combobox', { name: 'Filtrar por WhatsApp' }),
    )
    await pickOption('Sem WhatsApp')

    await waitFor(() => expect(screen.queryByText('Carla')).toBeNull())
    expect(
      spy.mock.calls.some(([url]) =>
        String(url).endsWith('contacts?whatsapp=no'),
      ),
    ).toBe(true)
  })

  it('validates every contact when nothing is filtered', async () => {
    const spy = mockFetch([
      ...startRoutes(),
      { match: `${API}/contacts`, data: list },
    ])
    renderWithQuery(<WhatsappContactsPage workspaceId='ws_1' />)
    await screen.findByText('Carla')

    fireEvent.click(screen.getByRole('button', { name: 'Validar números' }))
    const dialog = await screen.findByRole('dialog')
    await waitFor(() =>
      expect(
        (
          within(dialog).getByRole('button', {
            name: 'Validar números',
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false),
    )
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Validar números' }),
    )

    expect(await within(dialog).findByText('Validação concluída')).toBeTruthy()
    expect(fetchBody(spy, VALIDATIONS)).toEqual({
      scope: 'CONTACTS',
      all: true,
      force: false,
    })
  })

  it('validates only the listed contacts when a search is on', async () => {
    const spy = mockFetch([
      ...startRoutes(),
      { match: `${API}/contacts?search=bru`, data: [list[1]] },
      { match: `${API}/contacts`, data: list },
    ])
    renderWithQuery(<WhatsappContactsPage workspaceId='ws_1' />)
    await screen.findByText('Carla')

    fireEvent.change(screen.getByPlaceholderText('Buscar contato'), {
      target: { value: 'bru' },
    })
    await waitFor(() => expect(screen.queryByText('Carla')).toBeNull())
    await screen.findByText('Bruno')
    fireEvent.click(screen.getByRole('button', { name: 'Validar números' }))
    const dialog = await screen.findByRole('dialog')
    await waitFor(() =>
      expect(
        (
          within(dialog).getByRole('button', {
            name: 'Validar números',
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false),
    )
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Validar números' }),
    )

    await within(dialog).findByText('Validação concluída')
    expect(fetchBody(spy, VALIDATIONS)).toMatchObject({
      scope: 'CONTACTS',
      contactIds: ['c2'],
    })
  })

  it('hides the action from members who cannot edit contacts', async () => {
    mockFetch([...startRoutes(), { match: `${API}/contacts`, data: list }])
    renderWithQuery(
      <WorkspacePermissionsProvider
        value={{ isPrivileged: false, permissions: { contacts: ['VIEW'] } }}
      >
        <WhatsappContactsPage workspaceId='ws_1' />
      </WorkspacePermissionsProvider>,
    )
    await screen.findByText('Carla')
    expect(screen.queryByRole('button', { name: 'Validar números' })).toBeNull()
  })

  it('offers the check right after importing a spreadsheet', async () => {
    const spy = mockFetch([
      ...startRoutes(),
      {
        method: 'POST',
        match: `${API}/contacts/import`,
        data: {
          created: 3,
          updated: 0,
          skipped: 0,
          rejected: [],
          validation: run(),
          validationUnavailable: null,
        },
      },
      { match: `${API}/contacts`, data: list },
    ])
    renderWithQuery(<WhatsappContactsPage workspaceId='ws_1' />)
    await screen.findByText('Carla')

    fireEvent.click(screen.getByRole('button', { name: 'Importar planilha' }))
    const dialog = await screen.findByRole('dialog')
    const input = dialog.querySelector('input[type=file]') as HTMLInputElement
    const file = new File(['Telefone\n5511999998888'], 'c.csv', {
      type: 'text/csv',
    })
    fireEvent.change(input, { target: { files: [file] } })
    await waitFor(() =>
      expect(
        (
          within(dialog).getByRole('button', {
            name: 'Importar',
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false),
    )
    await waitFor(() =>
      expect(
        within(dialog).getByRole('checkbox').getAttribute('aria-disabled'),
      ).not.toBe('true'),
    )
    fireEvent.click(within(dialog).getByRole('checkbox'))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Importar' }))

    expect(await within(dialog).findByText('Validação concluída')).toBeTruthy()
    expect(fetchBody(spy, `${API}/contacts/import`)).toEqual({
      csv: 'Telefone\n5511999998888',
      validateWhatsapp: true,
    })
  })

  it('reports an unavailable check after the import', async () => {
    mockFetch([
      { match: `${API}/connections`, data: [connection('META')] },
      {
        method: 'POST',
        match: `${API}/contacts/import`,
        data: {
          created: 1,
          updated: 0,
          skipped: 0,
          rejected: [],
          validation: null,
          validationUnavailable: 'Conecte uma instância Z-API',
        },
      },
      { match: `${API}/contacts`, data: list },
    ])
    renderWithQuery(<WhatsappContactsPage workspaceId='ws_1' />)
    await screen.findByText('Carla')

    fireEvent.click(screen.getByRole('button', { name: 'Importar planilha' }))
    const dialog = await screen.findByRole('dialog')
    expect(
      await within(dialog).findByText(/Disponível só com uma conexão Z-API/),
    ).toBeTruthy()
    const input = dialog.querySelector('input[type=file]') as HTMLInputElement
    fireEvent.change(input, {
      target: {
        files: [
          new File(['Telefone\n5511999998888'], 'c.csv', { type: 'text/csv' }),
        ],
      },
    })
    await waitFor(() =>
      expect(
        (
          within(dialog).getByRole('button', {
            name: 'Importar',
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false),
    )
    fireEvent.click(within(dialog).getByRole('button', { name: 'Importar' }))

    expect(
      await within(dialog).findByText(/a checagem de WhatsApp não rodou/),
    ).toBeTruthy()
  })
})

describe('broadcast lists "tem zap?"', () => {
  function broadcast(overrides: Record<string, unknown> = {}) {
    return {
      id: 'bc_1',
      workspaceId: 'ws_1',
      connectionId: 'conn-ZAPI',
      name: 'Promo',
      messageBody: 'Oi!',
      mediaUrl: null,
      mediaType: null,
      status: 'DRAFT',
      scheduledAt: null,
      createdById: 'u_1',
      recipientCount: 10,
      sentCount: 0,
      failedCount: 0,
      skippedCount: 0,
      noWhatsappCount: 3,
      skipNoWhatsapp: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      ...overrides,
    }
  }

  const base: FetchRoute[] = [
    {
      match: `${API}/contacts`,
      data: [
        contact({ id: 'c1' }),
        contact({ id: 'c2', name: 'Bruno', hasWhatsapp: false }),
      ],
    },
    { match: `${API}/templates`, data: [] },
  ]

  it('shows the counters and validates the base of a draft list', async () => {
    const spy = mockFetch([
      ...startRoutes(base),
      {
        match: `${API}/broadcasts`,
        data: [
          broadcast(),
          broadcast({
            id: 'bc_2',
            name: 'Feita',
            status: 'DONE',
            noWhatsappCount: 0,
            skipNoWhatsapp: false,
          }),
        ],
      },
    ])
    renderWithQuery(<WhatsappSettingsBroadcasts workspaceId='ws_1' />)

    expect(await screen.findByText(/3 sem WhatsApp/)).toBeTruthy()
    expect(screen.getAllByText('Pula números sem WhatsApp')).toHaveLength(1)
    // Only drafts and queued lists can be validated.
    expect(
      screen.getAllByRole('button', { name: 'Validar base' }),
    ).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: 'Validar base' }))
    const dialog = await screen.findByRole('dialog')
    await waitFor(() =>
      expect(
        (
          within(dialog).getByRole('button', {
            name: 'Validar números',
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false),
    )
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Validar números' }),
    )

    await within(dialog).findByText('Validação concluída')
    expect(fetchBody(spy, VALIDATIONS)).toMatchObject({
      scope: 'BROADCAST',
      broadcastId: 'bc_1',
    })
  })

  it('creates a list that skips numbers without WhatsApp', async () => {
    const spy = mockFetch([
      ...startRoutes(base),
      {
        method: 'POST',
        match: `${API}/broadcasts`,
        status: 201,
        data: broadcast(),
      },
      { match: `${API}/broadcasts`, data: [] },
    ])
    renderWithQuery(<WhatsappSettingsBroadcasts workspaceId='ws_1' />)

    fireEvent.click(await screen.findByRole('button', { name: 'Nova lista' }))
    const dialog = await screen.findByRole('dialog')
    expect(await within(dialog).findByText('Sem WhatsApp')).toBeTruthy()
    fireEvent.change(within(dialog).getByLabelText('Nome'), {
      target: { value: 'Lista' },
    })
    fireEvent.click(within(dialog).getByRole('combobox', { name: /Conexão/ }))
    await pickOption('Z-API')
    fireEvent.change(within(dialog).getByLabelText('Mensagem'), {
      target: { value: 'Olá' },
    })
    await waitFor(() =>
      expect(
        within(dialog)
          .getByRole('switch', { name: 'Pular números sem WhatsApp' })
          .getAttribute('aria-disabled'),
      ).not.toBe('true'),
    )
    fireEvent.click(
      within(dialog).getByRole('switch', {
        name: 'Pular números sem WhatsApp',
      }),
    )
    fireEvent.click(within(dialog).getAllByLabelText('Ana Souza')[0])
    fireEvent.click(within(dialog).getByRole('button', { name: 'Criar lista' }))

    await waitFor(() =>
      expect(notify.success).toHaveBeenCalledWith(
        'Lista de transmissão criada',
      ),
    )
    expect(fetchBody(spy, `${API}/broadcasts`)).toMatchObject({
      skipNoWhatsapp: true,
      contactIds: ['c1'],
    })
  })

  it('explains the switch is unavailable without Z-API', async () => {
    mockFetch([
      ...base,
      { match: `${API}/connections`, data: [connection('META')] },
      { match: `${API}/broadcasts`, data: [] },
    ])
    renderWithQuery(<WhatsappSettingsBroadcasts workspaceId='ws_1' />)

    fireEvent.click(await screen.findByRole('button', { name: 'Nova lista' }))
    const dialog = await screen.findByRole('dialog')
    expect(
      await within(dialog).findByText(/Disponível só com uma conexão Z-API/),
    ).toBeTruthy()
  })
})

describe('<AiCampaignNoWhatsapp />', () => {
  const campaign = {
    id: 'cp1',
    skipNoWhatsapp: false,
    stats: { total: 5 },
  } as unknown as WhatsAppAiCampaignDTO

  it('saves the switch and validates the campaign contacts', async () => {
    const spy = mockFetch([
      ...startRoutes(),
      {
        method: 'PATCH',
        match: `${API}/ai-campaigns/cp1`,
        data: { ...campaign, skipNoWhatsapp: true },
      },
      { match: `${API}/ai-campaigns`, data: [] },
    ])
    renderWithQuery(
      <AiCampaignNoWhatsapp workspaceId='ws_1' campaign={campaign} />,
    )

    const toggle = await screen.findByRole('switch', {
      name: 'Pular números sem WhatsApp',
    })
    await waitFor(() =>
      expect(toggle.getAttribute('aria-disabled')).not.toBe('true'),
    )
    fireEvent.click(toggle)
    await waitFor(() =>
      expect(fetchBody(spy, `${API}/ai-campaigns/cp1`, 'PATCH')).toEqual({
        skipNoWhatsapp: true,
      }),
    )

    fireEvent.click(screen.getByRole('button', { name: 'Validar contatos' }))
    const dialog = await screen.findByRole('dialog')
    await waitFor(() =>
      expect(
        (
          within(dialog).getByRole('button', {
            name: 'Validar números',
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false),
    )
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Validar números' }),
    )
    await within(dialog).findByText('Validação concluída')
    expect(fetchBody(spy, VALIDATIONS)).toMatchObject({
      scope: 'AI_CAMPAIGN',
      campaignId: 'cp1',
    })
  })

  it('disables the switch without a Z-API connection', async () => {
    mockFetch([{ match: `${API}/connections`, data: [connection('META')] }])
    renderWithQuery(
      <AiCampaignNoWhatsapp workspaceId='ws_1' campaign={campaign} />,
    )

    expect(
      await screen.findByText(/Disponível só com uma conexão Z-API/),
    ).toBeTruthy()
    expect(
      screen
        .getByRole('switch', { name: 'Pular números sem WhatsApp' })
        .getAttribute('aria-disabled'),
    ).toBe('true')
  })

  it('does not offer validation for an empty campaign', async () => {
    mockFetch([{ match: `${API}/connections`, data: [connection('ZAPI')] }])
    renderWithQuery(
      <AiCampaignNoWhatsapp
        workspaceId='ws_1'
        campaign={
          {
            ...campaign,
            stats: { total: 0 },
          } as unknown as WhatsAppAiCampaignDTO
        }
      />,
    )
    await screen.findByText(/quem não foi verificado/)
    expect(
      screen.queryByRole('button', { name: 'Validar contatos' }),
    ).toBeNull()
  })
})

describe('<WhatsappSettingsNumberCheck />', () => {
  const settings = { workspaceId: 'ws_1', whatsappCheckTtlDays: 30 }

  it('saves the validity in days', async () => {
    const spy = mockFetch([
      {
        method: 'PATCH',
        match: `${API}/settings`,
        data: { ...settings, whatsappCheckTtlDays: 7 },
      },
      { match: `${API}/settings`, data: settings },
    ])
    renderWithQuery(<WhatsappSettingsNumberCheck workspaceId='ws_1' />)

    const input = await screen.findByLabelText('Validade do resultado (dias)')
    await waitFor(() => expect((input as HTMLInputElement).value).toBe('30'))
    fireEvent.change(input, { target: { value: '7' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar validade' }))

    await waitFor(() =>
      expect(notify.success).toHaveBeenCalledWith('Validade da checagem salva'),
    )
    expect(fetchBody(spy, `${API}/settings`, 'PATCH')).toEqual({
      whatsappCheckTtlDays: 7,
    })
  })

  it('rejects an out-of-range value before calling the API', async () => {
    const spy = mockFetch([{ match: `${API}/settings`, data: settings }])
    renderWithQuery(<WhatsappSettingsNumberCheck workspaceId='ws_1' />)

    const input = await screen.findByLabelText('Validade do resultado (dias)')
    await waitFor(() => expect((input as HTMLInputElement).value).toBe('30'))
    const form = input.closest('form') as HTMLFormElement
    fireEvent.change(input, { target: { value: '400' } })
    fireEvent.submit(form)

    expect(notify.error).toHaveBeenCalledWith('Informe de 1 a 365 dias')
    expect(fetchBody(spy, `${API}/settings`, 'PATCH')).toBeUndefined()
  })

  it('shows the error when saving fails', async () => {
    mockFetch([
      {
        method: 'PATCH',
        match: `${API}/settings`,
        status: 500,
        error: 'falhou',
      },
      { match: `${API}/settings`, data: settings },
    ])
    renderWithQuery(<WhatsappSettingsNumberCheck workspaceId='ws_1' />)
    const input = await screen.findByLabelText('Validade do resultado (dias)')
    await waitFor(() => expect((input as HTMLInputElement).value).toBe('30'))
    fireEvent.click(screen.getByRole('button', { name: 'Salvar validade' }))
    await waitFor(() => expect(notify.error).toHaveBeenCalled())
  })

  it('renders nothing for non-admins', async () => {
    mockFetch([{ match: `${API}/settings`, data: settings }])
    const { container } = renderWithQuery(
      <WorkspacePermissionsProvider
        value={{ isPrivileged: false, permissions: null }}
      >
        <WhatsappSettingsNumberCheck workspaceId='ws_1' />
      </WorkspacePermissionsProvider>,
    )
    expect(container.textContent).toBe('')
  })
})
