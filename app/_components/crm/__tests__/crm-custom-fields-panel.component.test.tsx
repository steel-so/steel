import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  fetchBody,
  mockFetch,
  renderWithQuery,
} from '@/src/__tests__/component-utils'
import { CrmCustomFieldsPanel } from '../crm-custom-fields-panel'

const WS = 'ws_1'

const notify = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('@/lib/notify', () => ({ notify }))

const COMPANY_FIELDS = [
  { id: 'f1', key: 'cnpj', label: 'CNPJ', type: 'TEXT', entity: 'COMPANY' },
]
const PERSON_FIELDS = [
  {
    id: 'f2',
    key: 'aniversario',
    label: 'Aniversário',
    type: 'DATE',
    entity: 'PERSON',
  },
]

function setup(extra: Parameters<typeof mockFetch>[0] = []) {
  const spy = mockFetch([
    ...extra,
    { method: 'POST', match: /custom-fields$/, data: { id: 'f9' } },
    { method: 'DELETE', match: '/custom-fields/', data: null },
    { match: 'entity=COMPANY', data: COMPANY_FIELDS },
    { match: 'entity=PERSON', data: PERSON_FIELDS },
    { match: 'entity=OPPORTUNITY', data: [] },
  ])
  renderWithQuery(<CrmCustomFieldsPanel workspaceId={WS} />)
  return spy
}

// Base UI only commits a mouse selection that started on the item itself,
// so a pointerdown must precede the click.
async function chooseOption(trigger: HTMLElement, option: string) {
  fireEvent.click(trigger)
  const item = await screen.findByRole('option', { name: option })
  fireEvent.pointerDown(item, { pointerType: 'mouse' })
  fireEvent.click(item)
}

const KEY_PLACEHOLDER = 'Chave (letras minúsculas e _, ex.: data_contrato)'

describe('<CrmCustomFieldsPanel />', () => {
  it('lists the company fields by default', async () => {
    setup()
    expect(await screen.findByText('cnpj')).toBeTruthy()
    expect(screen.getByText('CNPJ')).toBeTruthy()
    expect(screen.getByText('Texto')).toBeTruthy()
  })

  it('switches entity and refetches its fields', async () => {
    setup()
    await screen.findByText('cnpj')
    await chooseOption(screen.getByRole('combobox'), 'Pessoas')
    expect(await screen.findByText('aniversario')).toBeTruthy()
    expect(screen.queryByText('cnpj')).toBeNull()
  })

  it('shows the per-entity empty state', async () => {
    setup()
    await screen.findByText('cnpj')
    await chooseOption(screen.getByRole('combobox'), 'Oportunidades')
    expect(
      await screen.findByText('Nenhum campo personalizado para oportunidades'),
    ).toBeTruthy()
  })

  it('creates a field for the selected entity with the chosen type', async () => {
    const spy = setup()
    await screen.findByText('cnpj')
    fireEvent.click(screen.getByRole('button', { name: /novo campo/i }))

    const submit = (await screen.findByRole('button', {
      name: 'Criar campo',
    })) as HTMLButtonElement
    expect(submit.disabled).toBe(true)

    fireEvent.change(screen.getByPlaceholderText(KEY_PLACEHOLDER), {
      target: { value: 'porte' },
    })
    expect(submit.disabled).toBe(true)
    fireEvent.change(screen.getByPlaceholderText('Rótulo'), {
      target: { value: 'Porte' },
    })
    expect(submit.disabled).toBe(false)

    const dialog = screen.getByRole('dialog')
    const typeTrigger = dialog.querySelector('[role="combobox"]') as HTMLElement
    await chooseOption(typeTrigger, 'Lista de opções')
    fireEvent.click(screen.getByRole('button', { name: 'Criar campo' }))

    await waitFor(() =>
      expect(notify.success).toHaveBeenCalledWith('Campo criado'),
    )
    expect(fetchBody(spy, /custom-fields$/)).toEqual({
      entity: 'COMPANY',
      key: 'porte',
      label: 'Porte',
      type: 'SELECT',
    })
  })

  it('surfaces a duplicate-key error from the API', async () => {
    setup([
      {
        method: 'POST',
        match: /custom-fields$/,
        status: 409,
        error: 'Chave já utilizada',
      },
    ])
    fireEvent.click(screen.getByRole('button', { name: /novo campo/i }))
    fireEvent.change(await screen.findByPlaceholderText(KEY_PLACEHOLDER), {
      target: { value: 'cnpj' },
    })
    fireEvent.change(screen.getByPlaceholderText('Rótulo'), {
      target: { value: 'CNPJ' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Criar campo' }))
    await waitFor(() => expect(notify.error).toHaveBeenCalled())
    expect((notify.error.mock.lastCall?.[0] as Error)?.message).toBe(
      'Chave já utilizada',
    )
  })

  it('deletes a field', async () => {
    const spy = setup()
    const row = (await screen.findByText('cnpj')).closest('tr') as HTMLElement
    fireEvent.click(row.querySelector('button') as HTMLElement)
    fireEvent.click(await screen.findByRole('button', { name: 'Remover' }))
    await waitFor(() =>
      expect(notify.success).toHaveBeenCalledWith('Campo removido'),
    )
    expect(
      spy.mock.calls.some(
        ([u, init]) =>
          init?.method === 'DELETE' && String(u).endsWith('/custom-fields/f1'),
      ),
    ).toBe(true)
  })
})
