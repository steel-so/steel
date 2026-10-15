import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  fetchBody,
  mockFetch,
  renderWithQuery,
} from '@/src/__tests__/component-utils'
import { CreateTemplateDialog } from '../create-template-dialog'

vi.setConfig({ testTimeout: 20_000 })

const notify = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('@/lib/notify', () => ({ notify }))

const API = '/api/workspaces/ws_1/whatsapp'
const MEDIA_URL = 'https://cdn.test/media/ws_1/banner.png'

const connection = {
  id: 'meta_1',
  workspaceId: 'ws_1',
  provider: 'META',
  label: 'Meta Oficial',
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

async function open(extra: Parameters<typeof mockFetch>[0] = []) {
  notify.error.mockClear()
  notify.success.mockClear()
  const fetchSpy = mockFetch([
    ...extra,
    { match: `${API}/connections`, data: [connection] },
    { method: 'POST', match: `${API}/media/upload`, data: { url: MEDIA_URL } },
    { method: 'POST', match: `${API}/templates`, data: { id: 'tpl_1' } },
  ])
  renderWithQuery(<CreateTemplateDialog workspaceId='ws_1' />)
  fireEvent.click(screen.getByRole('button', { name: /Novo template/ }))
  const dialog = await screen.findByRole('dialog')

  fireEvent.click(within(dialog).getByLabelText('Conexão Meta'))
  const option = within(await screen.findByRole('listbox')).getByRole(
    'option',
    { name: 'Meta Oficial' },
  )
  fireEvent.pointerDown(option)
  fireEvent.click(option)
  await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull())
  expect(within(dialog).getByLabelText('Conexão Meta').textContent).toContain(
    'Meta Oficial',
  )

  fireEvent.change(within(dialog).getByLabelText('Nome (snake_case)'), {
    target: { value: 'promo' },
  })
  fireEvent.change(within(dialog).getByLabelText('Corpo da mensagem'), {
    target: { value: 'Olá {{1}}, temos novidades.' },
  })
  fireEvent.change(within(dialog).getByPlaceholderText('Maria'), {
    target: { value: 'Ana' },
  })
  return { fetchSpy, dialog }
}

const submit = (dialog: HTMLElement) =>
  fireEvent.click(
    within(dialog).getByRole('button', { name: 'Enviar para aprovação' }),
  )

const preview = () =>
  document.querySelector('[data-slot="whatsapp-preview"]') as HTMLElement

function chooseFile(dialog: HTMLElement, file: File) {
  fireEvent.change(within(dialog).getByLabelText('Arquivo do cabeçalho'), {
    target: { files: [file] },
  })
}

describe('<CreateTemplateDialog />', () => {
  it('previews the body with the examples filled in', async () => {
    const { dialog } = await open()
    expect(
      within(preview()).getByText('Olá Ana, temos novidades.'),
    ).toBeTruthy()
    fireEvent.change(within(dialog).getByLabelText('Rodapé (opcional)'), {
      target: { value: 'Stratus' },
    })
    expect(within(preview()).getByText('Stratus')).toBeTruthy()
  })

  it('sends a text header and requires its text', async () => {
    const { dialog, fetchSpy } = await open()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Texto' }))
    submit(dialog)
    expect(notify.error).toHaveBeenCalledWith(
      'Escreva o texto do cabeçalho ou escolha "Nenhum".',
    )
    fireEvent.change(within(dialog).getByLabelText('Texto do cabeçalho'), {
      target: { value: 'Promoção' },
    })
    expect(within(preview()).getByText('Promoção')).toBeTruthy()
    submit(dialog)
    await waitFor(() =>
      expect(notify.success).toHaveBeenCalledWith(
        'Template enviado para aprovação da Meta',
      ),
    )
    expect(fetchBody(fetchSpy, /\/templates$/)).toMatchObject({
      headerFormat: 'TEXT',
      headerText: 'Promoção',
    })
  })

  it('uploads an image header and shows it in the preview', async () => {
    const { dialog, fetchSpy } = await open()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Imagem' }))
    expect(
      within(dialog).getByRole('button', { name: 'Imagem' }).ariaPressed,
    ).toBe('true')
    // Placeholder until the sample is uploaded.
    expect(within(preview()).getByText('Imagem')).toBeTruthy()

    submit(dialog)
    expect(notify.error).toHaveBeenCalledWith(
      'Envie o arquivo de exemplo do cabeçalho.',
    )

    chooseFile(dialog, new File(['x'], 'banner.gif', { type: 'image/gif' }))
    expect(notify.error).toHaveBeenCalledWith(
      'Formato não aceito: JPG ou PNG, até 5 MB',
    )

    chooseFile(dialog, new File(['x'], 'banner.png', { type: 'image/png' }))
    expect(await within(dialog).findByText('banner.png')).toBeTruthy()
    expect(
      within(preview()).getByRole('img', { name: 'Cabeçalho do template' }),
    ).toHaveProperty('src', MEDIA_URL)

    submit(dialog)
    await waitFor(() => expect(notify.success).toHaveBeenCalled())
    expect(fetchBody(fetchSpy, /\/templates$/)).toEqual({
      connectionId: 'meta_1',
      name: 'promo',
      language: 'pt_BR',
      category: 'UTILITY',
      headerFormat: 'IMAGE',
      headerMediaUrl: MEDIA_URL,
      body: 'Olá {{1}}, temos novidades.',
      bodyExample: ['Ana'],
    })
  })

  it('drops the uploaded sample when the header type changes', async () => {
    const { dialog } = await open()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Vídeo' }))
    chooseFile(dialog, new File(['x'], 'clip.mp4', { type: 'video/mp4' }))
    expect(await within(dialog).findByText('clip.mp4')).toBeTruthy()

    fireEvent.click(
      within(dialog).getByRole('button', {
        name: 'Remover arquivo do cabeçalho',
      }),
    )
    expect(within(dialog).queryByText('clip.mp4')).toBeNull()

    chooseFile(dialog, new File(['x'], 'clip.mp4', { type: 'video/mp4' }))
    await within(dialog).findByText('clip.mp4')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Documento' }))
    expect(within(dialog).queryByText('clip.mp4')).toBeNull()
    expect(within(dialog).getByText('Enviar PDF')).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Nenhum' }))
    expect(within(dialog).queryByText('Enviar PDF')).toBeNull()
  })

  it('reports a failed upload', async () => {
    const { dialog } = await open([
      {
        method: 'POST',
        match: `${API}/media/upload`,
        status: 500,
        error: 'falhou',
      },
    ])
    fireEvent.click(within(dialog).getByRole('button', { name: 'Documento' }))
    chooseFile(dialog, new File(['x'], 'menu.pdf', { type: 'application/pdf' }))
    await waitFor(() =>
      expect(notify.error).toHaveBeenCalledWith(
        expect.anything(),
        'Erro ao enviar o arquivo',
      ),
    )
  })

  it('validates and sends the buttons with their actions', async () => {
    const { dialog, fetchSpy } = await open()
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Adicionar botão' }),
    )
    fireEvent.click(await screen.findByRole('menuitem', { name: /Resposta/ }))
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())

    submit(dialog)
    expect(notify.error).toHaveBeenCalledWith(
      'Botão 1: informe o texto do botão',
    )

    fireEvent.change(within(dialog).getByLabelText('Texto do botão 1'), {
      target: { value: '  Quero ' },
    })
    fireEvent.click(
      within(dialog).getByRole('button', {
        name: 'Adicionar ação ao botão 1',
      }),
    )
    fireEvent.click(
      await screen.findByRole('menuitem', {
        name: /Responder automaticamente/,
      }),
    )
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
    fireEvent.change(within(dialog).getByLabelText('Texto da resposta'), {
      target: { value: 'Já te chamo!' },
    })
    expect(within(preview()).getByText('Quero')).toBeTruthy()

    submit(dialog)
    await waitFor(() => expect(notify.success).toHaveBeenCalled())
    expect(fetchBody(fetchSpy, /\/templates$/)).toMatchObject({
      buttons: [
        {
          id: 'b1',
          type: 'REPLY',
          label: 'Quero',
          actions: [{ kind: 'REPLY', text: 'Já te chamo!' }],
        },
      ],
    })
  })

  it('shows the API error when Meta refuses the template', async () => {
    const { dialog } = await open([
      { method: 'POST', match: `${API}/templates`, status: 400, error: 'x' },
    ])
    submit(dialog)
    await waitFor(() =>
      expect(notify.error).toHaveBeenCalledWith(
        expect.anything(),
        'Não foi possível criar o template.',
      ),
    )
  })
})
