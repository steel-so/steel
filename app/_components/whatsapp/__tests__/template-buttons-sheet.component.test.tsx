import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  fetchBody,
  mockFetch,
  renderWithQuery,
} from '@/src/__tests__/component-utils'
import { WhatsappSettingsTemplates } from '../settings/whatsapp-settings-templates'

vi.setConfig({ testTimeout: 20_000 })

const notify = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('@/lib/notify', () => ({ notify }))

const API = '/api/workspaces/ws_1/whatsapp'

function template(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tpl_1',
    workspaceId: 'ws_1',
    connectionId: 'meta_1',
    name: 'confirmacao',
    language: 'pt_BR',
    category: 'MARKETING',
    status: 'APPROVED',
    components: [],
    quality: 'GREEN',
    qualityUpdatedAt: null,
    statusReason: null,
    headerFormat: null,
    headerMediaUrl: null,
    buttons: [
      { id: 'b1', type: 'REPLY', label: 'Confirmar', actions: [] },
      { id: 'b2', type: 'URL', label: 'Site', url: 'https://x.test' },
    ],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function setup(extra: Parameters<typeof mockFetch>[0] = []) {
  notify.success.mockClear()
  notify.error.mockClear()
  return mockFetch([
    ...extra,
    { match: `${API}/connections`, data: [] },
    {
      method: 'PATCH',
      match: `${API}/templates/tpl_1/buttons`,
      data: template(),
    },
    {
      match: `${API}/templates`,
      data: [
        template(),
        template({
          id: 'tpl_2',
          name: 'cobranca',
          status: 'PAUSED',
          quality: 'RED',
          statusReason: 'Pausado pela Meta',
          buttons: [],
        }),
      ],
    },
  ])
}

async function openSheet() {
  fireEvent.click(
    await screen.findByRole('button', {
      name: 'Ações dos botões de confirmacao',
    }),
  )
  return screen.findByRole('dialog')
}

describe('<TemplateButtonsSheet /> (via templates page)', () => {
  it('lists quality, status and buttons, offering actions only with reply buttons', async () => {
    setup()
    renderWithQuery(<WhatsappSettingsTemplates workspaceId='ws_1' />)

    expect(await screen.findByText('cobranca')).toBeTruthy()
    expect(screen.getByRole('img', { name: 'Qualidade alta' })).toBeTruthy()
    expect(screen.getByRole('img', { name: 'Qualidade baixa' })).toBeTruthy()
    expect(screen.getByText('Pausado')).toBeTruthy()
    expect(screen.getAllByText('Marketing')).toHaveLength(2)
    expect(screen.getByText('Confirmar')).toBeTruthy()
    expect(
      screen.queryByRole('button', { name: 'Ações dos botões de cobranca' }),
    ).toBeNull()
  })

  it('saves the click actions of a reply button', async () => {
    const fetchSpy = setup()
    renderWithQuery(<WhatsappSettingsTemplates workspaceId='ws_1' />)
    const sheet = await openSheet()

    expect(within(sheet).getByText('confirmacao')).toBeTruthy()
    // Approved labels are fixed.
    expect(within(sheet).queryByLabelText('Texto do botão 1')).toBeNull()

    fireEvent.click(
      within(sheet).getByRole('button', { name: 'Adicionar ação ao botão 1' }),
    )
    fireEvent.click(
      await screen.findByRole('menuitem', {
        name: /Responder automaticamente/,
      }),
    )
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())

    // Empty reply text is refused before calling the API.
    fireEvent.click(within(sheet).getByRole('button', { name: 'Salvar ações' }))
    expect(notify.error).toHaveBeenCalledWith(
      'Botão 1, ação 1: escreva a resposta',
    )

    fireEvent.change(within(sheet).getByLabelText('Texto da resposta'), {
      target: { value: ' Confirmado! ' },
    })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Salvar ações' }))
    await waitFor(() =>
      expect(notify.success).toHaveBeenCalledWith('Ações dos botões salvas'),
    )
    expect(
      fetchBody(fetchSpy, `${API}/templates/tpl_1/buttons`, 'PATCH'),
    ).toEqual({
      buttons: [
        {
          id: 'b1',
          type: 'REPLY',
          label: 'Confirmar',
          actions: [{ kind: 'REPLY', text: 'Confirmado!' }],
        },
        { id: 'b2', type: 'URL', label: 'Site', url: 'https://x.test' },
      ],
    })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('reports a refused save and closes on cancel', async () => {
    setup([
      {
        method: 'PATCH',
        match: `${API}/templates/tpl_1/buttons`,
        status: 422,
        error: 'Botões não batem',
      },
    ])
    renderWithQuery(<WhatsappSettingsTemplates workspaceId='ws_1' />)
    const sheet = await openSheet()

    fireEvent.click(within(sheet).getByRole('button', { name: 'Salvar ações' }))
    await waitFor(() =>
      expect(notify.error).toHaveBeenCalledWith(
        expect.anything(),
        'Não foi possível salvar as ações',
      ),
    )
    fireEvent.click(within(sheet).getByRole('button', { name: 'Cancelar' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })
})
