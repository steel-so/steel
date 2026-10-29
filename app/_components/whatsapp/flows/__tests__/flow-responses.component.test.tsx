import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { mockFetch, renderWithQuery } from '@/src/__tests__/component-utils'
import { flowFromPreset } from '@/src/lib/whatsapp/flows/templates'
import { FlowResponses } from '../flow-responses'

vi.setConfig({ testTimeout: 20_000 })

const URL_MATCH = '/api/workspaces/ws_1/whatsapp/flows/flow_1/responses'
const definition = flowFromPreset('SURVEY').definition

const row = (overrides = {}) => ({
  id: 'r1',
  flowId: 'flow_1',
  contactId: 'c1',
  contactName: 'Maria',
  contactWaId: '5511988887777',
  conversationId: 'conv_1',
  status: 'COMPLETED',
  answers: { nota: '5', pontos: ['rapidez'], comentario: 'Ótimo' },
  createdLeadId: 'lead_1',
  createdPersonId: null,
  createdCompanyId: null,
  mappingNote: null,
  sentAt: '2026-10-29T15:00:00.000Z',
  respondedAt: '2026-10-29T15:05:00.000Z',
  ...overrides,
})

const render = () =>
  renderWithQuery(
    <FlowResponses
      workspaceId='ws_1'
      flowId='flow_1'
      definition={definition}
    />,
  )

describe('<FlowResponses />', () => {
  it('shows the answers with option titles and the CRM records created', async () => {
    mockFetch([
      {
        match: URL_MATCH,
        data: { items: [row()], nextCursor: null },
      },
    ])
    render()
    expect(await screen.findByText('Maria')).toBeTruthy()
    expect(screen.getByText('Respondido')).toBeTruthy()
    expect(screen.getByText('5 - Excelente')).toBeTruthy()
    expect(screen.getByText('Rapidez')).toBeTruthy()
    expect(screen.getByText('Lead criado')).toBeTruthy()
    // Dates are shown in the Sao Paulo timezone.
    expect(screen.getByText(/29\/10\/2026,? 12:00/)).toBeTruthy()
  })

  it('shows pending sends, unanswered fields and mapping notes', async () => {
    mockFetch([
      {
        match: URL_MATCH,
        data: {
          items: [
            row({
              id: 'r2',
              status: 'SENT',
              answers: null,
              respondedAt: null,
              createdLeadId: null,
              contactName: null,
            }),
            row({
              id: 'r3',
              answers: {},
              createdLeadId: null,
              createdPersonId: 'p1',
              createdCompanyId: 'co1',
              mappingNote: 'Lead não criado: telefone inválido',
            }),
          ],
          nextCursor: null,
        },
      },
    ])
    render()
    expect(await screen.findByText('Aguardando resposta')).toBeTruthy()
    expect(screen.getByText('Aguardando')).toBeTruthy()
    expect(screen.getByText('Sem respostas')).toBeTruthy()
    expect(screen.getByText('Pessoa criada')).toBeTruthy()
    expect(screen.getByText('Empresa criada')).toBeTruthy()
    expect(screen.getByText(/telefone inválido/)).toBeTruthy()
  })

  it('shows the empty state', async () => {
    mockFetch([{ match: URL_MATCH, data: { items: [], nextCursor: null } }])
    render()
    expect(await screen.findByText(/Nenhum envio ainda/)).toBeTruthy()
  })

  it('shows an error', async () => {
    mockFetch([{ match: URL_MATCH, status: 500, error: 'falhou' }])
    render()
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Não foi possível carregar as respostas',
    )
  })

  it('pages forward and back with the cursor', async () => {
    const spy = mockFetch([
      {
        match: URL_MATCH,
        handler: (url) =>
          url.includes('cursor=r1')
            ? {
                items: [row({ id: 'r9', contactName: 'João' })],
                nextCursor: null,
              }
            : { items: [row()], nextCursor: 'r1' },
      },
    ])
    render()
    expect(await screen.findByText('Maria')).toBeTruthy()
    expect(
      (screen.getByRole('button', { name: 'Anterior' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'Próxima' }))
    expect(await screen.findByText('João')).toBeTruthy()
    expect(
      (screen.getByRole('button', { name: 'Próxima' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true)
    expect(
      spy.mock.calls.some(([url]) => String(url).includes('cursor=r1')),
    ).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'Anterior' }))
    await waitFor(() => expect(screen.getByText('Maria')).toBeTruthy())
  })
})
