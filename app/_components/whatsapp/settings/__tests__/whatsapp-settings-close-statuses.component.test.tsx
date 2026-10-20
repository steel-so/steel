import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { WorkspacePermissionsProvider } from '@/app/_components/workspace/workspace-permissions'
import {
  fetchBody,
  mockFetch,
  renderWithQuery,
} from '@/src/__tests__/component-utils'
import { WhatsappSettingsCloseStatuses } from '../whatsapp-settings-close-statuses'

vi.setConfig({ testTimeout: 20_000 })

const notify = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('@/lib/notify', () => ({ notify }))

const STATUSES = '/api/workspaces/ws_1/whatsapp/close-statuses'
const SETTINGS = '/api/workspaces/ws_1/whatsapp/settings'

const options = {
  statuses: [
    { id: 'st_1', label: 'Venda realizada', outcome: 'SUCCESS', position: 0 },
  ],
  minSelections: 0,
  maxSelections: 1,
}

function setup() {
  return mockFetch([
    {
      method: 'POST',
      match: STATUSES,
      data: {
        id: 'st_2',
        label: 'Sem interesse',
        outcome: 'SUCCESS',
        position: 1,
      },
    },
    { method: 'DELETE', match: `${STATUSES}/st_1`, data: { id: 'st_1' } },
    { method: 'PATCH', match: SETTINGS, data: {} },
    { match: STATUSES, data: options },
  ])
}

describe('<WhatsappSettingsCloseStatuses />', () => {
  it('lists the statuses, adds a new one and removes another', async () => {
    const fetchSpy = setup()
    renderWithQuery(<WhatsappSettingsCloseStatuses workspaceId='ws_1' />)

    expect(await screen.findByText('Venda realizada')).toBeTruthy()

    fireEvent.change(screen.getByLabelText('Novo status'), {
      target: { value: 'Sem interesse' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar' }))
    await waitFor(() =>
      expect(fetchBody(fetchSpy, STATUSES, 'POST')).toEqual({
        label: 'Sem interesse',
        outcome: 'SUCCESS',
      }),
    )

    fireEvent.click(
      screen.getByRole('button', { name: 'Remover Venda realizada' }),
    )
    await waitFor(() =>
      expect(notify.success).toHaveBeenCalledWith('Status removido'),
    )
  })

  it('saves how many statuses the agent picks', async () => {
    const fetchSpy = setup()
    renderWithQuery(<WhatsappSettingsCloseStatuses workspaceId='ws_1' />)

    const min = (await screen.findByLabelText('Mínimo')) as HTMLInputElement
    await waitFor(() => expect(min.value).toBe('0'))
    fireEvent.change(min, { target: { value: '1' } })
    fireEvent.change(screen.getByLabelText('Máximo'), {
      target: { value: '2' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar regras' }))

    await waitFor(() =>
      expect(fetchBody(fetchSpy, SETTINGS, 'PATCH')).toEqual({
        closeStatusMinSelections: 1,
        closeStatusMaxSelections: 2,
      }),
    )
  })

  it('rejects a minimum above the maximum without saving', async () => {
    const fetchSpy = setup()
    renderWithQuery(<WhatsappSettingsCloseStatuses workspaceId='ws_1' />)

    const min = (await screen.findByLabelText('Mínimo')) as HTMLInputElement
    await waitFor(() => expect(min.value).toBe('0'))
    fireEvent.change(min, { target: { value: '3' } })
    const form = min.closest('form')
    if (form) fireEvent.submit(form)

    expect(notify.error).toHaveBeenCalled()
    expect(fetchBody(fetchSpy, SETTINGS, 'PATCH')).toBeUndefined()
  })

  it('renders nothing for a non-admin', () => {
    setup()
    const { container } = renderWithQuery(
      <WorkspacePermissionsProvider
        value={{ isPrivileged: false, permissions: null }}
      >
        <WhatsappSettingsCloseStatuses workspaceId='ws_1' />
      </WorkspacePermissionsProvider>,
    )
    expect(container.textContent).toBe('')
  })
})
