import { screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { mockFetch, renderWithQuery } from '@/src/__tests__/component-utils'
import { DealRoomPanel } from '../deal-room-panel'

vi.mock('@/lib/notify', () => ({
  notify: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() },
}))

const ROOM = {
  id: 'r1',
  opportunityId: 'op1',
  enabled: true,
  token: 'tok',
  publicPath: '/sala/tok',
  title: null,
  welcomeMessage: null,
  proposalId: null,
  documentId: 'doc1',
  materials: [],
  actions: [],
  visitors: [],
  events: [],
  createdAt: '2026-10-01T12:00:00.000Z',
  updatedAt: '2026-10-01T12:00:00.000Z',
}

function routes(documents: unknown[], room = ROOM) {
  return [
    { match: '/opportunities/op1/room/messages', data: [] },
    { match: '/opportunities/op1/room', data: room },
    { match: '/crm/documents?', data: { items: documents } },
  ]
}

describe('<DealRoomPanel /> document of the room', () => {
  it('shows the linked document of the deal', async () => {
    const spy = mockFetch(
      routes([{ id: 'doc1', title: 'Proposta Acme 2027', status: 'SENT' }]),
    )
    renderWithQuery(
      <DealRoomPanel workspaceId='ws1' opportunityId='op1' canEdit />,
    )

    expect(await screen.findByText('Documento da sala')).toBeTruthy()
    expect(await screen.findByText('Proposta Acme 2027')).toBeTruthy()
    expect(
      screen.getByText('O cliente vê o documento depois que ele for enviado.'),
    ).toBeTruthy()
    const documentsCall = spy.mock.calls.find(([input]) =>
      String(input).includes('/crm/documents?'),
    )
    expect(String(documentsCall?.[0])).toContain('opportunityId=op1')
  })

  it('points to CRM > Documentos when the deal has no document', async () => {
    mockFetch(routes([], { ...ROOM, documentId: null }))
    renderWithQuery(
      <DealRoomPanel workspaceId='ws1' opportunityId='op1' canEdit />,
    )

    await waitFor(() =>
      expect(
        screen.getByText(
          'Crie a proposta em CRM > Documentos, vinculada a esta oportunidade.',
        ),
      ).toBeTruthy(),
    )
    expect(screen.getAllByText('Nenhum documento').length).toBeGreaterThan(0)
  })

  it('flags a linked document that is gone', async () => {
    mockFetch(routes([]))
    renderWithQuery(
      <DealRoomPanel workspaceId='ws1' opportunityId='op1' canEdit={false} />,
    )
    expect(await screen.findByText('Documento indisponível')).toBeTruthy()
  })
})
