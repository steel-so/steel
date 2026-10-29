import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IssueAbTestCard } from '@/app/_components/crm/newsletters/issues/report/issue-ab-test-card'
import { cadenceSummary, digestFormOf, digestPayloadOf } from '../digest-form'
import { NewsletterDigestTab } from '../newsletter-digest-tab'

const notify = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
}))
vi.mock('@/lib/notify', () => ({ notify }))

type Route = { method: string; url: RegExp; body: unknown; status?: number }

function stubApi(routes: Route[]) {
  const spy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    const url = String(input)
    const route = routes.find((r) => r.method === method && r.url.test(url))
    return new Response(
      JSON.stringify({ success: true, data: route?.body ?? null }),
      {
        status: route?.status ?? 200,
        headers: { 'Content-Type': 'application/json' },
      },
    )
  })
  vi.stubGlobal('fetch', spy)
  return spy
}

function wrap(node: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>{node}</QueryClientProvider>,
  )
}

const DIGEST = {
  id: 'dg1',
  newsletterId: 'nl1',
  enabled: true,
  siteId: 'site1',
  siteName: 'Site Acme',
  rssUrl: null,
  cadence: 'WEEKLY',
  weekday: 1,
  monthDay: null,
  hour: 9,
  mode: 'DRAFT',
  maxItems: 5,
  subject: 'Resumo de {data}',
  intro: null,
  nextRunAt: '2026-11-02T12:00:00.000Z',
  lastRunAt: null,
  lastItemAt: null,
  lastIssueId: 'is1',
  lastOutcome: 'DRAFT_CREATED',
  lastMessage: 'Rascunho criado com 2 posts.',
  updatedAt: '2026-10-28T13:00:00.000Z',
}

beforeEach(() => vi.clearAllMocks())
afterEach(() => vi.unstubAllGlobals())

describe('digest form helpers', () => {
  it('maps the DTO to the form and back', () => {
    const form = digestFormOf(null)
    expect(form.siteId).toBe('NONE')
    expect(
      digestPayloadOf({ ...form, rssUrl: ' https://x.com/feed ' }),
    ).toMatchObject({
      siteId: null,
      rssUrl: 'https://x.com/feed',
      weekday: 1,
      monthDay: null,
      intro: null,
    })
    const monthly = digestFormOf({
      ...DIGEST,
      cadence: 'MONTHLY',
      monthDay: 15,
    } as never)
    expect(digestPayloadOf(monthly)).toMatchObject({
      siteId: 'site1',
      weekday: null,
      monthDay: 15,
    })
    expect(cadenceSummary(monthly)).toBe(
      'Todo dia 15 do mês às 9h (horário de Brasília)',
    )
    expect(cadenceSummary({ ...form, weekday: '0' })).toBe(
      'Todo domingo às 9h (horário de Brasília)',
    )
    expect(cadenceSummary(form)).toBe(
      'Toda segunda-feira às 9h (horário de Brasília)',
    )
  })
})

describe('NewsletterDigestTab', () => {
  it('saves a new digest from a feed', async () => {
    const spy = stubApi([
      {
        method: 'GET',
        url: /\/digest$/,
        body: { digest: null, sites: [] },
      },
      {
        method: 'PUT',
        url: /\/digest$/,
        body: {
          digest: { ...DIGEST, siteId: null, rssUrl: 'https://blog.x/feed' },
          sites: [],
        },
      },
    ])
    wrap(
      <NewsletterDigestTab
        workspaceId='ws1'
        workspaceSlug='acme'
        newsletterId='nl1'
        archived={false}
      />,
    )
    const rss = await screen.findByLabelText('Feed RSS ou Atom (opcional)')
    expect(
      screen.getByRole('button', { name: 'Salvar resumo' }),
    ).toHaveProperty('disabled', true)
    fireEvent.change(rss, { target: { value: 'https://blog.x/feed' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar resumo' }))
    await waitFor(() => expect(notify.success).toHaveBeenCalled())
    const put = spy.mock.calls.find(([, init]) => init?.method === 'PUT')
    expect(JSON.parse(String(put?.[1]?.body))).toMatchObject({
      rssUrl: 'https://blog.x/feed',
      siteId: null,
      cadence: 'WEEKLY',
      mode: 'DRAFT',
    })
  })

  it('shows the status, previews the posts and generates a draft now', async () => {
    const spy = stubApi([
      {
        method: 'GET',
        url: /\/digest$/,
        body: {
          digest: DIGEST,
          sites: [{ id: 'site1', name: 'Site Acme', published: true }],
        },
      },
      {
        method: 'POST',
        url: /\/digest\/preview$/,
        body: {
          items: [
            {
              source: 'SITE',
              title: 'Como escolher um plano',
              excerpt: 'Guia',
              url: 'https://acme/blog/planos',
              imageUrl: null,
              publishedAt: '2026-10-27T12:00:00.000Z',
            },
          ],
          warnings: ['O feed passa de 1 MB.'],
          since: '2026-10-21T13:00:00.000Z',
        },
      },
      {
        method: 'POST',
        url: /\/digest\/run$/,
        body: {
          issueId: 'is2',
          items: 1,
          message: 'Rascunho criado com 1 post.',
        },
      },
    ])
    wrap(
      <NewsletterDigestTab
        workspaceId='ws1'
        workspaceSlug='acme'
        newsletterId='nl1'
        archived={false}
      />,
    )
    expect(await screen.findByText('Resumo ligado')).toBeTruthy()
    expect(screen.getByText('Rascunho criado')).toBeTruthy()
    fireEvent.click(
      screen.getByRole('button', { name: 'Ver posts do próximo resumo' }),
    )
    expect(await screen.findByText('Como escolher um plano')).toBeTruthy()
    expect(screen.getByText('O feed passa de 1 MB.')).toBeTruthy()
    fireEvent.click(
      screen.getByRole('button', { name: 'Gerar rascunho agora' }),
    )
    await waitFor(() =>
      expect(notify.success).toHaveBeenCalledWith(
        'Rascunho criado com 1 post.',
      ),
    )
    expect(
      spy.mock.calls.some(([url]) => String(url).endsWith('/digest/run')),
    ).toBe(true)
  })
})

describe('IssueAbTestCard', () => {
  it('renders the variants and the winner', async () => {
    stubApi([
      {
        method: 'GET',
        url: /\/ab-test$/,
        body: {
          subjectA: 'Assunto A',
          abTest: {
            subjectB: 'Assunto B',
            testPercent: 20,
            metric: 'OPENS',
            waitHours: 4,
            winner: 'B',
            decidedAt: '2026-10-28T17:00:00.000Z',
            decideAt: '2026-10-28T17:00:00.000Z',
          },
          variants: [
            {
              variant: 'A',
              subject: 'Assunto A',
              recipients: 10,
              sent: 10,
              opened: 2,
              clicked: 1,
              openRate: 0.2,
              clickRate: 0.1,
            },
            {
              variant: 'B',
              subject: 'Assunto B',
              recipients: 10,
              sent: 10,
              opened: 5,
              clicked: 1,
              openRate: 0.5,
              clickRate: 0.1,
            },
          ],
          held: 0,
        },
      },
    ])
    wrap(<IssueAbTestCard workspaceId='ws1' newsletterId='nl1' issueId='is1' />)
    expect(await screen.findByText('Teste A/B de assunto')).toBeTruthy()
    expect(screen.getByText('Vencedor')).toBeTruthy()
    expect(screen.getByText('50%')).toBeTruthy()
    expect(screen.getByText(/recebeu o assunto B/)).toBeTruthy()
  })

  it('renders nothing without a test', async () => {
    const spy = stubApi([
      {
        method: 'GET',
        url: /\/ab-test$/,
        body: { subjectA: 'A', abTest: null, variants: [], held: 0 },
      },
    ])
    const { container } = wrap(
      <IssueAbTestCard workspaceId='ws1' newsletterId='nl1' issueId='is1' />,
    )
    await waitFor(() => expect(spy).toHaveBeenCalled())
    expect(container.textContent).toBe('')
  })
})
