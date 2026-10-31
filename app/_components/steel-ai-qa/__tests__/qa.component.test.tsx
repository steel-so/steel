import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  type FetchRoute,
  fetchBody,
  mockFetch,
  renderWithQuery,
} from '@/src/__tests__/component-utils'
import type {
  QaConfigDTO,
  QaCoachingDTO,
  QaReviewDTO,
} from '@/types/qa-review'
import { qaScoreTone, qaSkipReasonLabel } from '../qa-format'
import { QaCoachingPanel } from '../qa-coaching-panel'
import { QaReviewsList } from '../qa-reviews-list'
import { QaScoreBadge } from '../qa-score-badge'
import { QaSettings } from '../qa-settings'

const notify = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}))
vi.mock('@/lib/notify', () => ({ notify }))

const REVIEW: QaReviewDTO = {
  id: 'r1',
  subjectType: 'CONVERSATION',
  conversationId: 'c1',
  ticketId: null,
  subjectLabel: null,
  status: 'COMPLETED',
  handlerKind: 'HUMAN',
  agentUserId: 'u1',
  agentName: 'Carlos',
  customerName: 'Ana',
  score: 42,
  summary: 'Faltou resolver.',
  criteriaResults: [
    {
      key: 'resolution',
      name: 'Resolução',
      weight: 4,
      score: 40,
      evidence: 'Não resolveu',
    },
  ],
  coachingTips: ['Confirme o protocolo'],
  lowScore: true,
  skipReason: null,
  subjectEndedAt: '2026-11-03T12:00:00.000Z',
  reviewedAt: '2026-11-03T12:05:00.000Z',
  createdAt: '2026-11-03T12:00:00.000Z',
}

const COACHING: QaCoachingDTO = {
  from: '2026-10-04T00:00:00.000Z',
  to: '2026-11-03T00:00:00.000Z',
  reviews: 2,
  averageScore: 61,
  lowScoreCount: 1,
  humanAverage: 61,
  botAverage: null,
  agents: [
    {
      agentUserId: 'u1',
      agentName: 'Carlos',
      reviews: 2,
      averageScore: 61,
      lowScoreCount: 1,
      byCriterion: [
        { key: 'resolution', name: 'Resolução', average: 40 },
        { key: 'tone', name: 'Tom', average: 82 },
      ],
      weakestCriterion: { key: 'resolution', name: 'Resolução', average: 40 },
      trend: [
        { weekStart: '2026-10-26T00:00:00.000Z', average: 80, reviews: 1 },
        { weekStart: '2026-11-02T00:00:00.000Z', average: 42, reviews: 1 },
      ],
      topTips: [{ tip: 'Confirme o protocolo', count: 2 }],
      lowest: [REVIEW],
    },
  ],
}

const CONFIG: QaConfigDTO = {
  enabled: true,
  reviewConversations: true,
  reviewTickets: true,
  includeBots: true,
  minMessages: 4,
  lowScoreThreshold: 60,
  alertLowScore: true,
  criteria: [
    {
      key: 'tone',
      name: 'Tom',
      description: 'Cordial e claro',
      weight: 2,
      appliesTo: 'BOTH',
      active: true,
      position: 0,
    },
  ],
}

describe('format helpers', () => {
  it('maps scores to tones and reasons to pt-BR', () => {
    expect(qaScoreTone(95)).toBe('good')
    expect(qaScoreTone(70)).toBe('ok')
    expect(qaScoreTone(30)).toBe('low')
    expect(qaSkipReasonLabel('too_short')).toBe('Atendimento curto demais')
    expect(qaSkipReasonLabel('weird')).toBe('weird')
    expect(qaSkipReasonLabel(null)).toBe('—')
  })

  it('renders the score badge in every state', () => {
    const { rerender } = renderWithQuery(<QaScoreBadge score={null} />)
    expect(screen.getByText('—')).toBeTruthy()
    rerender(<QaScoreBadge score={95} />)
    expect(screen.getByText('95')).toBeTruthy()
    rerender(<QaScoreBadge score={50} lowScore />)
    expect(screen.getByText('50')).toBeTruthy()
    rerender(<QaScoreBadge score={70} />)
    expect(screen.getByText('70')).toBeTruthy()
  })
})

describe('<QaCoachingPanel />', () => {
  it('shows the agents, the weakest criterion and opens the worst review', async () => {
    mockFetch([
      { match: '/qa/coaching', data: COACHING },
      { match: '/qa/reviews/r1', data: REVIEW },
    ])
    renderWithQuery(<QaCoachingPanel workspaceId='ws1' />)

    expect(await screen.findByText('Carlos')).toBeTruthy()
    expect(screen.getByText('Ponto a melhorar:')).toBeTruthy()
    expect(screen.getByText('Confirme o protocolo')).toBeTruthy()
    expect(screen.getByLabelText('Evolução por semana')).toBeTruthy()

    // The customer name shows outside the worst-review button too, so go
    // through the button role.
    fireEvent.click(screen.getAllByRole('button', { name: /Ana/ })[0])
    expect(await screen.findByText('Avaliação do atendimento')).toBeTruthy()
    expect(await screen.findByText('Faltou resolver.')).toBeTruthy()
    expect(screen.getByText('Dicas para o atendente')).toBeTruthy()
  })

  it('explains an empty period', async () => {
    mockFetch([
      {
        match: '/qa/coaching',
        data: { ...COACHING, reviews: 0, agents: [], averageScore: null },
      },
    ])
    renderWithQuery(<QaCoachingPanel workspaceId='ws1' />)
    expect(await screen.findByText(/Nenhuma avaliação no período/)).toBeTruthy()
  })

  it('shows an error when the panel cannot load', async () => {
    mockFetch([{ match: '/qa/coaching', status: 500, error: 'falhou' }])
    renderWithQuery(<QaCoachingPanel workspaceId='ws1' />)
    expect(await screen.findByText(/Não foi possível carregar/)).toBeTruthy()
  })
})

describe('<QaReviewsList />', () => {
  it('lists reviews, filters the low scores and pages', async () => {
    const spy = mockFetch([
      {
        match: '/qa/reviews?',
        data: {
          items: [
            REVIEW,
            {
              ...REVIEW,
              id: 'r2',
              status: 'SKIPPED',
              score: null,
              skipReason: 'too_short',
              handlerKind: null,
              agentName: null,
              customerName: null,
              subjectType: 'TICKET',
              subjectLabel: '#7 Erro',
            },
          ],
          nextCursor: 'r2',
        },
      },
      { match: '/qa/reviews/r1', data: REVIEW },
    ])
    renderWithQuery(<QaReviewsList workspaceId='ws1' />)

    expect(await screen.findByText(/Ana/)).toBeTruthy()
    expect(screen.getByText(/Atendimento curto demais/)).toBeTruthy()

    fireEvent.click(screen.getByRole('switch', { name: 'Só notas baixas' }))
    await waitFor(() =>
      expect(
        spy.mock.calls.some(([url]) => String(url).includes('lowOnly=true')),
      ).toBe(true),
    )

    fireEvent.click(screen.getByText('Próxima'))
    await waitFor(() =>
      expect(
        spy.mock.calls.some(([url]) => String(url).includes('cursor=r2')),
      ).toBe(true),
    )
    fireEvent.click(screen.getByText('Anterior'))
  })

  it('opens the review from the notification link', async () => {
    mockFetch([
      { match: '/qa/reviews/r1', data: REVIEW },
      { match: '/qa/reviews?', data: { items: [], nextCursor: null } },
    ])
    renderWithQuery(<QaReviewsList workspaceId='ws1' initialReviewId='r1' />)
    expect(await screen.findByText('Faltou resolver.')).toBeTruthy()
    expect(screen.getByText('Nenhuma avaliação com esses filtros.')).toBeTruthy()
  })

  it('shows the error state', async () => {
    mockFetch([{ match: '/qa/reviews?', status: 500, error: 'x' }])
    renderWithQuery(<QaReviewsList workspaceId='ws1' />)
    expect(await screen.findByText(/Não foi possível carregar/)).toBeTruthy()
  })
})

describe('<QaSettings />', () => {
  const routes = (extra: FetchRoute[] = []): FetchRoute[] => [
    { match: '/qa/config', data: CONFIG },
    ...extra,
  ]

  it('saves the switches, limits and criteria', async () => {
    const spy = mockFetch(
      routes([{ method: 'PUT', match: '/qa/config', data: CONFIG }]),
    )
    renderWithQuery(<QaSettings workspaceId='ws1' canEdit />)

    fireEvent.click(
      await screen.findByRole('switch', {
        name: 'Incluir atendimentos só do bot',
      }),
    )
    fireEvent.click(screen.getByText('Novo critério'))
    expect(screen.getAllByLabelText('Nome do critério')).toHaveLength(2)
    fireEvent.click(screen.getByText('Salvar'))

    await waitFor(() => expect(notify.success).toHaveBeenCalled())
    const body = fetchBody(spy, '/qa/config', 'PUT') as QaConfigDTO
    expect(body.includeBots).toBe(false)
    expect(body.criteria).toHaveLength(2)
    expect(body.criteria[0]).not.toHaveProperty('position')
  })

  it('removes a criterion and blocks saving without an active one', async () => {
    mockFetch(routes())
    renderWithQuery(<QaSettings workspaceId='ws1' canEdit />)
    await screen.findByLabelText('Nome do critério')
    fireEvent.click(screen.getByRole('switch', { name: 'Critério ativo' }))
    expect(screen.getByText('Mantenha ao menos um critério ativo.')).toBeTruthy()
    expect(screen.getByText('Salvar').closest('button')?.disabled).toBe(true)
    fireEvent.click(screen.getByLabelText('Remover critério'))
    expect(screen.queryByLabelText('Nome do critério')).toBeNull()
  })

  it('reports a save failure', async () => {
    mockFetch(
      routes([
        { method: 'PUT', match: '/qa/config', status: 422, error: 'Inválido' },
      ]),
    )
    renderWithQuery(<QaSettings workspaceId='ws1' canEdit />)
    fireEvent.click(await screen.findByText('Salvar'))
    await waitFor(() => expect(notify.error).toHaveBeenCalledWith('Inválido'))
  })

  it('is read-only for non-managers', async () => {
    mockFetch(routes())
    renderWithQuery(<QaSettings workspaceId='ws1' canEdit={false} />)
    expect(await screen.findByText(/Só o dono e os administradores/)).toBeTruthy()
    expect(screen.queryByText('Salvar')).toBeNull()
    expect(
      (screen.getByLabelText('Nome do critério') as HTMLInputElement).disabled,
    ).toBe(true)
  })

  it('shows an error when the config cannot load', async () => {
    mockFetch([{ match: '/qa/config', status: 500, error: 'x' }])
    renderWithQuery(<QaSettings workspaceId='ws1' canEdit />)
    expect(await screen.findByText(/Não foi possível carregar/)).toBeTruthy()
  })
})
