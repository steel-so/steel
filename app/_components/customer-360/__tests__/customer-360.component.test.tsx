import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  fetchBody,
  mockFetch,
  renderWithQuery,
} from '@/src/__tests__/component-utils'
import type { Customer360DTO } from '@/types/customer-360'
import { Customer360Panel } from '../customer-360-panel'
import { CustomerContactButtons } from '../customer-contact-buttons'
import { TicketCrmCardBody } from '../ticket-crm-card'
import { ZapContextPanel } from '../zap-context-panel'

const push = vi.hoisted(() => vi.fn())
const notify = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}))
vi.mock('@/lib/notify', () => ({ notify }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }),
}))
vi.mock('@/src/hooks/use-user', () => ({
  useUser: () => ({ data: { pabxExtension: null, pabxDeviceId: null } }),
}))

beforeEach(() => {
  vi.clearAllMocks()
})

const WS = 'ws1'
const SLUG = 'acme'
const API = `/api/workspaces/${WS}`

const DATA: Customer360DTO = {
  match: 'phone',
  available: { crm: true, servicedesk: true, whatsapp: true },
  person: {
    id: 'p1',
    name: 'Ana Souza',
    jobTitle: 'Diretora',
    emails: ['ana@acme.com'],
    phones: ['5511988887777'],
    companyId: 'c1',
  },
  company: {
    id: 'c1',
    name: 'Acme Ltda',
    cnpj: null,
    arr: 120000,
    accountOwnerId: 'u1',
    accountOwnerName: 'Bia Lima',
  },
  health: {
    level: 'HIGH',
    levelLabel: 'Risco alto',
    riskScore: 80,
    healthScore: 20,
    nextActionLabel: 'Ligar hoje',
    computedAt: '2026-11-13T12:00:00.000Z',
  },
  opportunities: [
    {
      id: 'o1',
      name: 'Renovação anual',
      amount: 5000,
      stageName: 'Negociação',
      stageCategory: 'OPEN',
      pipelineName: 'Vendas',
      ownerName: null,
      closeDate: null,
      updatedAt: '2026-11-10T12:00:00.000Z',
    },
  ],
  leads: [
    {
      id: 'l1',
      name: 'Lead aberto',
      stage: 'IN_CONTACT',
      ownerName: null,
      createdAt: '2026-11-01T12:00:00.000Z',
    },
  ],
  tickets: [
    {
      id: 't1',
      number: 42,
      title: 'Sem internet',
      type: 'INCIDENT',
      phaseName: 'Em andamento',
      phaseCategory: 'IN_PROGRESS',
      priorityName: 'Alta',
      open: true,
      slaBreached: true,
      resolutionDueAt: null,
      csatScore: null,
      createdAt: '2026-11-12T12:00:00.000Z',
    },
  ],
  openTickets: 1,
  conversations: [
    {
      id: 'cv1',
      contactName: 'Ana Souza',
      contactPhone: '5511988887777',
      status: 'IN_PROGRESS',
      connectionLabel: 'Oficial',
      lastMessageAt: '2026-11-13T11:00:00.000Z',
    },
  ],
  calls: [
    {
      id: 'k1',
      direction: 'OUTBOUND',
      status: 'COMPLETED',
      durationSeconds: 125,
      summary: null,
      conversationId: 'cv1',
      createdAt: '2026-11-12T10:00:00.000Z',
    },
  ],
  documents: [
    {
      id: 'd1',
      title: 'Proposta comercial',
      kind: 'PROPOSAL',
      status: 'SENT',
      totalValue: 5000,
      updatedAt: '2026-11-11T10:00:00.000Z',
    },
  ],
}

const EMPTY: Customer360DTO = {
  ...DATA,
  match: 'none',
  person: null,
  company: null,
  health: null,
  opportunities: [],
  leads: [],
  tickets: [],
  openTickets: 0,
  conversations: [],
  calls: [],
  documents: [],
}

describe('Customer360Panel', () => {
  it('shows the customer across the three modules', async () => {
    mockFetch([{ match: `${API}/customer-360?`, data: DATA }])
    renderWithQuery(
      <Customer360Panel workspaceId={WS} slug={SLUG} personId='p1' />,
    )
    expect(await screen.findByText('Acme Ltda')).toBeTruthy()
    expect(screen.getByText(/Risco alto · saúde 20\/100/)).toBeTruthy()
    expect(screen.getByText('Bia Lima')).toBeTruthy()
    expect(screen.getByText('Renovação anual')).toBeTruthy()
    expect(screen.getByText(/#42 · Sem internet/)).toBeTruthy()
    expect(screen.getByText('SLA estourado')).toBeTruthy()
    expect(screen.getByText('Proposta comercial')).toBeTruthy()
    expect(screen.getByText('Lead aberto')).toBeTruthy()
    expect(screen.getByText(/Cadastro encontrado pelo telefone/)).toBeTruthy()
    expect(screen.getByText(/Próxima ação sugerida: Ligar hoje/)).toBeTruthy()
    expect(
      screen
        .getAllByRole('link')
        .some(
          (a) => a.getAttribute('href') === `/${SLUG}/servicedesk/tickets/42`,
        ),
    ).toBe(true)
  })

  it('says what is empty and leaves out modules the user cannot see', async () => {
    mockFetch([
      {
        match: `${API}/customer-360?`,
        data: {
          ...EMPTY,
          available: { crm: true, servicedesk: false, whatsapp: false },
        },
      },
    ])
    renderWithQuery(
      <Customer360Panel workspaceId={WS} slug={SLUG} companyId='c1' />,
    )
    expect(
      await screen.findByText('Nenhuma oportunidade para este cliente.'),
    ).toBeTruthy()
    expect(screen.queryByText('Chamados')).toBeNull()
    expect(screen.queryByText('Conversas no WhatsApp')).toBeNull()
  })

  it('stays quiet when the user has no access', async () => {
    const spy = mockFetch([
      { match: `${API}/customer-360?`, status: 403, error: 'Sem acesso' },
    ])
    const { container } = renderWithQuery(
      <Customer360Panel workspaceId={WS} slug={SLUG} personId='p1' />,
    )
    await waitFor(() => expect(spy).toHaveBeenCalled())
    await waitFor(() => expect(container.textContent).toBe(''))
  })

  it('offers a retry on a server failure', async () => {
    mockFetch([
      {
        match: `${API}/customer-360?`,
        status: 500,
        error: 'Falha no servidor',
      },
    ])
    renderWithQuery(
      <Customer360Panel workspaceId={WS} slug={SLUG} personId='p1' />,
    )
    expect(await screen.findByText('Falha no servidor')).toBeTruthy()
    expect(
      screen.getByRole('button', { name: 'Tentar novamente' }),
    ).toBeTruthy()
  })
})

describe('TicketCrmCardBody', () => {
  it('summarizes the account for the agent', () => {
    renderWithQuery(<TicketCrmCardBody data={DATA} slug={SLUG} />)
    expect(screen.getByText('Acme Ltda')).toBeTruthy()
    expect(screen.getByText('Bia Lima')).toBeTruthy()
    expect(screen.getByText('1 oportunidade aberta')).toBeTruthy()
    expect(screen.getByText(/Atenção: Ligar hoje/)).toBeTruthy()
    expect(
      screen.getByRole('link', { name: 'Abrir no CRM' }).getAttribute('href'),
    ).toBe(`/${SLUG}/crm/companies`)
  })

  it('works for a person without a company', () => {
    renderWithQuery(
      <TicketCrmCardBody
        data={{ ...DATA, company: null, health: null, opportunities: [] }}
        slug={SLUG}
      />,
    )
    expect(screen.getByText('Ana Souza', { selector: 'span' })).toBeTruthy()
    expect(
      screen.getByRole('link', { name: 'Abrir no CRM' }).getAttribute('href'),
    ).toBe(`/${SLUG}/crm/people`)
  })
})

describe('ZapContextPanel', () => {
  const conversation = {
    id: 'cv1',
    contactName: 'Ana Souza',
    contactWaId: '5511988887777',
  }

  it('asks the API about the conversation and lists the context', async () => {
    const spy = mockFetch([{ match: `${API}/customer-360?`, data: DATA }])
    renderWithQuery(
      <ZapContextPanel
        workspaceId={WS}
        slug={SLUG}
        conversation={conversation}
      />,
    )
    expect(await screen.findByText('Diretora')).toBeTruthy()
    expect(String(spy.mock.calls[0]?.[0])).toContain('conversationId=cv1')
    expect(screen.getByText('Renovação anual')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Criar lead/ })).toBeNull()
  })

  it('creates a lead for a contact that is not in the CRM yet', async () => {
    const spy = mockFetch([
      { match: `${API}/customer-360?`, data: EMPTY },
      { method: 'POST', match: `${API}/crm/leads`, data: { id: 'l9' } },
    ])
    renderWithQuery(
      <ZapContextPanel
        workspaceId={WS}
        slug={SLUG}
        conversation={conversation}
      />,
    )
    fireEvent.click(await screen.findByRole('button', { name: /Criar lead/ }))
    await waitFor(() =>
      expect(notify.success).toHaveBeenCalledWith('Lead criado no CRM.'),
    )
    expect(fetchBody(spy, `${API}/crm/leads`)).toMatchObject({
      name: 'Ana Souza',
      phones: ['5511988887777'],
      source: 'WhatsApp',
    })
  })

  it('creates an opportunity and a task linked to the customer', async () => {
    const spy = mockFetch([
      { match: `${API}/customer-360?`, data: DATA },
      { method: 'POST', match: `${API}/crm/opportunities`, data: { id: 'o9' } },
      { method: 'POST', match: `${API}/crm/tasks`, data: { id: 'k9' } },
    ])
    renderWithQuery(
      <ZapContextPanel
        workspaceId={WS}
        slug={SLUG}
        conversation={conversation}
      />,
    )
    fireEvent.click(
      await screen.findByRole('button', { name: /Criar oportunidade/ }),
    )
    const submit = screen.getByRole('button', {
      name: 'Criar',
    }) as HTMLButtonElement
    expect(submit.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Nome da oportunidade'), {
      target: { value: 'Upgrade de plano' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Criar' }))
    await waitFor(() =>
      expect(notify.success).toHaveBeenCalledWith('Oportunidade criada.'),
    )
    expect(fetchBody(spy, `${API}/crm/opportunities`)).toMatchObject({
      name: 'Upgrade de plano',
      companyId: 'c1',
      pointOfContactId: 'p1',
    })

    fireEvent.click(screen.getByRole('button', { name: /Criar tarefa/ }))
    fireEvent.change(screen.getByLabelText('O que precisa ser feito'), {
      target: { value: 'Retornar amanhã' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Criar' }))
    await waitFor(() =>
      expect(notify.success).toHaveBeenCalledWith('Tarefa criada.'),
    )
    expect(fetchBody(spy, `${API}/crm/tasks`)).toMatchObject({
      title: 'Retornar amanhã',
      personId: 'p1',
      companyId: 'c1',
    })
  })

  it('shows the server message when an action fails, and cancels the form', async () => {
    mockFetch([
      { match: `${API}/customer-360?`, data: DATA },
      {
        method: 'POST',
        match: `${API}/crm/tasks`,
        status: 422,
        error: 'Título inválido',
      },
    ])
    renderWithQuery(
      <ZapContextPanel
        workspaceId={WS}
        slug={SLUG}
        conversation={conversation}
      />,
    )
    fireEvent.click(await screen.findByRole('button', { name: /Criar tarefa/ }))
    fireEvent.change(screen.getByLabelText('O que precisa ser feito'), {
      target: { value: 'x' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Criar' }))
    await waitFor(() => expect(notify.error).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(screen.queryByLabelText('O que precisa ser feito')).toBeNull()
  })

  it('explains when the CRM context is not available to the user', async () => {
    mockFetch([
      { match: `${API}/customer-360?`, status: 403, error: 'Sem acesso' },
    ])
    renderWithQuery(
      <ZapContextPanel
        workspaceId={WS}
        slug={SLUG}
        conversation={conversation}
      />,
    )
    expect(
      await screen.findByText(/não está disponível para você/),
    ).toBeTruthy()
  })
})

describe('CustomerContactButtons', () => {
  const caps = (modules: string[]) => ({
    match: `${API}/ai/capabilities`,
    data: { modules },
  })

  it('stays hidden without the Comunicação module', async () => {
    const spy = mockFetch([caps(['CRM'])])
    const { container } = renderWithQuery(
      <CustomerContactButtons
        workspaceId={WS}
        slug={SLUG}
        target={{ personId: 'p1' }}
      />,
    )
    await waitFor(() => expect(spy).toHaveBeenCalled())
    await waitFor(() => expect(container.textContent).toBe(''))
  })

  it('opens the conversation of the record', async () => {
    const spy = mockFetch([
      caps(['CRM', 'COMMUNICATION']),
      {
        method: 'POST',
        match: `${API}/customer-360/whatsapp`,
        data: { conversationId: 'cv7', contactId: 'w1', phone: '119' },
      },
    ])
    renderWithQuery(
      <CustomerContactButtons
        workspaceId={WS}
        slug={SLUG}
        target={{ opportunityId: 'o1' }}
      />,
    )
    fireEvent.click(await screen.findByRole('button', { name: 'WhatsApp' }))
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith(`/${SLUG}/zap?conversa=cv7`),
    )
    expect(fetchBody(spy, `${API}/customer-360/whatsapp`)).toEqual({
      opportunityId: 'o1',
    })
  })

  it('tells what to do when the workspace has no connected number', async () => {
    mockFetch([
      caps(['COMMUNICATION']),
      {
        method: 'POST',
        match: `${API}/customer-360/whatsapp`,
        handler: () =>
          new Response(
            JSON.stringify({
              success: false,
              statusCode: 404,
              message: 'Conexão não encontrada',
              error: { code: 'WHATSAPP_CONNECTION_NOT_FOUND' },
            }),
            { status: 404, headers: { 'content-type': 'application/json' } },
          ),
      },
    ])
    renderWithQuery(
      <CustomerContactButtons
        workspaceId={WS}
        slug={SLUG}
        target={{ companyId: 'c1' }}
      />,
    )
    fireEvent.click(await screen.findByRole('button', { name: 'WhatsApp' }))
    await waitFor(() =>
      expect(notify.error).toHaveBeenCalledWith(
        expect.stringContaining('Nenhum número de WhatsApp conectado'),
      ),
    )
    expect(push).not.toHaveBeenCalled()
  })

  it('shows the server message when opening fails', async () => {
    mockFetch([
      caps(['COMMUNICATION']),
      {
        method: 'POST',
        match: `${API}/customer-360/whatsapp`,
        status: 422,
        error: 'Este cadastro não tem telefone.',
      },
    ])
    renderWithQuery(
      <CustomerContactButtons
        workspaceId={WS}
        slug={SLUG}
        target={{ companyId: 'c1' }}
      />,
    )
    fireEvent.click(await screen.findByRole('button', { name: 'WhatsApp' }))
    await waitFor(() => expect(notify.error).toHaveBeenCalled())
    expect(notify.error.mock.calls[0]?.[0]).toBeInstanceOf(Error)
  })

  it('says why the buttons are off for a record without phone', async () => {
    mockFetch([caps(['COMMUNICATION'])])
    renderWithQuery(
      <CustomerContactButtons
        workspaceId={WS}
        slug={SLUG}
        target={{ personId: 'p1' }}
        hasPhone={false}
      />,
    )
    const button = (await screen.findByRole('button', {
      name: 'WhatsApp',
    })) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(button.title).toBe('Este cadastro não tem telefone')
  })

  it('asks for an extension before calling', async () => {
    mockFetch([caps(['COMMUNICATION'])])
    renderWithQuery(
      <CustomerContactButtons
        workspaceId={WS}
        slug={SLUG}
        target={{ personId: 'p1' }}
      />,
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Ligar' }))
    await waitFor(() =>
      expect(notify.error).toHaveBeenCalledWith(
        'Configure seu ramal e device no perfil para ligar.',
      ),
    )
  })
})
