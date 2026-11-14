import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import {
  fetchBody,
  mockFetch,
  renderWithQuery,
} from '@/src/__tests__/component-utils'
import type {
  SdTicketSourceLinkDTO,
  SdTicketSourcePrefillDTO,
} from '@/types/sd-ticket-source'

vi.mock('@/lib/notify', () => ({
  notify: { success: vi.fn(), error: vi.fn() },
}))

import { CreateTicketFromSourceButton } from '../create-ticket-from-source-button'
import {
  SdConversationTicketsBar,
  SdLinkedTicketsSection,
} from '../sd-linked-tickets'

const WS = 'ws-1'
const BASE = `/api/workspaces/${WS}/servicedesk/tickets`

const ticket: SdTicketSourceLinkDTO = {
  id: 'tk1',
  number: 42,
  code: 'REQ-000042',
  title: 'Sem acesso ao sistema',
  type: 'SERVICE_REQUEST',
  phaseName: 'Em atendimento',
  phaseCategory: 'IN_PROGRESS',
  open: true,
  createdAt: '2026-11-13T17:05:00.000Z',
  href: '/acme/servicedesk/tickets/42',
}

const prefill: SdTicketSourcePrefillDTO = {
  source: 'conversation',
  sourceId: 'conv1',
  sourceLabel: 'Ana Souza',
  title: 'Ana Souza: não consigo acessar',
  descriptionPreview: 'Origem: Conversa do WhatsApp — Ana Souza',
  messageCount: 3,
  requester: { name: 'Ana Souza', phone: '(11) 98888-7777', email: null },
  contact: { id: 'ct1', name: 'Ana (contato)' },
  customer: null,
  openTickets: [],
  connectionNote: null,
}

const withServiceDesk = {
  match: '/ai/capabilities',
  data: { modules: ['SERVICE_DESK', 'CRM', 'COMMUNICATION'] },
}

describe('<CreateTicketFromSourceButton />', () => {
  it('renders nothing when the workspace has no ServiceDesk', async () => {
    const spy = mockFetch([
      { match: '/ai/capabilities', data: { modules: ['CRM'] } },
    ])
    renderWithQuery(
      <CreateTicketFromSourceButton
        workspaceId={WS}
        source='lead'
        sourceId='l1'
      />,
    )
    await waitFor(() => expect(spy).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: /criar chamado/i })).toBeNull()
  })

  it('opens the dialog with the prefill and creates the ticket', async () => {
    const spy = mockFetch([
      withServiceDesk,
      { match: `${BASE}/from-source?`, data: prefill },
      {
        method: 'POST',
        match: `${BASE}/from-source`,
        status: 201,
        data: { ticket, conversationLinked: true },
      },
    ])
    const user = userEvent.setup()
    renderWithQuery(
      <CreateTicketFromSourceButton
        workspaceId={WS}
        source='conversation'
        sourceId='conv1'
      />,
    )

    await user.click(
      await screen.findByRole('button', { name: /criar chamado/i }),
    )
    const title = await screen.findByLabelText(/título/i)
    expect((title as HTMLInputElement).value).toBe(prefill.title)

    const dialog = screen.getByRole('dialog')
    await user.click(
      within(dialog).getByRole('button', { name: 'Criar chamado' }),
    )
    await waitFor(() => {
      expect(spy.mock.calls.some((c) => c[1]?.method === 'POST')).toBe(true)
    })
    expect(fetchBody(spy, '/from-source')).toMatchObject({
      source: 'conversation',
      sourceId: 'conv1',
      type: 'SERVICE_REQUEST',
      title: prefill.title,
      includeMessages: true,
      allowDuplicate: false,
    })
  })

  it('asks for confirmation before duplicating an open ticket', async () => {
    mockFetch([
      withServiceDesk,
      {
        match: `${BASE}/from-source?`,
        data: { ...prefill, openTickets: [ticket] },
      },
    ])
    const user = userEvent.setup()
    renderWithQuery(
      <CreateTicketFromSourceButton
        workspaceId={WS}
        source='conversation'
        sourceId='conv1'
      />,
    )
    await user.click(
      await screen.findByRole('button', { name: /criar chamado/i }),
    )

    expect(await screen.findByText(/já existe chamado em aberto/i)).toBeTruthy()
    const submit = within(screen.getByRole('dialog')).getByRole('button', {
      name: 'Criar chamado',
    })
    expect((submit as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText(/confirme que quer criar outro/i)).toBeTruthy()
  })
})

describe('<SdConversationTicketsBar />', () => {
  it('lists the linked tickets with a link', async () => {
    mockFetch([
      withServiceDesk,
      { match: `${BASE}/by-source?`, data: [ticket] },
    ])
    renderWithQuery(
      <SdConversationTicketsBar workspaceId={WS} conversationId='conv1' />,
    )
    const link = await screen.findByRole('link', { name: /REQ-000042/ })
    expect(link.getAttribute('href')).toBe('/acme/servicedesk/tickets/42')
  })

  it('shows nothing without linked tickets', async () => {
    const spy = mockFetch([
      withServiceDesk,
      { match: `${BASE}/by-source?`, data: [] },
    ])
    const { container } = renderWithQuery(
      <SdConversationTicketsBar workspaceId={WS} conversationId='conv1' />,
    )
    await waitFor(() =>
      expect(
        spy.mock.calls.some((c) => String(c[0]).includes('/by-source')),
      ).toBe(true),
    )
    expect(container.textContent).toBe('')
  })
})

describe('<SdLinkedTicketsSection />', () => {
  it('shows the tickets and the create button', async () => {
    mockFetch([
      withServiceDesk,
      { match: `${BASE}/by-source?`, data: [ticket] },
    ])
    renderWithQuery(
      <SdLinkedTicketsSection workspaceId={WS} source='lead' sourceId='l1' />,
    )
    expect(await screen.findByText('Sem acesso ao sistema')).toBeTruthy()
    expect(screen.getByRole('button', { name: /criar chamado/i })).toBeTruthy()
  })

  it('shows an empty state', async () => {
    mockFetch([withServiceDesk, { match: `${BASE}/by-source?`, data: [] }])
    renderWithQuery(
      <SdLinkedTicketsSection workspaceId={WS} source='person' sourceId='p1' />,
    )
    expect(
      await screen.findByText(/nenhum chamado aberto a partir daqui/i),
    ).toBeTruthy()
  })

  it('hides itself when the viewer cannot see tickets', async () => {
    mockFetch([
      withServiceDesk,
      { match: `${BASE}/by-source?`, status: 403, error: 'Sem acesso' },
    ])
    const { container } = renderWithQuery(
      <SdLinkedTicketsSection workspaceId={WS} source='person' sourceId='p1' />,
    )
    await waitFor(() => expect(container.textContent).toBe(''))
  })
})
