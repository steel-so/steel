import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  fetchBody,
  mockFetch,
  renderWithQuery,
} from '@/src/__tests__/component-utils'
import type { CrmNlSearchResultDTO } from '@/types/crm-nl-search'
import { CrmNlSearchBar } from '../crm-nl-search-bar'
import { applyNlResult, nlResultIds } from '../crm-nl-search-result'

const notify = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }))
vi.mock('@/lib/notify', () => ({ notify }))

const RESULT = {
  query: 'parados',
  interpretation: ['Em andamento', 'Parados há 15 dias ou mais'],
  filter: {},
  opportunities: [{ id: 'o1' }, { id: 'o2' }],
  truncated: false,
} as unknown as CrmNlSearchResultDTO

const URL_RE = /\/workspaces\/ws_1\/crm\/opportunities\/search$/

describe('CrmNlSearchBar', () => {
  it('sends the question and reports the result with how it was read', async () => {
    const fetchMock = mockFetch([
      { method: 'POST', match: URL_RE, data: RESULT },
    ])
    const onResult = vi.fn()
    renderWithQuery(<CrmNlSearchBar workspaceId='ws_1' onResult={onResult} />)

    fireEvent.change(screen.getByLabelText('Pergunte sobre as oportunidades'), {
      target: { value: '  negócios parados  ' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Perguntar' }))

    await waitFor(() => expect(onResult).toHaveBeenCalledWith(RESULT))
    expect(fetchBody(fetchMock, URL_RE)).toEqual({ query: 'negócios parados' })
    expect(screen.getByText('Parados há 15 dias ou mais')).toBeTruthy()
    expect(screen.getByTestId('nl-search-summary').textContent).toContain(
      '2 oportunidades',
    )
  })

  it('clears the filter', async () => {
    mockFetch([{ method: 'POST', match: URL_RE, data: RESULT }])
    const onResult = vi.fn()
    renderWithQuery(<CrmNlSearchBar workspaceId='ws_1' onResult={onResult} />)

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Meus negócios que fecham este mês',
      }),
    )
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(RESULT))

    fireEvent.click(screen.getByRole('button', { name: /Limpar/ }))
    expect(onResult).toHaveBeenLastCalledWith(null)
    expect(screen.queryByTestId('nl-search-summary')).toBeNull()
  })

  it('says when nothing matched', async () => {
    mockFetch([
      {
        method: 'POST',
        match: URL_RE,
        data: { ...RESULT, opportunities: [] },
      },
    ])
    renderWithQuery(<CrmNlSearchBar workspaceId='ws_1' onResult={vi.fn()} />)
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Em negociação sem responsável',
      }),
    )
    await waitFor(() =>
      expect(screen.getByTestId('nl-search-summary').textContent).toContain(
        'Nenhuma oportunidade encontrada',
      ),
    )
  })

  it('shows the server error and keeps the table untouched', async () => {
    mockFetch([
      {
        method: 'POST',
        match: URL_RE,
        status: 502,
        error: 'A IA não conseguiu responder',
      },
    ])
    const onResult = vi.fn()
    renderWithQuery(<CrmNlSearchBar workspaceId='ws_1' onResult={onResult} />)
    fireEvent.change(screen.getByLabelText('Pergunte sobre as oportunidades'), {
      target: { value: 'qualquer coisa' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Perguntar' }))
    await waitFor(() => expect(notify.error).toHaveBeenCalled())
    expect(onResult).not.toHaveBeenCalled()
  })

  it('does not submit a too-short question', () => {
    const fetchMock = mockFetch([])
    renderWithQuery(<CrmNlSearchBar workspaceId='ws_1' onResult={vi.fn()} />)
    const button = screen.getByRole('button', { name: 'Perguntar' })
    expect((button as HTMLButtonElement).disabled).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('counts a single result in the singular and marks truncation', async () => {
    mockFetch([
      {
        method: 'POST',
        match: URL_RE,
        data: { ...RESULT, opportunities: [{ id: 'o1' }], truncated: true },
      },
    ])
    renderWithQuery(<CrmNlSearchBar workspaceId='ws_1' onResult={vi.fn()} />)
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Em negociação sem responsável',
      }),
    )
    await waitFor(() =>
      expect(screen.getByTestId('nl-search-summary').textContent).toContain(
        '1+ oportunidade',
      ),
    )
  })
})

describe('CrmNlSearchBar for other records', () => {
  const LEADS = {
    query: 'leads quentes',
    interpretation: ['Em andamento', 'Score a partir de 50'],
    filter: {},
    items: [{ id: 'l1' }, { id: 'l2' }, { id: 'l3' }],
    truncated: false,
  }

  it.each([
    ['leads', 'Pergunte sobre os leads', '3 leads'],
    ['people', 'Pergunte sobre as pessoas', '3 pessoas'],
    ['companies', 'Pergunte sobre as empresas', '3 empresas'],
  ] as const)(
    'posts to the %s route and counts the matches',
    async (entity, label, count) => {
      const fetchMock = mockFetch([
        {
          method: 'POST',
          match: new RegExp(`/workspaces/ws_1/crm/${entity}/search$`),
          data: LEADS,
        },
      ])
      const onResult = vi.fn()
      renderWithQuery(
        <CrmNlSearchBar
          workspaceId='ws_1'
          entity={entity}
          onResult={onResult}
        />,
      )
      fireEvent.change(screen.getByLabelText(label), {
        target: { value: 'uma pergunta' },
      })
      fireEvent.click(screen.getByRole('button', { name: 'Perguntar' }))
      await waitFor(() => expect(onResult).toHaveBeenCalledWith(LEADS))
      expect(
        fetchBody(fetchMock, new RegExp(`/crm/${entity}/search$`)),
      ).toEqual({ query: 'uma pergunta' })
      expect(screen.getByTestId('nl-search-summary').textContent).toContain(
        count,
      )
    },
  )

  it('says when nothing matched for leads', async () => {
    mockFetch([
      {
        method: 'POST',
        match: /\/crm\/leads\/search$/,
        data: { ...LEADS, items: [] },
      },
    ])
    renderWithQuery(
      <CrmNlSearchBar workspaceId='ws_1' entity='leads' onResult={vi.fn()} />,
    )
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Meus leads com score acima de 50',
      }),
    )
    await waitFor(() =>
      expect(screen.getByTestId('nl-search-summary').textContent).toContain(
        'Nenhum lead encontrado',
      ),
    )
  })
})

describe('applyNlResult()', () => {
  const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]

  it('returns every row when there is no result', () => {
    expect(applyNlResult(rows, null)).toBe(rows)
  })

  it('keeps the table order when the question asked for none', () => {
    const result = {
      filter: {},
      items: [{ id: 'c' }, { id: 'a' }],
    } as never
    expect(applyNlResult(rows, result)).toEqual([{ id: 'a' }, { id: 'c' }])
    expect(nlResultIds(result)).toEqual(['c', 'a'])
  })

  it('follows the server order when the question asked for one, skipping rows not loaded', () => {
    const result = {
      filter: { sort: 'SCORE_DESC' },
      items: [{ id: 'c' }, { id: 'zz' }, { id: 'a' }],
    } as never
    expect(applyNlResult(rows, result)).toEqual([{ id: 'c' }, { id: 'a' }])
  })

  it('reads the opportunities key of the original result', () => {
    expect(
      nlResultIds({ filter: {}, opportunities: [{ id: 'o1' }] } as never),
    ).toEqual(['o1'])
  })
})
