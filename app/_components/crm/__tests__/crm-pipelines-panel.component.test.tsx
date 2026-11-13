import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  fetchBody,
  mockFetch,
  renderWithQuery,
} from '@/src/__tests__/component-utils'
import { CrmPipelinesPanel } from '../crm-pipelines-panel'

const WS = 'ws_1'

const notify = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('@/lib/notify', () => ({ notify }))

const PIPELINES = [
  { id: 'pp1', name: 'Vendas B2B' },
  { id: 'pp2', name: 'Parcerias' },
]
const STAGES = [
  { id: 'st1', name: 'Prospecção', probability: 10, order: 0 },
  { id: 'st2', name: 'Negociação', probability: 60, order: 1 },
]

function setup(extra: Parameters<typeof mockFetch>[0] = []) {
  const spy = mockFetch([
    ...extra,
    { method: 'PATCH', match: '/stages/', data: {} },
    { method: 'DELETE', match: '/stages/', data: null },
    { method: 'POST', match: /pipelines\/pp1\/stages$/, data: { id: 'st3' } },
    { method: 'POST', match: /crm\/pipelines$/, data: { id: 'pp3' } },
    { method: 'DELETE', match: '/crm/pipelines/', data: null },
    { match: '/pipelines/pp1/stages', data: STAGES },
    { match: '/pipelines/pp2/stages', data: [] },
    { match: '/crm/pipelines', data: PIPELINES },
  ])
  renderWithQuery(<CrmPipelinesPanel workspaceId={WS} />)
  return spy
}

function patchBodies(spy: ReturnType<typeof mockFetch>) {
  return spy.mock.calls
    .filter(([, init]) => init?.method === 'PATCH')
    .map(([u, init]) => ({
      url: String(u),
      body: JSON.parse(String(init?.body)),
    }))
}

describe('<CrmPipelinesPanel />', () => {
  it('shows the empty state when no pipeline exists', async () => {
    setup([{ match: '/crm/pipelines', data: [] }])
    expect(await screen.findByText('Nenhum funil cadastrado')).toBeTruthy()
    expect(
      screen.getByText('Selecione um funil para gerenciar as etapas'),
    ).toBeTruthy()
  })

  it('auto-selects the first pipeline and lists its stages', async () => {
    setup()
    expect(await screen.findByText('Prospecção')).toBeTruthy()
    expect(screen.getByText('60%')).toBeTruthy()
  })

  it('switches pipeline and shows its empty stages state', async () => {
    setup()
    await screen.findByText('Prospecção')
    fireEvent.click(screen.getByText('Parcerias'))
    expect(await screen.findByText('Nenhuma etapa cadastrada')).toBeTruthy()
  })

  it('creates a pipeline from the dialog (submit disabled while empty)', async () => {
    const spy = setup()
    fireEvent.click(screen.getByRole('button', { name: /novo pipeline/i }))
    const submit = (await screen.findByRole('button', {
      name: 'Criar funil',
    })) as HTMLButtonElement
    expect(submit.disabled).toBe(true)

    fireEvent.change(screen.getByPlaceholderText('Nome do funil'), {
      target: { value: 'Renovações' },
    })
    fireEvent.click(submit)

    await waitFor(() =>
      expect(notify.success).toHaveBeenCalledWith('Funil criado'),
    )
    expect(fetchBody(spy, /crm\/pipelines$/)).toEqual({ name: 'Renovações' })
  })

  it('adds a stage and clears the input', async () => {
    const spy = setup()
    await screen.findByText('Prospecção')
    const input = screen.getByPlaceholderText('Nova etapa') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'Fechamento' } })
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar' }))

    await waitFor(() => expect(input.value).toBe(''))
    expect(fetchBody(spy, /stages$/)).toEqual({ name: 'Fechamento' })
  })

  it('renames a stage inline on Enter and ignores unchanged names', async () => {
    const spy = setup()
    fireEvent.click(await screen.findByRole('button', { name: 'Prospecção' }))
    const input = screen.getByDisplayValue('Prospecção')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(patchBodies(spy)).toHaveLength(0)

    fireEvent.click(screen.getByRole('button', { name: 'Prospecção' }))
    const editing = screen.getByDisplayValue('Prospecção')
    fireEvent.change(editing, { target: { value: '  Qualificação  ' } })
    fireEvent.keyDown(editing, { key: 'Enter' })
    await waitFor(() =>
      expect(patchBodies(spy)).toEqual([
        {
          url: expect.stringContaining('/stages/st1'),
          body: { name: 'Qualificação' },
        },
      ]),
    )
  })

  it('clamps probability to 0–100 when editing', async () => {
    const spy = setup()
    fireEvent.click(await screen.findByRole('button', { name: '60%' }))
    const input = screen.getByDisplayValue('60')
    fireEvent.change(input, { target: { value: '150' } })
    fireEvent.blur(input)

    await waitFor(() =>
      expect(patchBodies(spy)[0]?.body).toEqual({ probability: 100 }),
    )
  })

  it('cancels editing on Escape without saving', async () => {
    const spy = setup()
    fireEvent.click(await screen.findByRole('button', { name: 'Negociação' }))
    const input = screen.getByDisplayValue('Negociação')
    fireEvent.change(input, { target: { value: 'Outro' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(
      await screen.findByRole('button', { name: 'Negociação' }),
    ).toBeTruthy()
    expect(patchBodies(spy)).toHaveLength(0)
  })

  it('deletes a pipeline', async () => {
    const spy = setup()
    const select = (await screen.findByText('Parcerias')).closest(
      'button',
    ) as HTMLElement
    // Sem <button> aninhado: selecionar e remover são botões irmãos.
    expect(select.querySelector('button')).toBeNull()
    fireEvent.click(
      screen.getByRole('button', { name: 'Remover funil Parcerias' }),
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Remover' }))
    await waitFor(() =>
      expect(notify.success).toHaveBeenCalledWith('Funil removido'),
    )
    expect(
      spy.mock.calls.some(
        ([u, init]) =>
          init?.method === 'DELETE' && String(u).endsWith('/pipelines/pp2'),
      ),
    ).toBe(true)
  })
})
