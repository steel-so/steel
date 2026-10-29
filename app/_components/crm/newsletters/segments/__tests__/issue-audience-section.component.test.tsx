import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IssueAudienceSection } from '../issue-audience-section'

vi.mock('@/lib/notify', () => ({
  notify: { success: vi.fn(), error: vi.fn() },
}))

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify({ success: status < 300, data }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

let fetchSpy: ReturnType<typeof vi.fn>

function mockApi(stored: unknown) {
  fetchSpy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    if (url.endsWith('/segment') && method === 'GET') return json(stored)
    if (url.endsWith('/segment') && method === 'PUT') {
      const body = JSON.parse(String(init?.body))
      return json({
        segment: body.segment,
        savedSegmentId: body.savedSegmentId ?? null,
        savedSegmentName: null,
        everyone: body.segment.conditions.length === 0,
      })
    }
    if (url.endsWith('/segments') && method === 'GET') {
      return json([
        {
          id: 'seg1',
          newsletterId: 'nl1',
          name: 'Engajados',
          definition: {
            conditions: [{ type: 'neverOpened' }],
            groups: [],
          },
          valid: true,
          createdAt: '',
          updatedAt: '',
        },
      ])
    }
    if (url.endsWith('/segments') && method === 'POST') {
      return json({ id: 'seg2', name: 'Novo' }, 201)
    }
    if (url.includes('/segments/options')) {
      return json({ companies: [], customFields: [] })
    }
    if (url.endsWith('/audience-preview')) {
      return json({
        count: 2,
        total: 5,
        sample: [{ id: 's1', email: 'ana@x.com', name: 'Ana' }],
      })
    }
    return json(null, 404)
  })
  vi.stubGlobal('fetch', fetchSpy)
}

function renderSection() {
  const onBusyChange = vi.fn()
  render(
    <QueryClientProvider client={new QueryClient()}>
      <IssueAudienceSection
        workspaceId='ws1'
        newsletterId='nl1'
        issueId='is1'
        onBusyChange={onBusyChange}
      />
    </QueryClientProvider>,
  )
  return onBusyChange
}

const puts = () =>
  fetchSpy.mock.calls.filter(([, init]) => init?.method === 'PUT')

const EVERYONE = {
  segment: { conditions: [], groups: [] },
  savedSegmentId: null,
  savedSegmentName: null,
  everyone: true,
}

beforeEach(() => mockApi(EVERYONE))
afterEach(() => vi.unstubAllGlobals())

describe('IssueAudienceSection', () => {
  it('starts on everyone, with the total, and is not busy', async () => {
    const onBusyChange = renderSection()
    expect(await screen.findByText('5 assinantes ativos')).toBeTruthy()
    expect(onBusyChange).toHaveBeenLastCalledWith(false)
    expect(puts()).toHaveLength(0)
  })

  it('blocks the send until a valid segment is saved', async () => {
    const onBusyChange = renderSection()
    await screen.findByText('5 assinantes ativos')
    fireEvent.click(screen.getByText('Um segmento'))
    expect(
      await screen.findByText('Adicione ao menos uma condição.'),
    ).toBeTruthy()
    expect(onBusyChange).toHaveBeenLastCalledWith(true)

    fireEvent.click(screen.getByRole('button', { name: 'Adicionar condição' }))
    await waitFor(() => expect(puts()).toHaveLength(1), { timeout: 3000 })
    expect(JSON.parse(String(puts()[0][1]?.body))).toEqual({
      segment: {
        conditions: [{ type: 'opened', op: 'any', lastIssues: 3 }],
        groups: [],
      },
      savedSegmentId: null,
    })
    await waitFor(() => expect(onBusyChange).toHaveBeenLastCalledWith(false))
    expect(await screen.findByText('2 de 5 assinantes')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Ver quem recebe' }))
    expect(screen.getByTestId('audience-sample').textContent).toContain(
      'ana@x.com',
    )
  })

  it('saves the conditions as a named segment', async () => {
    mockApi({
      segment: { conditions: [{ type: 'neverOpened' }], groups: [] },
      savedSegmentId: null,
      savedSegmentName: null,
      everyone: false,
    })
    renderSection()
    fireEvent.click(
      await screen.findByRole('button', { name: 'Salvar como segmento' }),
    )
    fireEvent.change(screen.getByLabelText('Nome do segmento'), {
      target: { value: 'Inativos' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() =>
      expect(
        fetchSpy.mock.calls.some(
          ([url, init]) =>
            String(url).endsWith('/segments') && init?.method === 'POST',
        ),
      ).toBe(true),
    )
    // The issue now points at the saved segment.
    await waitFor(
      () =>
        expect(
          puts().some(
            ([, init]) =>
              JSON.parse(String(init?.body)).savedSegmentId === 'seg2',
          ),
        ).toBe(true),
      { timeout: 3000 },
    )
  })

  it('shows the API error when the audience cannot be read', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              success: false,
              message: 'Público inválido',
              error: { code: 'CRM_NEWSLETTER_SEGMENT_INVALID' },
            }),
            { status: 422 },
          ),
      ),
    )
    render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <IssueAudienceSection
          workspaceId='ws1'
          newsletterId='nl1'
          issueId='is1'
        />
      </QueryClientProvider>,
    )
    expect(await screen.findByRole('alert')).toBeTruthy()
  })
})
