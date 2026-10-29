import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  type FetchRoute,
  fetchBody,
  mockFetch,
} from '@/src/__tests__/component-utils'
import { CrmLeadRulesSection } from '../crm-lead-rules-section'

const notify = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}))
vi.mock('@/lib/notify', () => ({ notify }))

const WS = 'ws_1'
const CRM = `/api/workspaces/${WS}/crm`

const USERS = [
  { id: 'u_ana', name: 'Ana Vendas', email: 'ana@empresa.com' },
  { id: 'u_beto', name: null, email: 'beto@empresa.com' },
]

function setup({
  scoring = [] as unknown[],
  routing = [] as unknown[],
  extra = [] as FetchRoute[],
} = {}) {
  const spy = mockFetch([
    ...extra,
    { match: `${CRM}/lead-scoring-rules`, data: scoring },
    { match: `${CRM}/lead-routing-rules`, data: routing },
    { match: `${CRM}/members`, data: USERS },
  ])
  render(<CrmLeadRulesSection workspaceId={WS} />)
  return spy
}

function card(title: string) {
  return screen.getByText(title).closest('[data-slot=card]') as HTMLElement
}

async function pick(trigger: HTMLElement, optionName: string) {
  fireEvent.click(trigger)
  const option = await screen.findByRole('option', { name: optionName })
  fireEvent.pointerDown(option, { pointerType: 'mouse' })
  fireEvent.click(option)
}

function dialogTriggers() {
  return Array.from(
    screen
      .getByRole('dialog')
      .querySelectorAll<HTMLElement>('[data-slot=select-trigger]'),
  )
}

describe('<CrmLeadRulesSection />', () => {
  it('shows empty states for both rule kinds', async () => {
    setup()
    expect(
      await screen.findByText('Nenhuma regra de pontuação ainda.'),
    ).toBeTruthy()
    expect(
      await screen.findByText('Nenhuma regra de roteamento ainda.'),
    ).toBeTruthy()
  })

  it('summarizes rule conditions in pt-BR and resolves owners by name', async () => {
    setup({
      scoring: [
        {
          id: 's1',
          field: 'source',
          operator: 'equals',
          value: 'Google',
          points: 15,
          active: true,
        },
        {
          id: 's2',
          field: 'phone',
          operator: 'is_empty',
          value: 'ignorado',
          points: -5,
          active: false,
        },
      ],
      routing: [
        {
          id: 'r1',
          field: 'city',
          operator: 'contains',
          value: 'Recife',
          ownerId: 'u_ana',
          active: true,
        },
        {
          id: 'r2',
          field: 'email',
          operator: 'is_not_empty',
          value: null,
          ownerId: 'u_beto',
          active: true,
        },
      ],
    })

    expect(await screen.findByText('Origem é igual a "Google"')).toBeTruthy()
    // Empty-check operators never print the stored value.
    expect(screen.getByText('Telefone está vazio')).toBeTruthy()
    expect(screen.getByText('Inativa')).toBeTruthy()

    const routing = card('Roteamento de leads')
    await waitFor(() =>
      expect(within(routing).getByText('Ana Vendas')).toBeTruthy(),
    )
    expect(within(routing).getByText('Cidade contém "Recife"')).toBeTruthy()
    // Users without a name fall back to their e-mail.
    expect(within(routing).getByText('beto@empresa.com')).toBeTruthy()
  })

  it('creates a scoring rule with the default field/operator', async () => {
    const spy = setup({
      extra: [
        {
          method: 'POST',
          match: `${CRM}/lead-scoring-rules`,
          data: { id: 's9' },
        },
      ],
    })
    await screen.findByText('Nenhuma regra de pontuação ainda.')

    fireEvent.click(
      within(card('Pontuação de leads')).getByRole('button', {
        name: /nova regra/i,
      }),
    )
    const dialog = await screen.findByRole('dialog')
    const valueInput = dialog.querySelector(
      'input[data-slot=input]:not([type=number])',
    ) as HTMLInputElement
    const pointsInput = dialog.querySelector(
      'input[type=number]',
    ) as HTMLInputElement
    fireEvent.change(valueInput, { target: { value: 'Indicação' } })
    fireEvent.change(pointsInput, { target: { value: '25' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Criar regra' }))

    await waitFor(() =>
      expect(notify.success).toHaveBeenCalledWith('Regra de pontuação criada'),
    )
    expect(fetchBody(spy, `${CRM}/lead-scoring-rules`)).toEqual({
      field: 'source',
      operator: 'equals',
      value: 'Indicação',
      points: 25,
      active: true,
    })
  })

  it('summarizes newsletter event rules', async () => {
    setup({
      scoring: [
        {
          id: 'e1',
          field: 'newsletter_clicked',
          operator: 'contains',
          value: '/precos',
          points: 20,
          active: true,
        },
        {
          id: 'e2',
          field: 'newsletter_opened',
          operator: 'contains',
          value: '',
          points: 5,
          active: true,
        },
      ],
    })
    expect(
      await screen.findByText(
        /Clicou em link da newsletter \(URL contém "\/precos"\)/,
      ),
    ).toBeTruthy()
    expect(screen.getByText(/^Abriu newsletter/)).toBeTruthy()
  })

  it('creates a newsletter click rule with the URL filter', async () => {
    const spy = setup({
      extra: [
        {
          method: 'POST',
          match: `${CRM}/lead-scoring-rules`,
          data: { id: 's9' },
        },
      ],
    })
    await screen.findByText('Nenhuma regra de pontuação ainda.')
    fireEvent.click(
      within(card('Pontuação de leads')).getByRole('button', {
        name: /nova regra/i,
      }),
    )
    await screen.findByRole('dialog')
    const [fieldTrigger] = dialogTriggers()
    await pick(fieldTrigger, 'Clicou em link da newsletter')

    const dialog = screen.getByRole('dialog')
    await waitFor(() =>
      expect(within(dialog).getByText('URL contém (opcional)')).toBeTruthy(),
    )
    expect(within(dialog).queryByText('Valor')).toBeNull()
    fireEvent.change(within(dialog).getByPlaceholderText('Ex.: /precos'), {
      target: { value: '/precos' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Criar regra' }))

    await waitFor(() =>
      expect(notify.success).toHaveBeenCalledWith('Regra de pontuação criada'),
    )
    expect(fetchBody(spy, `${CRM}/lead-scoring-rules`)).toEqual({
      field: 'newsletter_clicked',
      operator: 'contains',
      value: '/precos',
      points: 10,
      active: true,
    })
  })

  it('drops the value of the other newsletter events', async () => {
    const spy = setup({
      extra: [
        {
          method: 'POST',
          match: `${CRM}/lead-scoring-rules`,
          data: { id: 's9' },
        },
      ],
    })
    await screen.findByText('Nenhuma regra de pontuação ainda.')
    fireEvent.click(
      within(card('Pontuação de leads')).getByRole('button', {
        name: /nova regra/i,
      }),
    )
    await screen.findByRole('dialog')
    const [fieldTrigger] = dialogTriggers()
    await pick(fieldTrigger, 'Assinou newsletter')
    const dialog = screen.getByRole('dialog')
    await waitFor(() =>
      expect(within(dialog).getByText(/uma vez por/)).toBeTruthy(),
    )
    expect(within(dialog).queryByText('URL contém (opcional)')).toBeNull()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Criar regra' }))
    await waitFor(() => expect(notify.success).toHaveBeenCalled())
    const body = fetchBody(spy, `${CRM}/lead-scoring-rules`)
    expect(body).toMatchObject({
      field: 'newsletter_subscribed',
      operator: 'contains',
    })
    expect(body).not.toHaveProperty('value')
  })

  it('hides the value input for empty-check operators', async () => {
    setup()
    await screen.findByText('Nenhuma regra de pontuação ainda.')
    fireEvent.click(
      within(card('Pontuação de leads')).getByRole('button', {
        name: /nova regra/i,
      }),
    )
    await screen.findByRole('dialog')
    expect(within(screen.getByRole('dialog')).getByText('Valor')).toBeTruthy()

    const [, operatorTrigger] = dialogTriggers()
    await pick(operatorTrigger, 'está vazio')

    await waitFor(() =>
      expect(
        within(screen.getByRole('dialog')).queryByText('Valor'),
      ).toBeNull(),
    )
  })

  it('requires an owner before creating a routing rule', async () => {
    const spy = setup({
      extra: [
        {
          method: 'POST',
          match: `${CRM}/lead-routing-rules`,
          data: { id: 'r9' },
        },
      ],
    })
    await screen.findByText('Nenhuma regra de roteamento ainda.')

    fireEvent.click(
      within(card('Roteamento de leads')).getByRole('button', {
        name: /nova regra/i,
      }),
    )
    const dialog = await screen.findByRole('dialog')
    const create = within(dialog).getByRole('button', {
      name: 'Criar regra',
    }) as HTMLButtonElement
    expect(create.disabled).toBe(true)

    const ownerTrigger = dialogTriggers()[2]
    await pick(ownerTrigger, 'Ana Vendas')
    await waitFor(() => expect(create.disabled).toBe(false))
    fireEvent.click(create)

    await waitFor(() =>
      expect(notify.success).toHaveBeenCalledWith('Regra de roteamento criada'),
    )
    expect(fetchBody(spy, `${CRM}/lead-routing-rules`)).toMatchObject({
      field: 'source',
      operator: 'equals',
      ownerId: 'u_ana',
      active: true,
    })
  })

  it('reports field validation errors returned by the API', async () => {
    setup({
      extra: [
        {
          method: 'POST',
          match: `${CRM}/lead-scoring-rules`,
          handler: () =>
            new Response(
              JSON.stringify({
                success: false,
                error: {
                  code: 'VALIDATION_ERROR',
                  details: { fieldErrors: { points: ['Valor inválido'] } },
                },
              }),
              { status: 400 },
            ),
        },
      ],
    })
    await screen.findByText('Nenhuma regra de pontuação ainda.')
    fireEvent.click(
      within(card('Pontuação de leads')).getByRole('button', {
        name: /nova regra/i,
      }),
    )
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Criar regra' }))

    await waitFor(() =>
      expect(notify.error).toHaveBeenCalledWith('points: Valor inválido'),
    )
  })

  it('deletes a scoring rule', async () => {
    const spy = setup({
      scoring: [
        {
          id: 's1',
          field: 'source',
          operator: 'equals',
          value: 'Google',
          points: 15,
          active: true,
        },
      ],
      extra: [
        {
          method: 'DELETE',
          match: `${CRM}/lead-scoring-rules/s1`,
          data: null,
        },
      ],
    })
    await screen.findByText('Origem é igual a "Google"')

    fireEvent.click(screen.getByRole('button', { name: 'Excluir regra' }))

    await waitFor(() =>
      expect(
        spy.mock.calls.some(
          ([url, init]) =>
            init?.method === 'DELETE' &&
            String(url).endsWith('/lead-scoring-rules/s1'),
        ),
      ).toBe(true),
    )
    expect(notify.error).not.toHaveBeenCalled()
  })
})
