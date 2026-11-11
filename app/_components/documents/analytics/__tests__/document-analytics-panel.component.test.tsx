import '@/src/__tests__/helpers/dom-matchers'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { mockFetch, renderWithQuery } from '@/src/__tests__/component-utils'
import type { DocumentAnalyticsDTO } from '@/types/document'
import {
  biggestDropOff,
  deviceLabel,
  formatDuration,
  formatSeenAt,
  visitorTag,
} from '../document-analytics-format'
import { barWidth, DocumentAnalyticsPanel } from '../document-analytics-panel'

vi.mock('@nivo/bar', () => ({
  ResponsiveBar: ({ ariaLabel }: { ariaLabel: string }) => (
    <div role='img' aria-label={ariaLabel} />
  ),
}))

function createFakeDocumentAnalyticsDTO(
  overrides: Partial<DocumentAnalyticsDTO> = {},
): DocumentAnalyticsDTO {
  return {
    totals: {
      sessions: 4,
      uniqueVisitors: 3,
      totalActiveMs: 240_000,
      avgActiveMs: 60_000,
      avgScrollPct: 72,
      completionRate: 0.5,
      revisits: 1,
      forwards: 1,
    },
    sections: [
      {
        id: 'sec-intro',
        name: 'Introdução',
        index: 0,
        totalActiveMs: 120_000,
        avgActiveMs: 30_000,
        readers: 4,
        reachRate: 1,
      },
      {
        id: 'sec-scope',
        name: 'Escopo',
        index: 1,
        totalActiveMs: 80_000,
        avgActiveMs: 26_667,
        readers: 3,
        reachRate: 0.75,
      },
      {
        id: 'sec-price',
        name: 'Investimento',
        index: 2,
        totalActiveMs: 40_000,
        avgActiveMs: 40_000,
        readers: 1,
        reachRate: 0.25,
      },
    ],
    devices: { desktop: 2, tablet: 0, mobile: 2, unknown: 0 },
    readers: [
      {
        recipientId: 'rcp-1',
        name: 'Maria Souza',
        visitorId: '3f9a1c2b-0000-4000-8000-000000000001',
        sessions: 2,
        activeMs: 150_000,
        device: 'mobile',
        lastSeenAt: '2026-11-11T17:32:00.000Z',
      },
      {
        recipientId: null,
        name: null,
        visitorId: 'a1b2c3d4-0000-4000-8000-000000000002',
        sessions: 1,
        activeMs: 90_000,
        device: 'desktop',
        lastSeenAt: '2026-11-10T12:00:00.000Z',
      },
    ],
    daily: [
      { date: '2026-11-10', sessions: 1, activeMs: 90_000 },
      { date: '2026-11-11', sessions: 3, activeMs: 150_000 },
    ],
    ...overrides,
  }
}

const WS = 'ws-1'
const DOC = 'doc-1'
const BASE = `/api/workspaces/${WS}/crm/documents/${DOC}/analytics`

function setup(
  data: DocumentAnalyticsDTO | null = createFakeDocumentAnalyticsDTO(),
  props: { isTemplate?: boolean } = {},
) {
  const spy = mockFetch([
    data
      ? { match: BASE, data }
      : { match: BASE, status: 500, error: 'Falhou ao carregar' },
  ])
  renderWithQuery(
    <DocumentAnalyticsPanel workspaceId={WS} documentId={DOC} {...props} />,
  )
  return spy
}

describe('DocumentAnalyticsPanel', () => {
  it('shows the reading KPIs, sections, devices and readers', async () => {
    setup()

    expect(await screen.findByText('Tempo total')).toBeInTheDocument()
    expect(screen.getByText('4 min')).toBeInTheDocument()
    expect(screen.getByText('1 min')).toBeInTheDocument()
    expect(screen.getByText('Chegaram ao fim').parentElement).toHaveTextContent(
      '50%',
    )
    expect(screen.getByText('Encaminhamentos')).toBeInTheDocument()

    const sections = screen.getByRole('list', {
      name: 'Tempo e alcance por seção',
    })
    expect(within(sections).getAllByRole('listitem')).toHaveLength(3)
    expect(within(sections).getByText('Investimento')).toBeInTheDocument()
    expect(screen.getByText(/A maior queda é entre/)).toHaveTextContent(
      'o alcance cai de 75% para 25%',
    )

    expect(
      screen.getByRole('img', { name: 'Sessões de leitura por dia' }),
    ).toBeInTheDocument()
    const devices = screen.getByRole('list', {
      name: 'Sessões por dispositivo',
    })
    expect(within(devices).getByText('Celular')).toBeInTheDocument()

    const table = screen.getByRole('table')
    expect(within(table).getByText('Maria Souza')).toBeInTheDocument()
    expect(within(table).getByText('Visitante anônimo')).toBeInTheDocument()
    expect(
      within(table).getByText(/Link pessoal · #3f9a1c/),
    ).toBeInTheDocument()
  })

  it('refetches with the chosen period', async () => {
    const spy = setup()
    await screen.findByText('Tempo total')

    fireEvent.click(screen.getByRole('tab', { name: '7 dias' }))

    await waitFor(() =>
      expect(
        spy.mock.calls.some(([url]) => String(url).endsWith(`${BASE}?days=7`)),
      ).toBe(true),
    )
    expect(screen.getByRole('tab', { name: '7 dias' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
  })

  it('explains the empty state before the first view', async () => {
    const empty = createFakeDocumentAnalyticsDTO({
      totals: {
        ...createFakeDocumentAnalyticsDTO().totals,
        sessions: 0,
      },
    })
    setup(empty)
    expect(
      await screen.findByText(/Ninguém abriu este documento ainda/),
    ).toBeInTheDocument()
  })

  it('explains the empty state of a template', async () => {
    const empty = createFakeDocumentAnalyticsDTO({
      totals: {
        ...createFakeDocumentAnalyticsDTO().totals,
        sessions: 0,
      },
    })
    setup(empty, { isTemplate: true })
    expect(
      await screen.findByText(/Nenhum documento criado a partir deste modelo/),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Soma dos documentos criados a partir deste modelo.'),
    ).toBeInTheDocument()
  })

  it('shows the error with a retry', async () => {
    const spy = setup(null)
    expect(await screen.findByText('Tentar de novo')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Tentar de novo'))
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2))
  })

  it('handles documents without sections or reading days', async () => {
    setup(
      createFakeDocumentAnalyticsDTO({
        sections: [],
        readers: [],
        daily: [{ date: '2026-11-11', sessions: 0, activeMs: 0 }],
      }),
    )
    expect(
      await screen.findByText(/Este documento ainda não tem seções/),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Nenhuma leitura neste período.'),
    ).toBeInTheDocument()
    expect(screen.getByText('Nenhum leitor neste período.')).toBeInTheDocument()
  })
})

describe('document analytics formatting', () => {
  it('formats durations in pt-BR', () => {
    expect(formatDuration(0)).toBe('0 s')
    expect(formatDuration(45_000)).toBe('45 s')
    expect(formatDuration(200_000)).toBe('3 min 20 s')
    expect(formatDuration(3_900_000)).toBe('1 h 05 min')
  })

  it('formats the last read in the CRM timezone', () => {
    expect(formatSeenAt('2026-11-11T17:32:00.000Z')).toMatch(/14:32/)
  })

  it('labels devices and visitors', () => {
    expect(deviceLabel('tablet')).toBe('Tablet')
    expect(deviceLabel(null)).toBe('Não identificado')
    expect(deviceLabel('tv')).toBe('Não identificado')
    expect(visitorTag('a1-b2-c3-d4')).toBe('#a1b2c3')
  })

  it('finds the biggest drop in reach of at least 10 points', () => {
    const { sections } = createFakeDocumentAnalyticsDTO()
    expect(biggestDropOff(sections)?.to.name).toBe('Investimento')
    expect(
      biggestDropOff(sections.map((s) => ({ ...s, reachRate: 1 }))),
    ).toBeNull()
  })

  it('sizes bars with a sliver for small values', () => {
    expect(barWidth(0, 10)).toBe('0%')
    expect(barWidth(5, 0)).toBe('0%')
    expect(barWidth(1, 1000)).toBe('1%')
    expect(barWidth(5, 10)).toBe('50%')
  })
})
