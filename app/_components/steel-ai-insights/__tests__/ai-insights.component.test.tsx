import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AiDigestSettingsCard } from '@/app/_components/settings/ai-digest-settings-card'
import { promptFromSearch } from '@/app/_components/steel-ai/steel-ai-welcome'
import {
  fetchBody,
  mockFetch,
  renderWithQuery,
} from '@/src/__tests__/component-utils'
import type { AiInsightDTO, AiInsightFeedDTO } from '@/types/ai-insight'
import {
  AiInsightCard,
  snoozeLabel,
  steelAiPromptHref,
} from '../ai-insight-card'
import { AiInsightFeed } from '../ai-insight-feed'
import {
  AiInsightHighlights,
  aiInsightsFeedHref,
} from '../ai-insight-highlights'

vi.setConfig({ testTimeout: 20_000 })

const notify = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('@/lib/notify', () => ({ notify }))

const BASE = '/api/workspaces/ws_1/ai/insights'

/** Buttons rendered as links (`render={<Link />}`) keep the button role. */
function hrefOf(text: string): string | null {
  return screen.getByText(text).closest('a')?.getAttribute('href') ?? null
}
const NOW = Date.parse('2026-10-18T12:00:00.000Z')

function insight(overrides: Partial<AiInsightDTO> = {}): AiInsightDTO {
  return {
    id: 'i1',
    kind: 'SD_SLA_BREACH_FORECAST',
    module: 'SERVICE_DESK',
    severity: 'CRITICAL',
    title: 'A fila de N1 deve estourar o SLA às 15:00',
    body: '3 chamados com previsão de estouro até 17:30.',
    facts: [
      { label: 'Chamados', value: '3' },
      { label: 'Primeiro estouro', value: '15:00' },
    ],
    href: '/acme/servicedesk/risk',
    prompt: 'Quais chamados da fila de N1 devem estourar o SLA?',
    state: 'active',
    snoozedUntil: null,
    firstSeenAt: '2026-10-18T11:00:00.000Z',
    lastSeenAt: '2026-10-18T11:45:00.000Z',
    ...overrides,
  }
}

function feed(
  items: AiInsightDTO[],
  overrides: Partial<AiInsightFeedDTO> = {},
): AiInsightFeedDTO {
  return {
    enabled: true,
    items,
    counts: { active: items.length, snoozed: 0, dismissed: 0 },
    ...overrides,
  }
}

describe('AiInsightCard', () => {
  it('shows the why, the facts and the links to act', () => {
    renderWithQuery(
      <AiInsightCard
        workspaceId='ws_1'
        slug='acme'
        insight={insight()}
        now={NOW}
      />,
    )
    expect(
      screen.getByRole('heading', {
        name: 'A fila de N1 deve estourar o SLA às 15:00',
      }),
    ).toBeTruthy()
    expect(screen.getByText('Urgente')).toBeTruthy()
    expect(screen.getByText('ServiceDesk')).toBeTruthy()
    expect(
      screen.getByText('3 chamados com previsão de estouro até 17:30.'),
    ).toBeTruthy()
    expect(screen.getByText('Primeiro estouro')).toBeTruthy()
    expect(hrefOf('Abrir')).toBe('/acme/servicedesk/risk')
    expect(hrefOf('Perguntar ao Steel AI')).toBe(
      '/acme/ai?prompt=Quais%20chamados%20da%20fila%20de%20N1%20devem%20estourar%20o%20SLA%3F',
    )
  })

  it('hides body and facts when compact, and the links without target', () => {
    renderWithQuery(
      <AiInsightCard
        workspaceId='ws_1'
        slug='acme'
        insight={insight({ href: null, prompt: null })}
        now={NOW}
        compact
      />,
    )
    expect(screen.queryByText('Primeiro estouro')).toBeNull()
    expect(
      screen.queryByText('3 chamados com previsão de estouro até 17:30.'),
    ).toBeNull()
    expect(screen.queryByText('Abrir')).toBeNull()
    expect(screen.queryByText('Perguntar ao Steel AI')).toBeNull()
  })

  it('snoozes and dismisses through the menu', async () => {
    const spy = mockFetch([
      {
        method: 'PATCH',
        match: `${BASE}/i1`,
        data: insight({ state: 'snoozed' }),
      },
    ])
    renderWithQuery(
      <AiInsightCard
        workspaceId='ws_1'
        slug='acme'
        insight={insight()}
        now={NOW}
      />,
    )

    fireEvent.click(
      screen.getByRole('button', { name: 'Mais ações do alerta' }),
    )
    fireEvent.click(
      await screen.findByRole('menuitem', { name: 'Por 4 horas' }),
    )
    await waitFor(() =>
      expect(fetchBody(spy, `${BASE}/i1`, 'PATCH')).toEqual({
        action: 'snooze',
        hours: 4,
      }),
    )
    await waitFor(() =>
      expect(notify.success).toHaveBeenCalledWith('Alerta adiado'),
    )

    fireEvent.click(
      screen.getByRole('button', { name: 'Mais ações do alerta' }),
    )
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Dispensar' }))
    await waitFor(() =>
      expect(notify.success).toHaveBeenCalledWith('Alerta dispensado'),
    )
  })

  it('restores a snoozed or dismissed insight and reports errors', async () => {
    mockFetch([
      {
        method: 'PATCH',
        match: `${BASE}/i1`,
        status: 404,
        error: 'Alerta não encontrado',
      },
    ])
    renderWithQuery(
      <AiInsightCard
        workspaceId='ws_1'
        slug='acme'
        insight={insight({
          state: 'snoozed',
          snoozedUntil: new Date(NOW + 3 * 3_600_000).toISOString(),
        })}
        now={NOW}
      />,
    )
    expect(screen.getByText('Volta em 3 h')).toBeTruthy()
    fireEvent.click(
      screen.getByRole('button', { name: 'Mais ações do alerta' }),
    )
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Restaurar' }))
    await waitFor(() =>
      expect(notify.error).toHaveBeenCalledWith('Alerta não encontrado'),
    )
  })

  it('labels a dismissed insight', () => {
    renderWithQuery(
      <AiInsightCard
        workspaceId='ws_1'
        slug='acme'
        insight={insight({ state: 'dismissed', severity: 'INFO' })}
        now={NOW}
      />,
    )
    expect(screen.getByText('Dispensado')).toBeTruthy()
    expect(screen.getByText('Informativo')).toBeTruthy()
  })
})

describe('insight helpers', () => {
  it('builds the Steel AI and feed links and the snooze countdown', () => {
    expect(steelAiPromptHref('acme', 'Olá & tchau')).toBe(
      '/acme/ai?prompt=Ol%C3%A1%20%26%20tchau',
    )
    expect(aiInsightsFeedHref('acme')).toBe('/acme/inbox?view=insights')
    expect(snoozeLabel(new Date(NOW + 30 * 60_000).toISOString(), NOW)).toBe(
      'Volta em até 1 h',
    )
    expect(snoozeLabel(new Date(NOW + 72 * 3_600_000).toISOString(), NOW)).toBe(
      'Volta em 3 dias',
    )
  })

  it('reads a prefilled prompt from the Steel AI URL', () => {
    expect(promptFromSearch('?prompt=Quais%20chamados%3F')).toBe(
      'Quais chamados?',
    )
    expect(promptFromSearch('?prompt=%20%20')).toBeNull()
    expect(promptFromSearch('')).toBeNull()
    expect(promptFromSearch(`?prompt=${'a'.repeat(3000)}`)).toHaveLength(2000)
  })
})

describe('AiInsightFeed', () => {
  it('lists the active insights and switches state and module', async () => {
    const spy = mockFetch([
      {
        match: 'state=dismissed',
        data: feed([], { counts: { active: 1, snoozed: 0, dismissed: 0 } }),
      },
      {
        match: BASE,
        data: feed([insight()], {
          counts: { active: 1, snoozed: 2, dismissed: 0 },
        }),
      },
    ])
    renderWithQuery(<AiInsightFeed workspaceId='ws_1' slug='acme' />)

    expect(
      await screen.findByText('A fila de N1 deve estourar o SLA às 15:00'),
    ).toBeTruthy()
    expect(screen.getByRole('tab', { name: /Adiados/ }).textContent).toContain(
      '2',
    )

    fireEvent.click(screen.getByRole('tab', { name: /Dispensados/ }))
    expect(await screen.findByText('Nenhum alerta dispensado.')).toBeTruthy()
    expect(
      spy.mock.calls.some(([url]) => String(url).includes('state=dismissed')),
    ).toBe(true)
  })

  it('explains an empty feed, a disabled workspace and an error', async () => {
    mockFetch([{ match: BASE, data: feed([]) }])
    const empty = renderWithQuery(
      <AiInsightFeed workspaceId='ws_1' slug='acme' />,
    )
    expect(await screen.findByText(/Nada pedindo atenção agora/)).toBeTruthy()
    empty.unmount()

    mockFetch([{ match: BASE, data: feed([], { enabled: false }) }])
    const off = renderWithQuery(
      <AiInsightFeed workspaceId='ws_1' slug='acme' />,
    )
    expect(await screen.findByText(/A IA proativa está desligada/)).toBeTruthy()
    off.unmount()

    mockFetch([{ match: BASE, status: 500, error: 'down' }])
    renderWithQuery(<AiInsightFeed workspaceId='ws_1' slug='acme' />)
    expect(
      await screen.findByText('Não foi possível carregar os alertas da IA.'),
    ).toBeTruthy()
  })
})

describe('AiInsightHighlights', () => {
  it('shows the top insights compact with a link to all of them', async () => {
    mockFetch([
      {
        match: `${BASE}?state=active&limit=3`,
        data: feed([insight()], {
          counts: { active: 5, snoozed: 0, dismissed: 0 },
        }),
      },
    ])
    renderWithQuery(<AiInsightHighlights workspaceId='ws_1' slug='acme' />)
    expect(await screen.findByText('Para sua atenção')).toBeTruthy()
    expect(hrefOf('Ver todos (5)')).toBe('/acme/inbox?view=insights')
    expect(screen.queryByText('Primeiro estouro')).toBeNull()
  })

  it('renders nothing without insights or with the feature off', async () => {
    const spy = mockFetch([{ match: BASE, data: feed([], { enabled: false }) }])
    const { container } = renderWithQuery(
      <AiInsightHighlights workspaceId='ws_1' slug='acme' />,
    )
    await waitFor(() => expect(spy).toHaveBeenCalled())
    expect(container.textContent).toBe('')
  })

  it('says "Ver todos" when every insight is shown', async () => {
    mockFetch([{ match: BASE, data: feed([insight()]) }])
    renderWithQuery(<AiInsightHighlights workspaceId='ws_1' slug='acme' />)
    expect(await screen.findByText('Ver todos')).toBeTruthy()
  })
})

describe('AiDigestSettingsCard', () => {
  const URL = '/api/workspaces/ws_1/ai/digest-settings'

  it('turns a channel off', async () => {
    const spy = mockFetch([
      {
        match: URL,
        data: { inApp: true, email: true, workspaceEnabled: true },
      },
      {
        method: 'PUT',
        match: URL,
        data: { inApp: true, email: false, workspaceEnabled: true },
      },
    ])
    renderWithQuery(<AiDigestSettingsCard workspaceId='ws_1' />)
    const email = await screen.findByRole('switch', { name: 'Por e-mail' })
    await waitFor(() =>
      expect(email.getAttribute('aria-disabled')).not.toBe('true'),
    )
    fireEvent.click(email)
    await waitFor(() =>
      expect(fetchBody(spy, URL, 'PUT')).toEqual({ email: false }),
    )
    await waitFor(() =>
      expect(notify.success).toHaveBeenCalledWith('Resumo diário desligado'),
    )
  })

  it('explains and locks the switches when the workspace turned it off', async () => {
    mockFetch([
      {
        match: URL,
        data: { inApp: true, email: true, workspaceEnabled: false },
      },
    ])
    renderWithQuery(<AiDigestSettingsCard workspaceId='ws_1' />)
    expect(
      await screen.findByText(/A IA proativa está desligada neste espaço/),
    ).toBeTruthy()
  })

  it('reports a failed save', async () => {
    mockFetch([
      {
        match: URL,
        data: { inApp: false, email: true, workspaceEnabled: true },
      },
      { method: 'PUT', match: URL, status: 500, error: 'Falhou' },
    ])
    renderWithQuery(<AiDigestSettingsCard workspaceId='ws_1' />)
    const inApp = await screen.findByRole('switch', {
      name: 'Na caixa de entrada',
    })
    await waitFor(() =>
      expect(inApp.getAttribute('aria-disabled')).not.toBe('true'),
    )
    fireEvent.click(inApp)
    await waitFor(() => expect(notify.error).toHaveBeenCalledWith('Falhou'))
  })
})
