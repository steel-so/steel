import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  type FetchRoute,
  fetchBody,
  mockFetch,
  renderWithQuery,
} from '@/src/__tests__/component-utils'
import {
  buildImportModelCsv,
  WhatsappSettingsBroadcasts,
} from '../whatsapp-settings-broadcasts'

// Dialog/select flows render Base UI portals and wait on several fetches;
// the project default (5s) is too tight when the suite runs under load.
vi.setConfig({ testTimeout: 20_000 })

const notify = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('@/lib/notify', () => ({ notify }))

const API = '/api/workspaces/ws_1/whatsapp'

function broadcast(overrides: Record<string, unknown> = {}) {
  return {
    id: 'bc_1',
    workspaceId: 'ws_1',
    connectionId: 'conn_1',
    name: 'Promo de setembro',
    messageBody: 'Oi!',
    mediaUrl: null,
    status: 'DRAFT',
    scheduledAt: null,
    createdById: 'u_1',
    recipientCount: 10,
    sentCount: 0,
    failedCount: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

const connections = [
  {
    id: 'conn_1',
    workspaceId: 'ws_1',
    provider: 'META',
    label: 'Vendas',
    phoneNumber: '5511999999999',
    status: 'CONNECTED',
    statusError: null,
    zapiInstanceId: null,
    metaPhoneNumberId: null,
    metaWabaId: null,
    createdById: 'u_1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
]

function contact(id: string, name: string | null, waId: string) {
  return {
    id,
    workspaceId: 'ws_1',
    waId,
    username: null,
    hasPhone: true,
    name,
    avatarUrl: null,
    description: null,
    conversationCount: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

function template(id: string, name: string, status: string) {
  return {
    id,
    workspaceId: 'ws_1',
    connectionId: 'conn_1',
    name,
    language: 'pt_BR',
    category: 'UTILITY',
    status,
    components: [],
    quality: 'UNKNOWN',
    qualityUpdatedAt: null,
    statusReason: null,
    headerFormat: null,
    headerMediaUrl: null,
    buttons: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

function setup(extra: FetchRoute[] = [], broadcasts = [broadcast()]) {
  return mockFetch([
    ...extra,
    { match: `${API}/connections`, data: connections },
    {
      match: `${API}/contacts`,
      data: [
        contact('c1', 'Ana', '5511911111111'),
        contact('c2', null, '5511922222222'),
      ],
    },
    {
      match: `${API}/templates`,
      data: [
        template('t1', 'lembrete_consulta', 'APPROVED'),
        template('t2', 'rascunho_pendente', 'PENDING'),
      ],
    },
    { match: `${API}/broadcasts`, data: broadcasts },
  ])
}

// The import form is submitted directly: jsdom cannot attach a real file to
// the `required` file input, so native validation would block a click.
function submitForm(dialog: HTMLElement) {
  const form = within(dialog)
    .getByRole('button', { name: 'Conferir planilha' })
    .closest('form')
  if (!form) throw new Error('import form not found')
  fireEvent.submit(form)
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

describe('<WhatsappSettingsBroadcasts /> list', () => {
  it('shows translated status and progress with failures', async () => {
    setup(
      [],
      [
        broadcast(),
        broadcast({
          id: 'bc_2',
          name: 'Aviso',
          status: 'RUNNING',
          sentCount: 4,
          failedCount: 2,
        }),
      ],
    )
    renderWithQuery(<WhatsappSettingsBroadcasts workspaceId='ws_1' />)

    expect(await screen.findByText('Promo de setembro')).toBeTruthy()
    expect(screen.getByText('Rascunho')).toBeTruthy()
    expect(screen.getByText('Enviando')).toBeTruthy()
    expect(screen.getByText('4/10 enviados · 2 falhas')).toBeTruthy()
    // Only drafts can be started.
    expect(screen.getAllByRole('button', { name: 'Iniciar' })).toHaveLength(1)
  })

  it('shows the empty state', async () => {
    setup([], [])
    renderWithQuery(<WhatsappSettingsBroadcasts workspaceId='ws_1' />)
    expect(
      await screen.findByText('Nenhuma lista de transmissão criada ainda.'),
    ).toBeTruthy()
  })

  it('starts a draft broadcast', async () => {
    const fetchSpy = setup([
      { method: 'POST', match: `${API}/broadcasts/bc_1/start`, data: null },
    ])
    renderWithQuery(<WhatsappSettingsBroadcasts workspaceId='ws_1' />)

    fireEvent.click(await screen.findByRole('button', { name: 'Iniciar' }))
    const alert = await screen.findByRole('alertdialog')
    expect(within(alert).getByText(/vai para 10 contato\(s\)/)).toBeTruthy()
    expect(within(alert).getByText(/Custo estimado: até/)).toBeTruthy()
    fireEvent.click(
      within(alert).getByRole('button', { name: 'Iniciar envio' }),
    )
    await waitFor(() =>
      expect(notify.success).toHaveBeenCalledWith('Envio iniciado'),
    )
    expect(
      fetchSpy.mock.calls.some(
        ([url, init]) =>
          init?.method === 'POST' && String(url).endsWith('/bc_1/start'),
      ),
    ).toBe(true)
  })
})

describe('<WhatsappSettingsBroadcasts /> list actions', () => {
  it('shows the failure reason and lets admins re-send the failed ones', async () => {
    const fetchSpy = setup(
      [
        {
          method: 'POST',
          match: `${API}/broadcasts/bc_2/retry-failed`,
          data: null,
        },
      ],
      [
        broadcast({
          id: 'bc_2',
          name: 'Aviso',
          status: 'DONE',
          sentCount: 4,
          failedCount: 2,
          failureReason: 'Limite de gasto atingido',
        }),
      ],
    )
    renderWithQuery(<WhatsappSettingsBroadcasts workspaceId='ws_1' />)

    expect(
      await screen.findByText('Motivo: Limite de gasto atingido'),
    ).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Ver falhas' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Reenviar falhos' }))
    const alert = await screen.findByRole('alertdialog')
    fireEvent.click(within(alert).getByRole('button', { name: 'Reenviar' }))
    await waitFor(() =>
      expect(notify.success).toHaveBeenCalledWith('Reenvio iniciado'),
    )
    expect(
      fetchSpy.mock.calls.some(
        ([url, init]) =>
          init?.method === 'POST' && String(url).endsWith('/bc_2/retry-failed'),
      ),
    ).toBe(true)
  })

  it('lists the failed recipients with their reason', async () => {
    setup(
      [
        {
          match: `${API}/broadcasts/bc_2`,
          data: {
            ...broadcast({ id: 'bc_2', status: 'DONE', failedCount: 1 }),
            recipients: [
              {
                id: 'r1',
                contactId: 'c1',
                contactName: 'Ana',
                contactWaId: '5511911111111',
                contactHasWhatsapp: null,
                status: 'FAILED',
                errorMessage: 'A janela de 24 horas expirou.',
                sentAt: null,
              },
              {
                id: 'r2',
                contactId: 'c2',
                contactName: 'Beto',
                contactWaId: '5511922222222',
                contactHasWhatsapp: null,
                status: 'SENT',
                errorMessage: null,
                sentAt: '2026-01-01T00:00:00.000Z',
              },
            ],
          },
        },
      ],
      [broadcast({ id: 'bc_2', status: 'DONE', failedCount: 1 })],
    )
    renderWithQuery(<WhatsappSettingsBroadcasts workspaceId='ws_1' />)

    fireEvent.click(await screen.findByRole('button', { name: 'Ver falhas' }))
    const dialog = await screen.findByRole('dialog')
    expect(
      await within(dialog).findByText('A janela de 24 horas expirou.'),
    ).toBeTruthy()
    expect(within(dialog).queryByText('Beto')).toBeNull()
  })

  it('confirms before cancelling a running send', async () => {
    const fetchSpy = setup(
      [{ method: 'POST', match: `${API}/broadcasts/bc_3/cancel`, data: null }],
      [broadcast({ id: 'bc_3', name: 'Em curso', status: 'RUNNING' })],
    )
    renderWithQuery(<WhatsappSettingsBroadcasts workspaceId='ws_1' />)

    fireEvent.click(
      await screen.findByRole('button', { name: 'Cancelar envio' }),
    )
    const alert = await screen.findByRole('alertdialog')
    fireEvent.click(
      within(alert).getByRole('button', { name: 'Cancelar envio' }),
    )
    await waitFor(() =>
      expect(notify.success).toHaveBeenCalledWith('Envio cancelado'),
    )
    expect(
      fetchSpy.mock.calls.some(
        ([url, init]) =>
          init?.method === 'POST' && String(url).endsWith('/bc_3/cancel'),
      ),
    ).toBe(true)
  })
})

describe('<WhatsappSettingsBroadcasts /> create dialog', () => {
  async function openCreate() {
    renderWithQuery(<WhatsappSettingsBroadcasts workspaceId='ws_1' />)
    await screen.findByText('Promo de setembro')
    fireEvent.click(screen.getByRole('button', { name: 'Nova lista' }))
    return screen.findByRole('dialog')
  }

  it('requires a connection and at least one contact', async () => {
    const fetchSpy = setup()
    const dialog = await openCreate()
    fireEvent.change(within(dialog).getByLabelText('Nome'), {
      target: { value: 'Black Friday' },
    })
    fireEvent.change(within(dialog).getByLabelText('Mensagem'), {
      target: { value: 'Descontos!' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Criar lista' }))

    expect(notify.error).toHaveBeenCalledWith(
      'Selecione a conexão e ao menos um contato',
    )
    expect(fetchBody(fetchSpy, `${API}/broadcasts`)).toBeUndefined()
  })

  it('counts selected contacts and creates the list', async () => {
    const fetchSpy = setup([
      { method: 'POST', match: `${API}/broadcasts`, data: broadcast() },
    ])
    const dialog = await openCreate()

    fireEvent.change(within(dialog).getByLabelText('Nome'), {
      target: { value: 'Black Friday' },
    })
    fireEvent.change(within(dialog).getByLabelText('Mensagem'), {
      target: { value: 'Descontos!' },
    })
    fireEvent.click(within(dialog).getByRole('combobox'))
    await pickOption('Vendas')

    // Contacts without a name fall back to their WhatsApp id.
    expect(await within(dialog).findByText('5511922222222')).toBeTruthy()
    const [ana, other] = within(dialog).getAllByRole('checkbox')
    fireEvent.click(ana)
    fireEvent.click(other)
    expect(within(dialog).getByText('Contatos (2 selecionados)')).toBeTruthy()
    fireEvent.click(other)
    expect(within(dialog).getByText('Contatos (1 selecionados)')).toBeTruthy()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Criar lista' }))

    await waitFor(() =>
      expect(notify.success).toHaveBeenCalledWith(
        'Lista de transmissão criada',
      ),
    )
    expect(fetchBody(fetchSpy, `${API}/broadcasts`)).toEqual({
      name: 'Black Friday',
      connectionId: 'conn_1',
      messageBody: 'Descontos!',
      contactIds: ['c1'],
    })
  })
})

describe('<WhatsappSettingsBroadcasts /> contact picker', () => {
  it('warns about the 24h window on Meta numbers and selects all visible contacts', async () => {
    setup()
    renderWithQuery(<WhatsappSettingsBroadcasts workspaceId='ws_1' />)
    await screen.findByText('Promo de setembro')
    fireEvent.click(screen.getByRole('button', { name: 'Nova lista' }))
    const dialog = await screen.findByRole('dialog')

    fireEvent.click(within(dialog).getByRole('combobox'))
    await pickOption('Vendas')
    expect(
      within(dialog).getByText(/texto livre só chega a quem falou com você/),
    ).toBeTruthy()

    expect(await within(dialog).findByText('Ana')).toBeTruthy()
    fireEvent.change(within(dialog).getByLabelText('Buscar contato'), {
      target: { value: 'ana' },
    })
    expect(within(dialog).queryByText('5511922222222')).toBeNull()
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Selecionar todos' }),
    )
    expect(within(dialog).getByText('Contatos (1 selecionados)')).toBeTruthy()
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Limpar seleção' }),
    )
    expect(within(dialog).getByText('Contatos (0 selecionados)')).toBeTruthy()
  })
})

describe('<WhatsappSettingsBroadcasts /> media', () => {
  function stubObjectUrl() {
    vi.stubGlobal(
      'URL',
      Object.assign(URL, {
        createObjectURL: vi.fn(() => 'blob:preview'),
        revokeObjectURL: vi.fn(),
      }),
    )
  }

  async function openCreateDialog() {
    renderWithQuery(<WhatsappSettingsBroadcasts workspaceId='ws_1' />)
    await screen.findByText('Promo de setembro')
    fireEvent.click(screen.getByRole('button', { name: 'Nova lista' }))
    return screen.findByRole('dialog')
  }

  it('previews a video and sends its type and name with the broadcast', async () => {
    stubObjectUrl()
    const fetchSpy = setup([
      {
        method: 'POST',
        match: `${API}/media/upload`,
        data: { url: 'https://cdn/media/ws_1/abc.mp4' },
      },
      { method: 'POST', match: `${API}/broadcasts`, data: broadcast() },
    ])
    const dialog = await openCreateDialog()

    const video = new File(['v'], 'promo.mp4', { type: 'video/mp4' })
    fireEvent.change(within(dialog).getByLabelText('Mídia (opcional)'), {
      target: { files: [video] },
    })
    expect(within(dialog).getByLabelText('promo.mp4').tagName).toBe('VIDEO')
    expect(
      within(dialog).getByRole('button', { name: 'Remover vídeo' }),
    ).toBeTruthy()

    fireEvent.change(within(dialog).getByLabelText('Nome'), {
      target: { value: 'Lançamento' },
    })
    fireEvent.change(within(dialog).getByLabelText('Mensagem'), {
      target: { value: 'Assista!' },
    })
    fireEvent.click(within(dialog).getByRole('combobox'))
    await pickOption('Vendas')
    const [ana] = await within(dialog).findAllByRole('checkbox')
    fireEvent.click(ana)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Criar lista' }))

    await waitFor(() =>
      expect(fetchBody(fetchSpy, `${API}/broadcasts`)).toEqual(
        expect.objectContaining({
          mediaUrl: 'https://cdn/media/ws_1/abc.mp4',
          mediaMimeType: 'video/mp4',
          mediaFileName: 'promo.mp4',
          mediaSizeBytes: 1,
        }),
      ),
    )
  })

  it('rejects unsupported files with a pt-BR message', async () => {
    stubObjectUrl()
    setup()
    const dialog = await openCreateDialog()

    const zip = new File(['z'], 'arquivos.zip', { type: 'application/zip' })
    fireEvent.change(within(dialog).getByLabelText('Mídia (opcional)'), {
      target: { files: [zip] },
    })

    expect(notify.error).toHaveBeenCalledWith(
      expect.stringMatching(/Tipo de arquivo não suportado/),
    )
    expect(within(dialog).queryByRole('button', { name: /Remover/ })).toBeNull()
  })

  it('shows the media type badge in the list', async () => {
    setup(
      [],
      [broadcast({ mediaType: 'DOCUMENT', mediaUrl: 'https://x/a.pdf' })],
    )
    renderWithQuery(<WhatsappSettingsBroadcasts workspaceId='ws_1' />)
    expect(await screen.findByText('Documento')).toBeTruthy()
  })
})

describe('<WhatsappSettingsBroadcasts /> CSV import', () => {
  async function openImport() {
    renderWithQuery(<WhatsappSettingsBroadcasts workspaceId='ws_1' />)
    await screen.findByText('Promo de setembro')
    fireEvent.click(screen.getByRole('button', { name: 'Importar planilha' }))
    return screen.findByRole('dialog')
  }

  it('only lists approved templates', async () => {
    setup()
    const dialog = await openImport()
    const [, templateTrigger] = within(dialog).getAllByRole('combobox')
    await waitFor(() => expect(templateTrigger).toBeTruthy())
    fireEvent.click(templateTrigger)
    const listbox = await screen.findByRole('listbox')
    expect(within(listbox).getByText('lembrete_consulta')).toBeTruthy()
    expect(within(listbox).queryByText('rascunho_pendente')).toBeNull()
  })

  it('tells that a Flow template opens a prefilled form', async () => {
    setup([
      {
        match: `${API}/templates`,
        data: [
          template('t1', 'lembrete_consulta', 'APPROVED'),
          {
            ...template('t3', 'form_cadastro', 'APPROVED'),
            components: [
              {
                type: 'BUTTONS',
                buttons: [{ type: 'FLOW', text: 'Abrir', flow_id: 'f1' }],
              },
            ],
          },
        ],
      },
    ])
    const dialog = await openImport()
    const [, templateTrigger] = within(dialog).getAllByRole('combobox')

    fireEvent.click(templateTrigger)
    await pickOption(/lembrete_consulta/)
    expect(
      within(dialog).queryByText(/Este template abre um formulário/),
    ).toBeNull()

    fireEvent.click(templateTrigger)
    await pickOption(/form_cadastro/)
    expect(
      await within(dialog).findByText(/Este template abre um formulário/),
    ).toBeTruthy()
  })

  it('requires connection, template and file', async () => {
    setup()
    const dialog = await openImport()
    fireEvent.change(within(dialog).getByLabelText('Nome'), {
      target: { value: 'Lembretes' },
    })
    submitForm(dialog)
    await waitFor(() =>
      expect(notify.error).toHaveBeenCalledWith(
        'Selecione a conexão, o template e o arquivo CSV',
      ),
    )
  })

  it('previews the spreadsheet, then schedules after confirmation', async () => {
    const fetchSpy = mockFetch([
      {
        method: 'POST',
        match: `${API}/broadcasts/import`,
        data: {
          broadcastList: null,
          createdCount: 3,
          rejectedRows: [{ rowNumber: 4, reason: 'telefone inválido' }],
        },
      },
      { match: `${API}/connections`, data: connections },
      { match: `${API}/contacts`, data: [] },
      {
        match: `${API}/templates`,
        data: [template('t1', 'lembrete_consulta', 'APPROVED')],
      },
      { match: `${API}/broadcasts`, data: [broadcast()] },
    ])
    // The first call of the dialog is the dry run; the second one confirms.
    const importCalls = () =>
      fetchSpy.mock.calls
        .filter(([url]) => String(url).endsWith('/broadcasts/import'))
        .map(([, init]) => JSON.parse(String(init?.body)))
    const dialog = await openImport()

    fireEvent.change(within(dialog).getByLabelText('Nome'), {
      target: { value: 'Lembretes' },
    })
    const [connectionTrigger, templateTrigger] =
      within(dialog).getAllByRole('combobox')
    fireEvent.click(connectionTrigger)
    await pickOption('Vendas')
    fireEvent.click(templateTrigger)
    await pickOption(/lembrete_consulta/)
    fireEvent.change(
      within(dialog).getByLabelText(
        'Enviar quantas horas antes da data de referência',
      ),
      { target: { value: '48' } },
    )
    const csv = 'telefone,data_referencia,var_1\n5511,15/12/2099 09:30,Ana'
    fireEvent.change(within(dialog).getByLabelText('Arquivo CSV'), {
      target: { files: [new File([csv], 'lista.csv', { type: 'text/csv' })] },
    })
    submitForm(dialog)

    await waitFor(() => expect(importCalls()).toHaveLength(1))
    expect(importCalls()[0]).toEqual({
      name: 'Lembretes',
      connectionId: 'conn_1',
      templateId: 't1',
      sendOffsetHours: 48,
      csv,
      dryRun: true,
    })
  })

  it('offers the spreadsheet model and explains the date format', async () => {
    setup()
    const dialog = await openImport()
    expect(
      within(dialog).getByRole('button', { name: 'Baixar planilha modelo' }),
    ).toBeTruthy()
    expect(within(dialog).getByText('15/12/2026 09:30')).toBeTruthy()
  })
})

describe('buildImportModelCsv()', () => {
  it('has one var column per template variable and an example row', () => {
    expect(buildImportModelCsv(2).split('\n')).toEqual([
      'telefone,nome,data_referencia,var_1,var_2',
      '11999998888,Maria,15/12/2099 09:30,Exemplo 1,Exemplo 2',
      '',
    ])
  })
})
