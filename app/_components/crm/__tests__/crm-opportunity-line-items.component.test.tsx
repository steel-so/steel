import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { fetchBody, mockFetch } from '@/src/__tests__/component-utils'
import type { CrmOpportunityLineItemDTO } from '@/types/crm-opportunity'
import { CrmOpportunityLineItems } from '../crm-opportunity-line-items'

const notify = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}))
vi.mock('@/lib/notify', () => ({ notify }))

const BASE = '/api/workspaces/ws1/crm/opportunities/o1/line-items'

function item(overrides: Partial<CrmOpportunityLineItemDTO>) {
  return {
    id: 'li1',
    opportunityId: 'o1',
    productId: null,
    name: 'Consultoria',
    quantity: 2,
    unitPrice: 1000,
    discountPct: 10,
    billingType: 'ONE_TIME',
    total: 1800,
    position: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as CrmOpportunityLineItemDTO
}

function renderItems(productOptions: { value: string; label: string }[] = []) {
  const onChanged = vi.fn()
  render(
    <CrmOpportunityLineItems
      workspaceId='ws1'
      opportunityId='o1'
      productOptions={productOptions}
      onChanged={onChanged}
    />,
  )
  return { onChanged }
}

describe('<CrmOpportunityLineItems />', () => {
  it('shows the empty hint when the opportunity has no items', async () => {
    mockFetch([{ match: /line-items$/, data: [] }])
    renderItems()
    expect(screen.getByText('Carregando…')).toBeTruthy()
    expect(
      await screen.findByText(
        'Sem itens. O valor da oportunidade é editável manualmente.',
      ),
    ).toBeTruthy()
  })

  it('lists items with per-line and overall totals in BRL', async () => {
    mockFetch([
      {
        match: /line-items$/,
        data: [
          item({ id: 'li1', total: 1800 }),
          item({ id: 'li2', name: 'Licença', total: 500.5 }),
        ],
      },
    ])
    renderItems()

    expect(await screen.findByText(/R\$\s?1\.800,00/)).toBeTruthy()
    expect(screen.getByText(/R\$\s?500,50/)).toBeTruthy()
    expect(screen.getByText('Total')).toBeTruthy()
    expect(screen.getByText(/R\$\s?2\.300,50/)).toBeTruthy()
    expect(screen.getAllByLabelText('Nome do item')).toHaveLength(2)
  })

  it('adds a default item and notifies the parent grid', async () => {
    const fetchSpy = mockFetch([
      { match: /line-items$/, data: [] },
      { method: 'POST', match: /line-items$/, data: item({}) },
    ])
    const { onChanged } = renderItems()
    await screen.findByText(/Sem itens/)

    fireEvent.click(screen.getByRole('button', { name: 'Adicionar' }))

    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1))
    expect(fetchBody(fetchSpy, /line-items$/)).toEqual({
      name: 'Novo item',
      quantity: 1,
    })
  })

  it('clamps quantity and discount before PATCHing', async () => {
    const fetchSpy = mockFetch([
      { match: /line-items$/, data: [item({})] },
      { method: 'PATCH', match: `${BASE}/li1`, data: item({}) },
    ])
    const { onChanged } = renderItems()

    const qty = await screen.findByLabelText('Quantidade')
    fireEvent.change(qty, { target: { value: '0' } })
    fireEvent.blur(qty)
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1))
    expect(fetchBody(fetchSpy, `${BASE}/li1`, 'PATCH')).toEqual({ quantity: 1 })

    const discount = screen.getByLabelText('Desconto percentual')
    fireEvent.change(discount, { target: { value: '150' } })
    fireEvent.blur(discount)
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(2))
    const patches = fetchSpy.mock.calls
      .filter(([, init]) => init?.method === 'PATCH')
      .map(([, init]) => JSON.parse(String(init?.body)))
    expect(patches[1]).toEqual({ discountPct: 100 })
  })

  it('does not PATCH when a field loses focus unchanged', async () => {
    const fetchSpy = mockFetch([{ match: /line-items$/, data: [item({})] }])
    renderItems()

    fireEvent.blur(await screen.findByLabelText('Preço unitário'))
    fireEvent.blur(screen.getByLabelText('Nome do item'))

    expect(
      fetchSpy.mock.calls.some(([, init]) => init?.method === 'PATCH'),
    ).toBe(false)
  })

  it('removes an item and reports API failures', async () => {
    mockFetch([
      { match: /line-items$/, data: [item({})] },
      {
        method: 'DELETE',
        match: `${BASE}/li1`,
        status: 403,
        error: 'Sem permissão para editar',
      },
    ])
    const { onChanged } = renderItems()

    fireEvent.click(await screen.findByRole('button', { name: 'Remover item' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Remover' }))

    await waitFor(() =>
      expect(notify.error).toHaveBeenCalledWith('Sem permissão para editar'),
    )
    expect(onChanged).not.toHaveBeenCalled()
    expect(
      (screen.getByRole('button', { name: 'Adicionar' }) as HTMLButtonElement)
        .disabled,
    ).toBe(false)
  })

  it('shows a product picker instead of a free-text name when products exist', async () => {
    mockFetch([{ match: /line-items$/, data: [item({ name: 'Plano Pro' })] }])
    renderItems([{ value: 'prod1', label: 'Plano Pro' }])

    expect(await screen.findByText('Plano Pro')).toBeTruthy()
    expect(screen.queryByLabelText('Nome do item')).toBeNull()
    expect(screen.getByRole('combobox')).toBeTruthy()
  })

  it('changes the product with a single PATCH, never deleting the item', async () => {
    const fetchSpy = mockFetch([
      { match: /line-items$/, data: [item({ name: 'Consultoria' })] },
      {
        method: 'PATCH',
        match: `${BASE}/li1`,
        data: item({ productId: 'prod1', name: 'Plano Pro' }),
      },
    ])
    const { onChanged } = renderItems([{ value: 'prod1', label: 'Plano Pro' }])

    fireEvent.click(await screen.findByRole('combobox'))
    const option = await screen.findByRole('option', { name: 'Plano Pro' })
    fireEvent.pointerDown(option, { pointerType: 'mouse' })
    fireEvent.click(option)

    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1))
    expect(fetchBody(fetchSpy, `${BASE}/li1`, 'PATCH')).toEqual({
      productId: 'prod1',
    })
    const methods = fetchSpy.mock.calls.map(([, init]) => init?.method ?? 'GET')
    expect(methods).not.toContain('DELETE')
    expect(methods).not.toContain('POST')
  })

  it('re-enables the buttons and warns when the network fails', async () => {
    mockFetch([
      { match: /line-items$/, data: [item({})] },
      {
        method: 'DELETE',
        match: `${BASE}/li1`,
        handler: () => {
          throw new TypeError('Failed to fetch')
        },
      },
    ])
    const { onChanged } = renderItems()

    fireEvent.click(await screen.findByRole('button', { name: 'Remover item' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Remover' }))

    await waitFor(() =>
      expect(notify.error).toHaveBeenCalledWith(
        'Falha de conexão. Verifique sua internet e tente novamente.',
      ),
    )
    expect(onChanged).not.toHaveBeenCalled()
    expect(
      (screen.getByRole('button', { name: 'Adicionar' }) as HTMLButtonElement)
        .disabled,
    ).toBe(false)
    expect(
      (
        screen.getByRole('button', {
          name: 'Remover item',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false)
  })
})
