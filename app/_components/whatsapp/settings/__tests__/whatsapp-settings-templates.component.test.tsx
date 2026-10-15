import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  fetchBody,
  mockFetch,
  renderWithQuery,
} from '@/src/__tests__/component-utils'
import { WhatsappSettingsTemplates } from '../whatsapp-settings-templates'

// Dialog/select flows render Base UI portals and wait on several fetches;
// the project default (5s) is too tight when the suite runs under load.
vi.setConfig({ testTimeout: 20_000 })

const notify = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('@/lib/notify', () => ({ notify }))

const API = '/api/workspaces/ws_1/whatsapp'

function connection(id: string, provider: 'META' | 'ZAPI', label: string) {
  return {
    id,
    workspaceId: 'ws_1',
    provider,
    label,
    phoneNumber: '5511999999999',
    status: 'CONNECTED',
    statusError: null,
    zapiInstanceId: null,
    metaPhoneNumberId: null,
    metaWabaId: null,
    createdById: 'u_1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

const template = {
  id: 'tpl_1',
  workspaceId: 'ws_1',
  connectionId: 'meta_1',
  name: 'confirmacao_exame',
  language: 'pt_BR',
  category: 'UTILITY',
  status: 'APPROVED',
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

const connections = [
  connection('meta_1', 'META', 'Meta Oficial'),
  connection('zapi_1', 'ZAPI', 'Z-API Suporte'),
]

describe('<WhatsappSettingsTemplates />', () => {
  it('lists synced templates with language, category and status', async () => {
    mockFetch([
      { match: `${API}/connections`, data: connections },
      { match: `${API}/templates`, data: [template] },
    ])
    renderWithQuery(<WhatsappSettingsTemplates workspaceId='ws_1' />)

    expect(await screen.findByText('confirmacao_exame')).toBeTruthy()
    expect(screen.getByText('pt_BR')).toBeTruthy()
    expect(screen.getByText('Utilidade')).toBeTruthy()
    expect(screen.getByText('Aprovado')).toBeTruthy()
    expect(
      screen.getByRole('img', { name: 'Qualidade ainda não avaliada' }),
    ).toBeTruthy()
  })

  it('shows the empty state when nothing was synced', async () => {
    mockFetch([
      { match: `${API}/connections`, data: connections },
      { match: `${API}/templates`, data: [] },
    ])
    renderWithQuery(<WhatsappSettingsTemplates workspaceId='ws_1' />)

    expect(
      await screen.findByText('Nenhum template sincronizado ainda.'),
    ).toBeTruthy()
  })

  it('only offers Meta connections and syncs the selected one', async () => {
    const fetchSpy = mockFetch([
      { match: `${API}/connections`, data: connections },
      { method: 'POST', match: `${API}/templates/sync`, data: [template] },
      { match: `${API}/templates`, data: [] },
    ])
    renderWithQuery(<WhatsappSettingsTemplates workspaceId='ws_1' />)

    const sync = screen.getByRole('button', { name: 'Sincronizar agora' })
    // No connection chosen yet → sync is disabled.
    expect((sync as HTMLButtonElement).disabled).toBe(true)

    await waitFor(() =>
      expect(
        fetchSpy.mock.calls.some(([u]) => String(u).includes('/connections')),
      ).toBe(true),
    )
    fireEvent.click(screen.getAllByRole('combobox')[0])
    const listbox = await screen.findByRole('listbox')
    expect(within(listbox).queryByText('Z-API Suporte')).toBeNull()
    const option = within(listbox).getByRole('option', { name: 'Meta Oficial' })
    fireEvent.pointerDown(option)
    fireEvent.click(option)

    await waitFor(() =>
      expect((sync as HTMLButtonElement).disabled).toBe(false),
    )
    fireEvent.click(sync)

    await waitFor(() =>
      expect(notify.success).toHaveBeenCalledWith('Templates sincronizados'),
    )
    expect(fetchBody(fetchSpy, `${API}/templates/sync`)).toEqual({
      connectionId: 'meta_1',
    })
  })
})

describe('<CreateTemplateDialog /> (via templates settings)', () => {
  async function openDialog() {
    const fetchSpy = mockFetch([
      { match: `${API}/connections`, data: connections },
      { method: 'POST', match: `${API}/templates`, data: template },
      { match: `${API}/templates`, data: [] },
    ])
    renderWithQuery(<WhatsappSettingsTemplates workspaceId='ws_1' />)
    await screen.findByText('Nenhum template sincronizado ainda.')
    fireEvent.click(screen.getByRole('button', { name: /Novo template/ }))
    const dialog = await screen.findByRole('dialog')
    return { fetchSpy, dialog }
  }

  async function selectConnection(dialog: HTMLElement) {
    fireEvent.click(within(dialog).getAllByRole('combobox')[0])
    const listbox = await screen.findByRole('listbox')
    const option = within(listbox).getByRole('option', { name: 'Meta Oficial' })
    fireEvent.pointerDown(option)
    fireEvent.click(option)
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull())
  }

  it('requires a Meta connection before anything else', async () => {
    const { dialog, fetchSpy } = await openDialog()
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Enviar para aprovação' }),
    )
    expect(notify.error).toHaveBeenCalledWith('Selecione a conexão Meta.')
    expect(fetchBody(fetchSpy, `${API}/templates`)).toBeUndefined()
  })

  it('requires name and body', async () => {
    const { dialog } = await openDialog()
    await selectConnection(dialog)
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Enviar para aprovação' }),
    )
    expect(notify.error).toHaveBeenCalledWith(
      'Informe o nome e o corpo da mensagem.',
    )
  })

  it('normalizes the name to snake_case and demands one example per variable', async () => {
    const { dialog, fetchSpy } = await openDialog()
    await selectConnection(dialog)

    const name = within(dialog).getByPlaceholderText(
      'confirmacao_exame',
    ) as HTMLInputElement
    fireEvent.change(name, { target: { value: 'Confirmacao Exame' } })
    expect(name.value).toBe('confirmacao_exame')

    fireEvent.change(within(dialog).getByPlaceholderText(/Olá \{\{1\}\}/), {
      target: { value: 'Olá {{1}}, seu exame de {{2}} está confirmado.' },
    })
    // One example input per body placeholder.
    expect(within(dialog).getByText('Exemplo de {{1}}')).toBeTruthy()
    expect(within(dialog).getByText('Exemplo de {{2}}')).toBeTruthy()

    fireEvent.change(within(dialog).getByPlaceholderText('Maria'), {
      target: { value: 'Maria' },
    })
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Enviar para aprovação' }),
    )
    expect(notify.error).toHaveBeenCalledWith(
      'Preencha um valor de exemplo para cada variável do corpo.',
    )

    fireEvent.change(
      within(dialog).getByPlaceholderText('Hemograma completo'),
      {
        target: { value: 'Hemograma' },
      },
    )
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Enviar para aprovação' }),
    )

    await waitFor(() =>
      expect(notify.success).toHaveBeenCalledWith(
        'Template enviado para aprovação da Meta',
      ),
    )
    expect(fetchBody(fetchSpy, `${API}/templates`)).toEqual({
      connectionId: 'meta_1',
      name: 'confirmacao_exame',
      language: 'pt_BR',
      category: 'UTILITY',
      body: 'Olá {{1}}, seu exame de {{2}} está confirmado.',
      bodyExample: ['Maria', 'Hemograma'],
    })
  })

  it('caps buttons at two through the shared editor', async () => {
    const { dialog } = await openDialog()
    const add = async (kind: RegExp) => {
      fireEvent.click(
        within(dialog).getByRole('button', { name: 'Adicionar botão' }),
      )
      fireEvent.click(await screen.findByRole('menuitem', { name: kind }))
      await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
    }
    await add(/Resposta/)
    await add(/Link/)
    expect(
      within(dialog).queryByRole('button', { name: 'Adicionar botão' }),
    ).toBeNull()
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Remover botão 1' }),
    )
    expect(
      within(dialog).getByRole('button', { name: 'Adicionar botão' }),
    ).toBeTruthy()
  })
})
