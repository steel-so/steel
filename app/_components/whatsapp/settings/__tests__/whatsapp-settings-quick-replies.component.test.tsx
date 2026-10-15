import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  fetchBody,
  mockFetch,
  renderWithQuery,
} from '@/src/__tests__/component-utils'
import { WhatsappSettingsQuickReplies } from '../whatsapp-settings-quick-replies'

// Dialog/select flows render Base UI portals and wait on several fetches;
// the project default (5s) is too tight when the suite runs under load.
vi.setConfig({ testTimeout: 20_000 })

const notify = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('@/lib/notify', () => ({ notify }))

const BASE = '/api/workspaces/ws_1/whatsapp/quick-replies'

const quickReply = {
  id: 'qr_1',
  workspaceId: 'ws_1',
  shortcut: 'saudacao',
  title: 'Saudação',
  body: 'Olá {nome_cliente}, tudo bem?',
  mediaUrl: null,
  buttons: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

describe('<WhatsappSettingsQuickReplies />', () => {
  it('lists quick replies with their slash shortcut', async () => {
    mockFetch([{ match: BASE, data: [quickReply] }])
    renderWithQuery(<WhatsappSettingsQuickReplies workspaceId='ws_1' />)

    expect(await screen.findByText('/saudacao')).toBeTruthy()
    expect(screen.getByText('Saudação')).toBeTruthy()
    expect(screen.getByText('Olá {nome_cliente}, tudo bem?')).toBeTruthy()
  })

  it('shows the empty state when there are no quick replies', async () => {
    mockFetch([{ match: BASE, data: [] }])
    renderWithQuery(<WhatsappSettingsQuickReplies workspaceId='ws_1' />)

    expect(
      await screen.findByText('Nenhuma mensagem rápida cadastrada.'),
    ).toBeTruthy()
  })

  it('creates a quick reply with the typed fields', async () => {
    const fetchSpy = mockFetch([
      { match: BASE, data: [] },
      { method: 'POST', match: BASE, data: quickReply },
    ])
    renderWithQuery(<WhatsappSettingsQuickReplies workspaceId='ws_1' />)

    fireEvent.click(
      screen.getByRole('button', { name: 'Nova mensagem rápida' }),
    )
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Atalho'), {
      target: { value: 'saudacao' },
    })
    fireEvent.change(within(dialog).getByLabelText('Título'), {
      target: { value: 'Saudação' },
    })
    fireEvent.change(within(dialog).getByLabelText('Mensagem'), {
      target: { value: 'Olá!' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Salvar' }))

    await waitFor(() =>
      expect(notify.success).toHaveBeenCalledWith('Mensagem rápida criada'),
    )
    expect(fetchBody(fetchSpy, BASE)).toEqual({
      shortcut: 'saudacao',
      title: 'Saudação',
      body: 'Olá!',
    })
  })

  it('stores a shortcut typed with the slash bare and attaches a file', async () => {
    const fetchSpy = mockFetch([
      {
        method: 'POST',
        match: '/api/workspaces/ws_1/whatsapp/media/upload',
        data: { url: 'https://cdn.test/media/ws_1/tabela.pdf' },
      },
      { match: BASE, data: [] },
      { method: 'POST', match: BASE, data: quickReply },
    ])
    renderWithQuery(<WhatsappSettingsQuickReplies workspaceId='ws_1' />)

    fireEvent.click(
      screen.getByRole('button', { name: 'Nova mensagem rápida' }),
    )
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Atalho'), {
      target: { value: ' /tabela' },
    })
    expect(
      within(dialog).getByText(/Na conversa, digite \/tabela/),
    ).toBeTruthy()
    fireEvent.change(within(dialog).getByLabelText('Título'), {
      target: { value: 'Tabela' },
    })
    fireEvent.change(within(dialog).getByLabelText('Mensagem'), {
      target: { value: 'Segue a tabela.' },
    })
    fireEvent.change(within(dialog).getByLabelText('Anexo (opcional)'), {
      target: {
        files: [new File(['%PDF'], 'tabela.pdf', { type: 'application/pdf' })],
      },
    })
    // The file name shows in the attachment row and in the preview.
    expect(
      (await within(dialog).findAllByText('tabela.pdf')).length,
    ).toBeGreaterThan(0)

    // Removing and re-attaching keeps the last file.
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Remover anexo' }),
    )
    expect(within(dialog).queryByText('tabela.pdf')).toBeNull()
    fireEvent.click(
      within(dialog).getByRole('button', { name: /Anexar arquivo/ }),
    )
    fireEvent.change(within(dialog).getByLabelText('Anexo (opcional)'), {
      target: {
        files: [new File(['%PDF'], 'tabela.pdf', { type: 'application/pdf' })],
      },
    })
    await within(dialog).findAllByText('tabela.pdf')

    fireEvent.click(within(dialog).getByRole('button', { name: 'Salvar' }))
    await waitFor(() =>
      expect(notify.success).toHaveBeenCalledWith('Mensagem rápida criada'),
    )
    expect(fetchBody(fetchSpy, /quick-replies$/)).toEqual({
      shortcut: 'tabela',
      title: 'Tabela',
      body: 'Segue a tabela.',
      mediaUrl: 'https://cdn.test/media/ws_1/tabela.pdf',
    })
  })

  it('warns when the attachment upload fails', async () => {
    mockFetch([
      {
        method: 'POST',
        match: '/media/upload',
        status: 500,
        error: 'falhou',
      },
      { match: BASE, data: [] },
    ])
    renderWithQuery(<WhatsappSettingsQuickReplies workspaceId='ws_1' />)
    fireEvent.click(
      screen.getByRole('button', { name: 'Nova mensagem rápida' }),
    )
    const dialog = await screen.findByRole('dialog')
    const input = within(dialog).getByLabelText(
      'Anexo (opcional)',
    ) as HTMLInputElement
    fireEvent.change(input, { target: { files: [] } })
    expect(notify.error).not.toHaveBeenCalled()
    fireEvent.change(input, {
      target: { files: [new File(['x'], 'a.txt', { type: 'text/plain' })] },
    })
    await waitFor(() => expect(notify.error).toHaveBeenCalled())
    expect(notify.error.mock.calls[0][1]).toBe('Erro ao enviar arquivo')
  })

  it('shows legacy shortcuts saved with a slash once, and their attachment', async () => {
    mockFetch([
      {
        match: BASE,
        data: [
          {
            ...quickReply,
            shortcut: '/saudacao',
            mediaUrl: 'https://cdn.test/media/ws_1/logo.png',
            buttons: [],
          },
        ],
      },
    ])
    renderWithQuery(<WhatsappSettingsQuickReplies workspaceId='ws_1' />)
    expect(await screen.findByText('/saudacao')).toBeTruthy()
    expect(screen.getByText(/logo\.png/)).toBeTruthy()
  })

  it('reports an error toast when creation fails', async () => {
    mockFetch([
      { match: BASE, data: [] },
      { method: 'POST', match: BASE, status: 409, error: 'Atalho já existe' },
    ])
    renderWithQuery(<WhatsappSettingsQuickReplies workspaceId='ws_1' />)

    fireEvent.click(
      screen.getByRole('button', { name: 'Nova mensagem rápida' }),
    )
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Atalho'), {
      target: { value: 'saudacao' },
    })
    fireEvent.change(within(dialog).getByLabelText('Título'), {
      target: { value: 'x' },
    })
    fireEvent.change(within(dialog).getByLabelText('Mensagem'), {
      target: { value: 'y' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Salvar' }))

    await waitFor(() => expect(notify.error).toHaveBeenCalled())
    expect((notify.error.mock.calls[0][0] as Error).message).toBe(
      'Atalho já existe',
    )
    expect(notify.success).not.toHaveBeenCalled()
  })

  it('confirms before deleting a quick reply', async () => {
    const fetchSpy = mockFetch([
      { match: BASE, data: [quickReply] },
      { method: 'DELETE', match: `${BASE}/qr_1`, data: null },
    ])
    renderWithQuery(<WhatsappSettingsQuickReplies workspaceId='ws_1' />)

    fireEvent.click(await screen.findByRole('button', { name: 'Remover' }))
    const alert = await screen.findByRole('alertdialog')
    expect(
      within(alert).getByText(/"\/saudacao" não vai mais aparecer/),
    ).toBeTruthy()
    expect(
      fetchSpy.mock.calls.some(([, init]) => init?.method === 'DELETE'),
    ).toBe(false)

    fireEvent.click(within(alert).getByRole('button', { name: 'Remover' }))
    await waitFor(() =>
      expect(notify.success).toHaveBeenCalledWith('Mensagem removida'),
    )
    expect(
      fetchSpy.mock.calls.some(
        ([url, init]) =>
          init?.method === 'DELETE' && String(url).endsWith('/qr_1'),
      ),
    ).toBe(true)
  })
})

describe('<WhatsappSettingsQuickReplies /> buttons', () => {
  const withButtons = {
    ...quickReply,
    buttons: [
      {
        id: 'b1',
        type: 'REPLY',
        label: 'Sim',
        actions: [{ kind: 'SET_STATUS', status: 'CLOSED' }],
      },
    ],
  }

  async function openEdit(routes: Parameters<typeof mockFetch>[0] = []) {
    notify.success.mockClear()
    notify.error.mockClear()
    const fetchSpy = mockFetch([
      ...routes,
      { match: BASE, data: [withButtons] },
      { method: 'PATCH', match: `${BASE}/qr_1`, data: withButtons },
    ])
    renderWithQuery(<WhatsappSettingsQuickReplies workspaceId='ws_1' />)
    fireEvent.click(
      await screen.findByRole('button', { name: 'Editar /saudacao' }),
    )
    const dialog = await screen.findByRole('dialog')
    return { fetchSpy, dialog }
  }

  it('lists the buttons of each quick reply', async () => {
    mockFetch([{ match: BASE, data: [withButtons] }])
    renderWithQuery(<WhatsappSettingsQuickReplies workspaceId='ws_1' />)
    expect(await screen.findByText('Sim')).toBeTruthy()
  })

  it('edits a quick reply, previews it and warns about provider limits', async () => {
    const { dialog, fetchSpy } = await openEdit()

    expect(within(dialog).getByText('Editar mensagem rápida')).toBeTruthy()
    expect(
      (within(dialog).getByLabelText('Título') as HTMLInputElement).value,
    ).toBe('Saudação')
    // Preview renders the variables with sample values.
    expect(within(dialog).getByText('Olá Maria, tudo bem?')).toBeTruthy()
    expect(within(dialog).getByText(/Z-API os botões dependem/)).toBeTruthy()
    expect(within(dialog).queryByText(/não dá para misturar/)).toBeNull()

    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Adicionar botão' }),
    )
    fireEvent.click(await screen.findByRole('menuitem', { name: /Link/ }))
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
    expect(within(dialog).getByText(/não dá para misturar/)).toBeTruthy()

    fireEvent.change(within(dialog).getByLabelText('Texto do botão 2'), {
      target: { value: 'Site' },
    })
    fireEvent.change(within(dialog).getByLabelText('Link do botão 2'), {
      target: { value: 'ftp://x.test' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Salvar' }))
    expect(notify.error).toHaveBeenCalledWith(
      'Botão 2: informe um link válido (https://…)',
    )

    fireEvent.change(within(dialog).getByLabelText('Link do botão 2'), {
      target: { value: 'https://x.test' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Salvar' }))
    await waitFor(() =>
      expect(notify.success).toHaveBeenCalledWith('Mensagem rápida atualizada'),
    )
    expect(fetchBody(fetchSpy, `${BASE}/qr_1`, 'PATCH')).toEqual({
      shortcut: 'saudacao',
      title: 'Saudação',
      body: 'Olá {nome_cliente}, tudo bem?',
      buttons: [
        withButtons.buttons[0],
        { id: 'b2', type: 'URL', label: 'Site', url: 'https://x.test' },
      ],
    })
  })

  it('removes every button with null and reports a failed save', async () => {
    const { dialog, fetchSpy } = await openEdit([
      { method: 'PATCH', match: `${BASE}/qr_1`, status: 500, error: 'x' },
    ])
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Remover botão 1' }),
    )
    fireEvent.click(within(dialog).getByRole('button', { name: 'Salvar' }))
    await waitFor(() =>
      expect(notify.error).toHaveBeenCalledWith(
        expect.anything(),
        'Não foi possível salvar',
      ),
    )
    expect(fetchBody(fetchSpy, `${BASE}/qr_1`, 'PATCH')).toMatchObject({
      buttons: null,
    })

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('creates a quick reply with buttons', async () => {
    notify.success.mockClear()
    const fetchSpy = mockFetch([
      { match: BASE, data: [] },
      { method: 'POST', match: BASE, data: quickReply },
    ])
    renderWithQuery(<WhatsappSettingsQuickReplies workspaceId='ws_1' />)
    fireEvent.click(
      screen.getByRole('button', { name: 'Nova mensagem rápida' }),
    )
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Atalho'), {
      target: { value: 'nps' },
    })
    fireEvent.change(within(dialog).getByLabelText('Título'), {
      target: { value: 'NPS' },
    })
    fireEvent.change(within(dialog).getByLabelText('Mensagem'), {
      target: { value: 'Gostou?' },
    })
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Adicionar botão' }),
    )
    fireEvent.click(await screen.findByRole('menuitem', { name: /Resposta/ }))
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
    fireEvent.change(within(dialog).getByLabelText('Texto do botão 1'), {
      target: { value: 'Sim' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Salvar' }))
    await waitFor(() =>
      expect(notify.success).toHaveBeenCalledWith('Mensagem rápida criada'),
    )
    expect(fetchBody(fetchSpy, BASE)).toEqual({
      shortcut: 'nps',
      title: 'NPS',
      body: 'Gostou?',
      buttons: [{ id: 'b1', type: 'REPLY', label: 'Sim', actions: [] }],
    })
  })
})
