import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useCanvasEditor } from '@/app/_components/canvas/editor-context'
import { CanvasStoreProvider } from '@/app/_components/canvas/use-canvas'
import { mockFetch, renderWithQuery } from '@/src/__tests__/component-utils'
import { createSiteDocument } from '@/src/__tests__/factories/site.factory'
import type { CanvasNode } from '@/src/lib/canvas/types'
import type {
  SiteExperimentDTO,
  SiteExperimentResultsDTO,
} from '@/types/site-experiment'
import { AbPanel as AbPanelInner, sectionOf } from '../experiments/ab-panel'
import { ExperimentResults } from '../experiments/experiment-results'
import { ExperimentSettingsDialog } from '../experiments/experiment-settings-dialog'
import {
  endsAtOf,
  formatProbability,
  formatUplift,
  goalLabel,
  scheduleLabel,
  startsAtOf,
} from '../experiments/format'
import { ExperimentPublishNotice } from '../experiments/publish-notice'
import { SiteExperiments } from '../experiments/site-experiments'
import { fakeSite, PAGES, renderInEditor, SITE_ID, WS } from './harness'

/** The panel reads the canvas store of the editor shell. */
function AbPanel() {
  const { store } = useCanvasEditor()
  return (
    <CanvasStoreProvider store={store}>
      <AbPanelInner />
    </CanvasStoreProvider>
  )
}

const BASE = `/api/workspaces/${WS}/crm/sites/${SITE_ID}`
const EXPERIMENTS = `${BASE}/experiments`

function results(
  overrides: Partial<SiteExperimentResultsDTO> = {},
): SiteExperimentResultsDTO {
  return {
    run: 1,
    variants: [
      {
        key: 'A',
        name: 'Original',
        visitors: 40,
        conversions: 2,
        rate: 0.05,
        uplift: null,
        probabilityToBeat: null,
      },
      {
        key: 'B',
        name: 'Variante B',
        visitors: 38,
        conversions: 5,
        rate: 0.1316,
        uplift: 1.63,
        probabilityToBeat: 0.91,
      },
    ],
    enoughData: false,
    winner: null,
    totals: { visitors: 78, conversions: 7 },
    minVisitorsPerVariant: 100,
    minConversions: 10,
    ...overrides,
  }
}

function experiment(
  overrides: Partial<SiteExperimentDTO> = {},
): SiteExperimentDTO {
  return {
    id: 'e1',
    siteId: SITE_ID,
    pageId: 'home',
    name: 'Hero com depoimentos',
    kind: 'SECTION',
    status: 'RUNNING',
    state: 'RUNNING',
    controlNodeId: 's1',
    variants: [
      { key: 'A', name: 'Original', weight: 50, nodeId: 's1' },
      { key: 'B', name: 'Variante B', weight: 50, nodeId: 's1b' },
    ],
    goal: { type: 'FORM' },
    startsAt: null,
    endsAt: null,
    run: 1,
    startedAt: '2026-10-10T12:00:00.000Z',
    endedAt: null,
    winnerKey: null,
    createdAt: '2026-10-10T12:00:00.000Z',
    updatedAt: '2026-10-10T12:00:00.000Z',
    results: results(),
    unpublishedVariants: [],
    ...overrides,
  }
}

const winning = results({
  enoughData: true,
  winner: 'B',
  variants: [
    {
      key: 'A',
      name: 'Original',
      visitors: 1000,
      conversions: 100,
      rate: 0.1,
      uplift: null,
      probabilityToBeat: null,
    },
    {
      key: 'B',
      name: 'Variante B',
      visitors: 1000,
      conversions: 150,
      rate: 0.15,
      uplift: 0.5,
      probabilityToBeat: 0.9997,
    },
  ],
})

describe('format helpers', () => {
  it('formats probabilities, uplift, goals and schedules', () => {
    expect(formatProbability(null)).toBe('—')
    expect(formatProbability(0.9999)).toBe('> 99,9%')
    expect(formatProbability(0.0001)).toBe('< 0,1%')
    expect(formatProbability(0.93)).toBe('93%')
    expect(formatUplift(null)).toBe('—')
    expect(formatUplift(0.25)).toBe('+25%')
    expect(goalLabel({ type: 'FORM' })).toBe('Envio de qualquer formulário')
    expect(
      goalLabel({ type: 'FORM', formToken: 't' }, { forms: { t: 'Contato' } }),
    ).toBe('Envio do formulário “Contato”')
    expect(goalLabel({ type: 'CLICK', nodeId: 'b', label: 'Comprar' })).toBe(
      'Clique em “Comprar”',
    )
    expect(goalLabel({ type: 'PAGE', pageId: 'p' })).toBe(
      'Chegar à página “escolhida”',
    )
    const tz = 'America/Sao_Paulo'
    const start = startsAtOf('2026-10-20', tz) as string
    const end = endsAtOf('2026-10-30', tz) as string
    expect(start).toBe('2026-10-20T03:00:00.000Z')
    expect(end).toBe('2026-10-31T03:00:00.000Z')
    expect(startsAtOf('', tz)).toBeNull()
    expect(scheduleLabel({ startsAt: start, endsAt: end }, tz)).toBe(
      'De 20 out a 30 out',
    )
    expect(scheduleLabel({ startsAt: start, endsAt: null }, tz)).toBe(
      'A partir de 20 out',
    )
    expect(scheduleLabel({ startsAt: null, endsAt: end }, tz)).toBe(
      'Até 30 out',
    )
    expect(scheduleLabel({ startsAt: null, endsAt: null }, tz)).toBeNull()
  })
})

describe('ExperimentResults', () => {
  it('shows the "not enough data" state with progress', () => {
    renderWithQuery(
      <ExperimentResults
        experiment={experiment()}
        canApply={false}
        onApply={vi.fn()}
      />,
    )
    const status = screen.getByTestId('experiment-not-enough-data')
    expect(status.textContent).toContain('Ainda sem dados suficientes')
    expect(within(status).getAllByRole('progressbar')).toHaveLength(2)
    expect(screen.getByRole('table').textContent).toContain('91%')
    expect(screen.queryByText('Aplicar vencedora')).toBeNull()
  })

  it('calls the winner and applies it', () => {
    const onApply = vi.fn()
    renderWithQuery(
      <ExperimentResults
        experiment={experiment({ results: winning })}
        canApply
        onApply={onApply}
      />,
    )
    expect(
      screen.getByText(
        'Variante B muito provavelmente converte mais que o original.',
      ),
    ).toBeTruthy()
    const row = screen.getByRole('row', { name: /Variante B/ })
    expect(row.textContent).toContain('Vencedora provável')
    expect(row.textContent).toContain('+50%')
    expect(row.textContent).toContain('> 99,9%')
    fireEvent.click(screen.getByTestId('apply-variant-B'))
    expect(onApply).toHaveBeenCalledWith('B')
    fireEvent.click(screen.getByTestId('apply-variant-A'))
    expect(onApply).toHaveBeenCalledWith('A')
  })

  it('names the original when it wins, or nobody on a close race', () => {
    const { rerender } = renderWithQuery(
      <ExperimentResults
        experiment={experiment({
          results: results({ enoughData: true, winner: 'A' }),
          winnerKey: 'A',
        })}
        canApply={false}
        onApply={vi.fn()}
      />,
    )
    expect(screen.getByText(/O original vence/)).toBeTruthy()
    expect(screen.getByText('Aplicada')).toBeTruthy()
    rerender(
      <ExperimentResults
        experiment={experiment({ results: results({ enoughData: true }) })}
        canApply={false}
        onApply={vi.fn()}
      />,
    )
    expect(screen.getByText(/Nenhuma variante se destacou/)).toBeTruthy()
  })
})

const served: { list: SiteExperimentDTO[] } = { list: [] }

describe('SiteExperiments screen', () => {
  function setup(
    list: SiteExperimentDTO[],
    extra: Parameters<typeof mockFetch>[0] = [],
  ) {
    served.list = list
    const spy = mockFetch([
      ...extra,
      // The list follows the mutations (refetched after each one).
      { match: new RegExp(`${EXPERIMENTS}$`), handler: () => served.list },
      {
        match: new RegExp(`${BASE}$`),
        data: fakeSite({ status: 'PUBLISHED' }),
      },
      { match: `${BASE}/pages`, data: PAGES },
      { match: `${BASE}/globals`, data: [] },
      { match: `/api/workspaces/${WS}/crm/forms`, data: [] },
    ])
    renderWithQuery(
      <SiteExperiments workspaceId={WS} slug='acme' siteId={SITE_ID} />,
    )
    return spy
  }

  it('explains A/B tests when there is none', async () => {
    setup([])
    expect(await screen.findByText('Nenhum teste A/B ainda')).toBeTruthy()
  })

  it('lists tests with their state, goal and results', async () => {
    setup([
      experiment(),
      experiment({
        id: 'e2',
        name: 'Página de preços',
        kind: 'PAGE',
        status: 'DRAFT',
        state: 'DRAFT',
        startedAt: null,
        controlNodeId: null,
        unpublishedVariants: ['B'],
        variants: [
          { key: 'A', name: 'Original', weight: 50, pageId: 'home' },
          { key: 'B', name: 'Variante B', weight: 50, pageId: 'sobre' },
        ],
        goal: { type: 'PAGE', pageId: 'contato' },
      }),
    ])
    const cards = await screen.findAllByTestId('experiment-card')
    expect(cards).toHaveLength(2)
    expect(cards[0].textContent).toContain('No ar')
    expect(cards[0].textContent).toContain('Seção · Início')
    expect(cards[0].textContent).toContain('Rodada 1 desde 10 out')
    expect(cards[1].textContent).toContain('Página inteira')
    expect(cards[1].textContent).toContain('Chegar à página “Contato”')
    expect(cards[1].textContent).toContain(
      'Publique o site para iniciar o teste: Variante B ainda não está no ar.',
    )
    expect(cards[1].textContent).toContain('Os resultados aparecem aqui')
  })

  it('starts, pauses and applies a winner', async () => {
    const spy = setup(
      [experiment({ status: 'DRAFT', state: 'DRAFT', results: winning })],
      [
        {
          method: 'POST',
          match: `${EXPERIMENTS}/e1/status`,
          handler: () => {
            served.list = [experiment({ results: winning })]
            return served.list[0]
          },
        },
        {
          method: 'POST',
          match: `${EXPERIMENTS}/e1/apply-winner`,
          handler: () => {
            served.list = [
              experiment({
                status: 'ENDED',
                state: 'ENDED',
                winnerKey: 'B',
                results: winning,
              }),
            ]
            return served.list[0]
          },
        },
      ],
    )
    fireEvent.click(await screen.findByTestId('experiment-start'))
    await waitFor(() =>
      expect(
        spy.mock.calls.some(
          ([url, init]) =>
            String(url).endsWith('/e1/status') &&
            (init as RequestInit).body === JSON.stringify({ action: 'start' }),
        ),
      ).toBe(true),
    )
    expect(await screen.findByTestId('experiment-pause')).toBeTruthy()

    fireEvent.click(screen.getByTestId('apply-variant-B'))
    fireEvent.click(await screen.findByTestId('experiment-apply-confirm'))
    expect(
      (await screen.findByTestId('experiment-applied')).textContent,
    ).toContain('Variante B foi aplicada ao rascunho')
  })

  it('creates a page test', async () => {
    const spy = setup(
      [],
      [
        {
          method: 'POST',
          match: new RegExp(`${EXPERIMENTS}$`),
          data: experiment({ id: 'e9', name: 'Novo', kind: 'PAGE' }),
        },
      ],
    )
    fireEvent.click(await screen.findByTestId('experiment-new'))
    const dialog = await screen.findByTestId('new-experiment')
    fireEvent.change(within(dialog).getByLabelText('Nome do teste'), {
      target: { value: 'Novo' },
    })
    fireEvent.click(within(dialog).getByRole('combobox', { name: 'Página' }))
    const option = await screen.findByRole('option', { name: 'Sobre' })
    // Base UI commits a mouse selection that started on the item itself.
    fireEvent.pointerDown(option, { pointerType: 'mouse' })
    fireEvent.click(option)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Criar teste' }))
    await waitFor(() => {
      const call = spy.mock.calls.find(
        ([url, init]) =>
          new RegExp(`${EXPERIMENTS}$`).test(String(url)) &&
          (init as RequestInit | undefined)?.method === 'POST',
      )
      expect(
        JSON.parse(((call as unknown[])[1] as RequestInit).body as string),
      ).toEqual({
        name: 'Novo',
        kind: 'PAGE',
        pageId: 'sobre',
        variantCount: 1,
        goal: { type: 'FORM' },
      })
    })
  })
})

describe('ExperimentSettingsDialog', () => {
  it('requires a 100% split and confirms a restart of a running test', async () => {
    let calls = 0
    const onSave = vi.fn(async () => {
      calls++
      if (calls === 1) {
        const { ApiError } = await import('@/src/hooks/_fetch')
        throw new ApiError('Reinicia', 'SITE_EXPERIMENT_RUNNING', 409)
      }
      return experiment()
    })
    mockFetch([
      {
        match: `${BASE}/pages/home`,
        data: { id: 'home', document: createSiteDocument() },
      },
      { match: `/api/workspaces/${WS}/crm/forms`, data: [] },
    ])
    const onOpenChange = vi.fn()
    renderWithQuery(
      <ExperimentSettingsDialog
        open
        onOpenChange={onOpenChange}
        workspaceId={WS}
        siteId={SITE_ID}
        timezone='America/Sao_Paulo'
        experiment={experiment()}
        pages={PAGES}
        onSave={onSave}
      />,
    )
    const dialog = await screen.findByTestId('experiment-settings')
    const save = within(dialog).getByRole('button', { name: 'Salvar' })
    fireEvent.change(
      within(dialog).getByLabelText('Tráfego da variante A (%)'),
      { target: { value: '70' } },
    )
    expect(within(dialog).getByRole('alert').textContent).toContain(
      'Total: 120% — precisa somar 100%',
    )
    expect((save as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(
      within(dialog).getByLabelText('Tráfego da variante B (%)'),
      { target: { value: '30' } },
    )
    expect((save as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(save)
    fireEvent.click(
      await screen.findByRole('button', { name: 'Salvar e reiniciar' }),
    )
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2))
    expect(onSave).toHaveBeenLastCalledWith(
      expect.objectContaining({
        restart: true,
        variants: [
          expect.objectContaining({ key: 'A', weight: 70 }),
          expect.objectContaining({ key: 'B', weight: 30 }),
        ],
        goal: { type: 'FORM' },
        startsAt: null,
        endsAt: null,
      }),
    )
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })
})

describe('AbPanel', () => {
  it('finds the section of a selected node', () => {
    const doc = {
      catalog: 'site',
      version: 1,
      rootId: 'root',
      nodes: {
        root: { id: 'root', type: 'site.page', props: {}, children: ['s1'] },
        s1: { id: 's1', type: 'site.section', props: {}, children: ['h1'] },
        h1: { id: 'h1', type: 'site.heading', props: {} },
      },
    }
    expect(sectionOf(doc, 'h1')).toBe('s1')
    expect(sectionOf(doc, 's1')).toBe('s1')
    expect(sectionOf(doc, 'root')).toBeNull()
    expect(sectionOf(doc, undefined)).toBeNull()
  })

  it('turns the selected section into a test with a variant B', async () => {
    const spy = mockFetch([
      {
        method: 'POST',
        match: new RegExp(`${EXPERIMENTS}$`),
        data: experiment({ status: 'DRAFT', state: 'DRAFT' }),
      },
      { match: new RegExp(`${EXPERIMENTS}$`), data: [] },
      { match: `${BASE}/pages`, data: PAGES },
    ])
    const { editor } = renderInEditor(<AbPanel />)
    const button = await screen.findByTestId('ab-test-section')
    expect((button as HTMLButtonElement).disabled).toBe(true)
    expect(
      screen.getByText('Selecione uma seção (ou algo dentro dela) no canvas.'),
    ).toBeTruthy()

    act(() => editor.store.select('h1'))
    await waitFor(() =>
      expect((button as HTMLButtonElement).disabled).toBe(false),
    )
    fireEvent.click(button)

    await waitFor(() => {
      const call = spy.mock.calls.find(
        ([url, init]) =>
          new RegExp(`${EXPERIMENTS}$`).test(String(url)) &&
          (init as RequestInit | undefined)?.method === 'POST',
      )
      expect(call).toBeDefined()
    })
    const { doc } = editor.store.getState()
    const children = doc.nodes[doc.rootId].children ?? []
    expect(children).toHaveLength(2)
    const variant = doc.nodes[children[1]] as CanvasNode
    expect(variant.meta).toMatchObject({ variantOf: 's1', variantKey: 'B' })
    const call = spy.mock.calls.find(
      ([url, init]) =>
        new RegExp(`${EXPERIMENTS}$`).test(String(url)) &&
        (init as RequestInit | undefined)?.method === 'POST',
    )
    expect(
      JSON.parse(((call as unknown[])[1] as RequestInit).body as string),
    ).toMatchObject({
      kind: 'SECTION',
      pageId: 'home',
      controlNodeId: 's1',
      variantNodeIds: [children[1]],
    })
  })

  it('lists the tests of the page and their variants', async () => {
    mockFetch([
      {
        match: new RegExp(`${EXPERIMENTS}$`),
        data: [
          experiment({
            status: 'DRAFT',
            state: 'DRAFT',
            variants: [
              { key: 'A', name: 'Original', weight: 50, nodeId: 's1' },
              { key: 'B', name: 'Variante B', weight: 50, nodeId: 'gone' },
            ],
          }),
          experiment({ id: 'other', pageId: 'sobre', name: 'Outra página' }),
        ],
      },
    ])
    const { editor } = renderInEditor(<AbPanel />)
    expect(await screen.findByText('Hero com depoimentos')).toBeTruthy()
    expect(screen.queryByText('Outra página')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'A · 50%' }))
    expect(editor.store.getState().selection).toEqual(['s1'])
    expect(
      (screen.getByRole('button', { name: 'B · 50%' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true)
    expect(screen.getByRole('button', { name: /Variante C/ })).toBeTruthy()
  })

  it('explains that tests run on pages', () => {
    mockFetch([{ match: new RegExp(`${EXPERIMENTS}$`), data: [] }])
    renderInEditor(<AbPanel />, { target: { kind: 'global', id: 'g' } })
    expect(screen.getByText(/Os testes A\/B rodam nas páginas/)).toBeTruthy()
  })
})

describe('ExperimentPublishNotice', () => {
  it('warns about the tests a publish restarts', () => {
    const { rerender } = renderWithQuery(
      <ExperimentPublishNotice impact={{ experiments: [] }} />,
    )
    expect(screen.queryByTestId('publish-experiments-notice')).toBeNull()
    rerender(
      <ExperimentPublishNotice
        impact={{
          experiments: [
            { id: 'e1', name: 'Hero', variants: ['B'] },
            { id: 'e2', name: 'Preços', variants: ['A'] },
          ],
        }}
      />,
    )
    expect(
      screen.getByTestId('publish-experiments-notice').textContent,
    ).toContain('Publicar reinicia 2 testes A/B')
    expect(
      screen.getByTestId('publish-experiments-notice').textContent,
    ).toContain('“Hero”, “Preços”')
  })
})
