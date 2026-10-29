import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { mockFetch, renderWithQuery } from '@/src/__tests__/component-utils'
import type { SdAiComparisonDTO } from '@/types/sd-ai-comparison'
import { SdAiComparisonPanel } from '../sd-ai-comparison-panel'

const WS = 'ws-1'
const SLUG = 'acme'

function panel(overrides: Partial<SdAiComparisonDTO> = {}): SdAiComparisonDTO {
  return {
    periodDays: 30,
    from: '2026-09-25T12:00:00.000Z',
    to: '2026-10-25T12:00:00.000Z',
    summary: {
      triaged: 12,
      settled: 9,
      awaitingReview: 3,
      accuracy: 78,
      corrections: 4,
      avgConfidence: 81,
    },
    fields: [
      {
        field: 'category',
        label: 'Categoria',
        compared: 9,
        matched: 7,
        corrected: 2,
        accuracy: 78,
      },
      {
        field: 'urgency',
        label: 'Urgência',
        compared: 0,
        matched: 0,
        corrected: 0,
        accuracy: null,
      },
    ],
    calibration: [
      {
        band: 'LOW',
        label: 'Confiança baixa (< 50%)',
        tickets: 0,
        accuracy: null,
      },
      {
        band: 'MEDIUM',
        label: 'Confiança média (50–79%)',
        tickets: 2,
        accuracy: 60,
      },
      {
        band: 'HIGH',
        label: 'Confiança alta (≥ 80%)',
        tickets: 7,
        accuracy: 85,
      },
    ],
    texts: [
      {
        kind: 'REPLY',
        label: 'Respostas sugeridas',
        total: 10,
        adopted: 3,
        edited: 4,
        notUsed: 2,
        pending: 1,
        usageRate: 78,
      },
      {
        kind: 'SOLUTION',
        label: 'Soluções sugeridas',
        total: 0,
        adopted: 0,
        edited: 0,
        notUsed: 0,
        pending: 0,
        usageRate: null,
      },
    ],
    agents: [
      {
        userId: 'u1',
        name: 'Ana Souza',
        suggestions: 10,
        used: 7,
        usageRate: 70,
      },
    ],
    preService: {
      conversations: 20,
      resolvedByKb: 8,
      ticketOpened: 9,
      abandoned: 1,
      open: 2,
      deflectionRate: 44,
    },
    usage: {
      calls: 55,
      costUsd: 0.4321,
      costPerUsedUsd: 0.0215,
      features: [
        {
          feature: 'SERVICEDESK_TRIAGE',
          label: 'Triagem do ServiceDesk',
          calls: 12,
          costUsd: 0.1,
        },
      ],
    },
    divergences: [
      {
        ticketId: 't1',
        code: 'INC-000007',
        title: 'Impressora parada',
        field: 'category',
        fieldLabel: 'Categoria',
        suggested: 'Rede',
        final: 'Hardware',
        appliedByAi: true,
        at: '2026-10-24T10:00:00.000Z',
      },
      {
        ticketId: 't2',
        code: 'INC-000008',
        title: 'Sem acesso',
        field: 'tags',
        fieldLabel: 'Tags',
        suggested: 'vpn',
        final: '—',
        appliedByAi: false,
        at: '2026-10-24T09:00:00.000Z',
      },
    ],
    ...overrides,
  }
}

const URL_RE = /servicedesk\/ai\/comparison\?days=/

describe('SdAiComparisonPanel', () => {
  it('shows the summary, the field accuracy and the divergences', async () => {
    mockFetch([{ match: URL_RE, data: panel() }])
    renderWithQuery(<SdAiComparisonPanel workspaceId={WS} slug={SLUG} />)

    expect(await screen.findByText('Precisão da classificação')).toBeTruthy()
    expect(screen.getByText('78%', { selector: 'p' })).toBeTruthy()
    expect(screen.getByText('9 chamados resolvidos conferidos')).toBeTruthy()
    expect(screen.getByText('3 aguardando o técnico')).toBeTruthy()
    // Fields without a sample are hidden from the accuracy table.
    // One row in the accuracy table, one in the divergences table.
    expect(screen.getAllByRole('cell', { name: 'Categoria' })).toHaveLength(2)
    expect(screen.queryByRole('cell', { name: 'Urgência' })).toBeNull()
    expect(screen.getByText('Ana Souza')).toBeTruthy()
    expect(screen.getByText('Taxa de desvio 44%')).toBeTruthy()
    expect(screen.getByText('Corrigido')).toBeTruthy()
    expect(screen.getByText('Divergente')).toBeTruthy()
    expect(
      screen
        .getByRole('link', { name: /Impressora parada/ })
        .getAttribute('href'),
    ).toBe('/acme/servicedesk/tickets/INC-000007')
  })

  it('reloads when the period changes', async () => {
    const spy = mockFetch([{ match: URL_RE, data: panel() }])
    renderWithQuery(<SdAiComparisonPanel workspaceId={WS} slug={SLUG} />)
    await screen.findByText('Precisão da classificação')
    expect(spy.mock.calls.at(-1)?.[0]).toContain('days=30')

    fireEvent.click(screen.getByRole('tab', { name: '7 dias' }))
    await waitFor(() => expect(spy.mock.calls.at(-1)?.[0]).toContain('days=7'))
  })

  it('explains the empty states', async () => {
    mockFetch([
      {
        match: URL_RE,
        data: panel({
          fields: [],
          texts: [],
          agents: [],
          divergences: [],
          usage: {
            calls: 0,
            costUsd: 0,
            costPerUsedUsd: null,
            features: [],
          },
          summary: {
            triaged: 0,
            settled: 0,
            awaitingReview: 0,
            accuracy: null,
            corrections: 0,
            avgConfidence: null,
          },
        }),
      },
    ])
    renderWithQuery(<SdAiComparisonPanel workspaceId={WS} slug={SLUG} />)

    expect(
      await screen.findByText(/Ainda não há chamados resolvidos/),
    ).toBeTruthy()
    expect(screen.getByText(/Nenhuma resposta ou solução/)).toBeTruthy()
    expect(screen.getByText('Nenhuma divergência neste período.')).toBeTruthy()
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
  })

  it('shows the server error', async () => {
    mockFetch([
      { match: URL_RE, status: 403, error: 'Esta tela é só para agentes' },
    ])
    renderWithQuery(<SdAiComparisonPanel workspaceId={WS} slug={SLUG} />)
    expect(await screen.findByText('Esta tela é só para agentes')).toBeTruthy()
  })
})
