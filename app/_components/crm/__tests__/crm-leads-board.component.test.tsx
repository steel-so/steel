import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  type FetchRoute,
  fetchBody,
  mockFetch,
  renderWithQuery,
} from '@/src/__tests__/component-utils'
import type { CrmLeadDTO } from '@/types/crm-lead'
import { CrmLeadsBoard } from '../crm-leads-board'

const notify = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}))
vi.mock('@/lib/notify', () => ({ notify }))

const LEAD_URL = '/api/workspaces/ws1/crm/leads'

function lead(overrides: Partial<CrmLeadDTO>): CrmLeadDTO {
  return {
    id: 'l1',
    workspaceId: 'ws1',
    name: 'Ana Lima',
    emails: ['ana@lima.com'],
    phones: [],
    company: 'Lima Ltda',
    jobTitle: null,
    city: null,
    linkedin: null,
    source: 'Site',
    channel: null,
    stage: 'RECEIVED',
    score: 0,
    ownerId: null,
    convertedPersonId: null,
    closeResult: null,
    closedAt: null,
    contractSignedAt: null,
    billingType: null,
    closedAmount: null,
    lostReason: null,
    lostNote: null,
    retryAt: null,
    createdById: 'u1',
    updatedById: null,
    position: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function leadsRoute(leads: CrmLeadDTO[]): FetchRoute {
  return { match: /\/crm\/leads$/, data: leads }
}

function renderBoard() {
  return renderWithQuery(<CrmLeadsBoard workspaceId='ws1' slug='acme' />)
}

// Labels in the board are visual (no htmlFor); resolve the control that
// sits next to a label inside the same field wrapper.
function field(label: string | RegExp): HTMLInputElement {
  const labelEl = screen.getByText(label)
  const control = labelEl.parentElement?.querySelector('input, textarea')
  if (!control) throw new Error(`No control for label ${String(label)}`)
  return control as HTMLInputElement
}

function type(label: string | RegExp, value: string) {
  fireEvent.change(field(label), { target: { value } })
}

async function openLead(name: string) {
  fireEvent.click(await screen.findByText(name))
}

function stageColumn(label: string) {
  // The column header badge sits in the column's header row; its
  // grandparent is the column itself.
  const header = screen.getAllByText(label)[0]
  return within(header.parentElement?.parentElement as HTMLElement)
}

describe('<CrmLeadsBoard /> pipeline', () => {
  it('renders the six stages with their counts and lead cards', async () => {
    mockFetch([
      leadsRoute([
        lead({ id: 'l1', name: 'Ana Lima', stage: 'RECEIVED' }),
        lead({
          id: 'l2',
          name: 'Bruno Reis',
          stage: 'RECEIVED',
          company: null,
        }),
        lead({ id: 'l3', name: 'Carla Dias', stage: 'PROPOSAL' }),
      ]),
    ])
    renderBoard()

    expect(await screen.findByText('3 leads no funil')).toBeTruthy()
    for (const label of [
      'Lead recebido',
      'Em contato',
      'Lead qualificado',
      'Interesse/Oportunidade',
      'Proposta',
      'Fechado/Encerrado',
    ]) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0)
    }
    const received = stageColumn('Lead recebido')
    expect(received.getByText('2')).toBeTruthy()
    expect(received.getByText('Ana Lima')).toBeTruthy()
    expect(received.getByText('Bruno Reis')).toBeTruthy()
    expect(received.getByText('Lima Ltda')).toBeTruthy()
    expect(stageColumn('Proposta').getByText('Carla Dias')).toBeTruthy()
    // 4 empty stages.
    expect(screen.getAllByText('Vazio')).toHaveLength(4)
  })

  it('uses the singular label for a single lead', async () => {
    mockFetch([leadsRoute([lead({})])])
    renderBoard()
    expect(await screen.findByText('1 lead no funil')).toBeTruthy()
  })
})

describe('<CrmLeadsBoard /> create dialog', () => {
  it('validates name, contact and source in order (pt-BR)', async () => {
    const fetchSpy = mockFetch([leadsRoute([])])
    renderBoard()
    await screen.findByText('0 leads no funil')

    fireEvent.click(screen.getByText('Novo lead', { selector: 'button' }))
    const submit = await screen.findByText('Criar lead')

    fireEvent.click(submit)
    expect(notify.error).toHaveBeenLastCalledWith('Informe o nome')

    type('Nome *', 'Diego Alves')
    fireEvent.click(submit)
    expect(notify.error).toHaveBeenLastCalledWith(
      'Informe ao menos um email ou telefone',
    )

    type('Telefone', '+55 81 99999-0000')
    fireEvent.click(submit)
    expect(notify.error).toHaveBeenLastCalledWith('Informe a origem')

    expect(
      fetchSpy.mock.calls.some(([, init]) => init?.method === 'POST'),
    ).toBe(false)
  })

  it('creates the lead with trimmed values and refreshes the board', async () => {
    let created = false
    const fetchSpy = mockFetch([
      {
        match: /\/crm\/leads$/,
        handler: () =>
          created ? [lead({ id: 'l9', name: 'Diego Alves' })] : [],
      },
      {
        method: 'POST',
        match: /\/crm\/leads$/,
        handler: () => {
          created = true
          return lead({ id: 'l9', name: 'Diego Alves' })
        },
      },
    ])
    renderBoard()
    await screen.findByText('0 leads no funil')

    fireEvent.click(screen.getByText('Novo lead', { selector: 'button' }))
    await screen.findByText('Criar lead')
    type('Nome *', '  Diego Alves ')
    type('Email', 'diego@alves.com ')
    type('Origem *', 'Indicação')
    fireEvent.click(screen.getByText('Criar lead'))

    await waitFor(() =>
      expect(notify.success).toHaveBeenCalledWith('Lead criado'),
    )
    expect(fetchBody(fetchSpy, /\/crm\/leads$/)).toEqual({
      name: 'Diego Alves',
      emails: ['diego@alves.com'],
      phones: [],
      source: 'Indicação',
    })
    expect(await screen.findByText('Diego Alves')).toBeTruthy()
    expect(screen.queryByText('Criar lead')).toBeNull()
  })

  it('keeps the dialog open and shows the API error when creation fails', async () => {
    mockFetch([
      leadsRoute([]),
      {
        method: 'POST',
        match: /\/crm\/leads$/,
        status: 409,
        error: 'Lead duplicado',
      },
    ])
    renderBoard()
    await screen.findByText('0 leads no funil')

    fireEvent.click(screen.getByText('Novo lead', { selector: 'button' }))
    await screen.findByText('Criar lead')
    type('Nome *', 'Diego')
    type('Email', 'd@a.com')
    type('Origem *', 'Site')
    fireEvent.click(screen.getByText('Criar lead'))

    await waitFor(() =>
      expect(notify.error).toHaveBeenCalledWith('Lead duplicado'),
    )
    expect(screen.getByText('Criar lead')).toBeTruthy()
  })
})

describe('<CrmLeadsBoard /> stage panel', () => {
  it('RECEIVED: requires who was contacted and registers the attempt', async () => {
    const fetchSpy = mockFetch([
      leadsRoute([lead({})]),
      {
        match: '/leads/l1/contact-attempts',
        data: [
          {
            id: 'ca1',
            leadId: 'l1',
            contactedWith: 'Recepção',
            channel: 'PHONE',
            outcome: 'ATTEMPTED',
            occurredAt: '2026-02-01T10:00:00.000Z',
            note: null,
          },
        ],
      },
      {
        method: 'POST',
        match: '/leads/l1/contact-attempts',
        data: { lead: lead({}), attempt: {} },
      },
    ])
    renderBoard()
    await openLead('Ana Lima')

    expect(
      await screen.findByText(
        'Para avançar: registre a primeira tentativa de contato.',
      ),
    ).toBeTruthy()
    // Previous attempts are listed in the history.
    expect(await screen.findByText('Recepção')).toBeTruthy()

    fireEvent.click(
      screen.getByText('Registrar contato', { selector: 'button' }),
    )
    expect(notify.error).toHaveBeenCalledWith(
      'Informe com quem falou ou tentou falar',
    )

    type('Com quem falou/tentou falar', ' Ana ')
    type('Observação', 'Retornar amanhã')
    fireEvent.click(
      screen.getByText('Registrar contato', { selector: 'button' }),
    )

    await waitFor(() =>
      expect(notify.success).toHaveBeenCalledWith('Contato registrado'),
    )
    expect(fetchBody(fetchSpy, '/leads/l1/contact-attempts')).toMatchObject({
      leadId: 'l1',
      contactedWith: 'Ana',
      channel: 'WHATSAPP',
      outcome: 'ATTEMPTED',
      note: 'Retornar amanhã',
    })
  })

  it('QUALIFIED: requires decision maker name and role', async () => {
    const fetchSpy = mockFetch([
      leadsRoute([lead({ stage: 'QUALIFIED' })]),
      { method: 'PUT', match: '/leads/l1/qualification', data: {} },
    ])
    renderBoard()
    await openLead('Ana Lima')

    fireEvent.click(await screen.findByText('Confirmar qualificação'))
    expect(notify.error).toHaveBeenCalledWith(
      'Informe o nome e o cargo do decisor',
    )

    type('Nome do decisor', 'Paula')
    type('Cargo do decisor', 'CFO')
    type('Previsão de fechamento', '2026-12-01')
    fireEvent.click(screen.getByText('Confirmar qualificação'))

    await waitFor(() =>
      expect(notify.success).toHaveBeenCalledWith('Lead qualificado'),
    )
    expect(fetchBody(fetchSpy, '/leads/l1/qualification', 'PUT')).toMatchObject(
      {
        decisionMakerName: 'Paula',
        decisionMakerRole: 'CFO',
        expectedCloseAt: '2026-12-01',
      },
    )
  })

  it('OPPORTUNITY: blocks the proposal until a meeting exists', async () => {
    const fetchSpy = mockFetch([
      leadsRoute([lead({ stage: 'OPPORTUNITY' })]),
      { match: '/leads/l1/meetings', data: [] },
    ])
    renderBoard()
    await openLead('Ana Lima')

    const createProposal = (await screen.findByText(
      'Criar e avançar para Proposta',
    )) as HTMLButtonElement
    expect(createProposal.disabled).toBe(true)
    expect(field('Nome da proposta').value).toBe('Proposta Ana Lima')

    fireEvent.click(
      screen.getByText('Registrar reunião', { selector: 'button' }),
    )
    expect(notify.error).toHaveBeenCalledWith(
      'Preencha data, interesse e necessidade identificada',
    )
    expect(
      fetchSpy.mock.calls.some(([, init]) => init?.method === 'POST'),
    ).toBe(false)
  })

  it('OPPORTUNITY: creates the proposal once a meeting is registered', async () => {
    const fetchSpy = mockFetch([
      leadsRoute([lead({ stage: 'OPPORTUNITY' })]),
      { match: '/leads/l1/meetings', data: [{ id: 'm1' }] },
      { method: 'POST', match: '/leads/l1/proposal', data: { id: 'pr1' } },
    ])
    renderBoard()
    await openLead('Ana Lima')

    expect(
      await screen.findByText('1 reunião(ões) registrada(s).'),
    ).toBeTruthy()
    type('Nome da proposta', '   ')
    fireEvent.click(screen.getByText('Criar e avançar para Proposta'))
    expect(notify.error).toHaveBeenCalledWith('Informe o nome da proposta')

    type('Nome da proposta', 'Proposta Lima 2026')
    fireEvent.click(screen.getByText('Criar e avançar para Proposta'))

    await waitFor(() =>
      expect(notify.success).toHaveBeenCalledWith('Proposta criada'),
    )
    expect(fetchBody(fetchSpy, '/leads/l1/proposal')).toMatchObject({
      name: 'Proposta Lima 2026',
    })
  })

  it('PROPOSAL: closes as won only after a presentation, with required fields', async () => {
    const fetchSpy = mockFetch([
      leadsRoute([lead({ stage: 'PROPOSAL' })]),
      {
        match: /\/leads\/l1\/proposal$/,
        data: {
          id: 'pr1',
          title: 'Proposta Lima',
          path: '/crm/documents/pr1',
        },
      },
      { match: '/proposal/pr1/presentations', data: [{ id: 'pp1' }] },
      { method: 'POST', match: '/leads/l1/close-won', data: {} },
    ])
    renderBoard()
    await openLead('Ana Lima')

    expect(
      await screen.findByText('1 apresentação(ões) registrada(s).'),
    ).toBeTruthy()
    expect(screen.getByText('Proposta Lima')).toBeTruthy()
    expect(
      screen.getByText('Editar proposta').closest('a')?.getAttribute('href'),
    ).toContain('/crm/documents/pr1/edit')
    const closeWon = screen.getByText(
      'Confirmar contrato assinado — Ganho',
    ) as HTMLButtonElement
    expect(closeWon.disabled).toBe(false)

    fireEvent.click(closeWon)
    expect(notify.error).toHaveBeenCalledWith(
      'Preencha a data de assinatura e o valor fechado',
    )

    type('Data da assinatura do contrato', '2026-09-01')
    type('Valor fechado (R$)', '12000')
    fireEvent.click(closeWon)

    await waitFor(() =>
      expect(notify.success).toHaveBeenCalledWith(
        'Negócio fechado como ganho — lead convertido em pessoa',
      ),
    )
    expect(fetchBody(fetchSpy, '/leads/l1/close-won')).toMatchObject({
      leadId: 'l1',
      billingType: 'MONTHLY',
      closedAmount: 12000,
      contractSignedConfirmed: true,
    })
  })

  it('PROPOSAL: disables closing as won without presentations', async () => {
    mockFetch([
      leadsRoute([lead({ stage: 'PROPOSAL' })]),
      { match: /\/leads\/l1\/proposal$/, data: { id: 'pr1' } },
      { match: '/proposal/pr1/presentations', data: [] },
    ])
    renderBoard()
    await openLead('Ana Lima')

    const closeWon = (await screen.findByText(
      'Confirmar contrato assinado — Ganho',
    )) as HTMLButtonElement
    expect(closeWon.disabled).toBe(true)

    fireEvent.click(
      screen.getByText('Registrar apresentação', { selector: 'button' }),
    )
    expect(notify.error).toHaveBeenCalledWith(
      'Preencha data e valor da proposta',
    )
  })

  it('marks a lead as lost with a mandatory reason and closes the panel', async () => {
    const fetchSpy = mockFetch([
      leadsRoute([lead({ stage: 'QUALIFIED' })]),
      { method: 'POST', match: '/leads/l1/close-lost', data: lead({}) },
    ])
    renderBoard()
    await openLead('Ana Lima')

    fireEvent.click(await screen.findByText('Marcar como perdido'))
    fireEvent.click(screen.getByText('Confirmar perda'))
    expect(notify.error).toHaveBeenCalledWith('Informe o motivo da perda')

    fireEvent.change(screen.getByPlaceholderText('Motivo da perda'), {
      target: { value: 'Sem orçamento' },
    })
    fireEvent.click(screen.getByText('Confirmar perda'))

    await waitFor(() =>
      expect(notify.success).toHaveBeenCalledWith('Lead marcado como perdido'),
    )
    expect(fetchBody(fetchSpy, `${LEAD_URL}/l1/close-lost`)).toEqual({
      leadId: 'l1',
      lostReason: 'Sem orçamento',
    })
    await waitFor(() =>
      expect(screen.queryByText('Confirmar qualificação')).toBeNull(),
    )
  })

  it('surfaces API errors from stage mutations', async () => {
    mockFetch([
      leadsRoute([lead({ stage: 'QUALIFIED' })]),
      {
        method: 'POST',
        match: '/leads/l1/close-lost',
        status: 422,
        error: 'Lead já encerrado',
      },
    ])
    renderBoard()
    await openLead('Ana Lima')

    fireEvent.click(await screen.findByText('Marcar como perdido'))
    fireEvent.change(screen.getByPlaceholderText('Motivo da perda'), {
      target: { value: 'Concorrente' },
    })
    fireEvent.click(screen.getByText('Confirmar perda'))

    await waitFor(() => expect(notify.error).toHaveBeenCalled())
    const [arg] = notify.error.mock.calls.at(-1) ?? []
    expect((arg as Error).message).toBe('Lead já encerrado')
  })

  it('CLOSED: shows the won summary without the lost action', async () => {
    mockFetch([
      leadsRoute([
        lead({
          stage: 'CLOSED',
          closeResult: 'WON',
          contractSignedAt: '2026-09-01T12:00:00.000Z',
          closedAmount: 12000,
          billingType: 'MONTHLY',
        }),
      ]),
    ])
    renderBoard()
    await openLead('Ana Lima')

    expect(await screen.findByText('Ganho')).toBeTruthy()
    expect(screen.getByText('Contrato assinado em 01/09/2026')).toBeTruthy()
    expect(screen.getByText('Negócio encerrado.')).toBeTruthy()
    expect(screen.queryByText('Marcar como perdido')).toBeNull()
  })

  it('CLOSED: shows the lost reason and retry date', async () => {
    mockFetch([
      leadsRoute([
        lead({
          stage: 'CLOSED',
          closeResult: 'LOST',
          lostReason: 'Sem orçamento',
          lostNote: 'Voltar no próximo ano',
          retryAt: '2027-01-15T12:00:00.000Z',
        }),
      ]),
    ])
    renderBoard()
    await openLead('Ana Lima')

    expect(await screen.findByText('Perdido')).toBeTruthy()
    expect(screen.getByText('Motivo: Sem orçamento')).toBeTruthy()
    expect(screen.getByText('Voltar no próximo ano')).toBeTruthy()
    expect(
      screen.getByText('Nova tentativa prevista para 15/01/2027'),
    ).toBeTruthy()
  })

  it('CLOSED/LOST: reopens the lead with a mandatory reason', async () => {
    const fetchSpy = mockFetch([
      leadsRoute([
        lead({ stage: 'CLOSED', closeResult: 'LOST', lostReason: 'Preço' }),
      ]),
      {
        match: '/crm/settings',
        data: {
          workspaceId: 'ws1',
          leadReopenStage: 'RECEIVED',
          proposalValidityDays: 15,
          notifyProposalExpiry: true,
          isDefault: true,
          updatedById: null,
          updatedAt: null,
        },
      },
      { match: '/leads/l1/reopenings', data: [] },
      {
        method: 'POST',
        match: '/leads/l1/reopen',
        data: lead({ stage: 'RECEIVED' }),
      },
    ])
    renderBoard()
    await openLead('Ana Lima')

    fireEvent.click(await screen.findByText('Reabrir lead'))
    expect(
      await screen.findByText(/O lead volta para "Lead recebido"/),
    ).toBeTruthy()

    fireEvent.click(screen.getByText('Confirmar reabertura'))
    expect(notify.error).toHaveBeenCalledWith('Informe o motivo da reabertura')

    fireEvent.change(
      screen.getByPlaceholderText(/cliente voltou a responder/i),
      { target: { value: '  Pediu nova proposta  ' } },
    )
    fireEvent.click(screen.getByText('Confirmar reabertura'))

    await waitFor(() =>
      expect(notify.success).toHaveBeenCalledWith(
        'Lead reaberto em "Lead recebido"',
      ),
    )
    expect(fetchBody(fetchSpy, `${LEAD_URL}/l1/reopen`)).toEqual({
      reason: 'Pediu nova proposta',
    })
  })

  it('CLOSED/WON: does not offer reopening', async () => {
    mockFetch([
      leadsRoute([lead({ stage: 'CLOSED', closeResult: 'WON' })]),
      { match: '/leads/l1/reopenings', data: [] },
    ])
    renderBoard()
    await openLead('Ana Lima')

    expect(await screen.findByText('Ganho')).toBeTruthy()
    expect(screen.queryByText('Reabrir lead')).toBeNull()
  })

  it('shows the reopening history of a lead', async () => {
    mockFetch([
      leadsRoute([lead({ stage: 'RECEIVED' })]),
      {
        match: '/leads/l1/reopenings',
        data: [
          {
            id: 'r1',
            leadId: 'l1',
            toStage: 'RECEIVED',
            reason: 'Cliente voltou',
            previousLostReason: 'Preço',
            previousLostNote: null,
            previousClosedAt: '2026-09-01T12:00:00.000Z',
            previousRetryAt: null,
            reopenedById: 'u1',
            createdAt: '2026-09-10T12:00:00.000Z',
          },
        ],
      },
    ])
    renderBoard()
    await openLead('Ana Lima')

    expect(await screen.findByText('Histórico de reaberturas')).toBeTruthy()
    expect(screen.getByText('Motivo: Cliente voltou')).toBeTruthy()
    expect(screen.getByText('Perda anterior: Preço (01/09/2026)')).toBeTruthy()
  })
})
