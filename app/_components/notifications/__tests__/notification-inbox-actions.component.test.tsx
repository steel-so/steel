import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ShortcutsCheatSheet } from '@/app/_components/shortcuts/shortcuts-cheat-sheet'
import { ShortcutsProvider } from '@/app/_components/shortcuts/shortcuts-provider'
import {
  type FetchRoute,
  fetchBody,
  mockFetch,
  renderWithQuery,
} from '@/src/__tests__/component-utils'
import { NotificationInbox } from '../notification-inbox'

vi.setConfig({ testTimeout: 20_000 })

const notify = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}))
vi.mock('@/lib/notify', () => ({ notify }))

const toast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}))
vi.mock('sonner', () => ({ toast }))

const push = vi.hoisted(() => vi.fn())
const search = vi.hoisted(() => ({ value: '' }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => new URLSearchParams(search.value),
}))

const BASE = '/api/workspaces/ws_1/notifications'

function notification(overrides: Record<string, unknown> = {}) {
  return {
    id: 'n1',
    workspaceId: 'ws_1',
    kind: 'SD_TICKET_MESSAGE',
    title: 'Nova mensagem em INC-000123',
    body: 'Cliente: a VPN voltou a cair.',
    href: '/acme/servicedesk/tickets/123',
    read: false,
    readAt: null,
    archived: false,
    archivedAt: null,
    snoozedUntil: null,
    module: 'SERVICE_DESK',
    moduleLabel: 'ServiceDesk',
    kindLabel: 'Nova mensagem',
    icon: 'message',
    color: 'indigo',
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

const CONVERSATION = notification({
  id: 'n2',
  kind: 'WHATSAPP_AI_HANDOFF',
  title: 'A IA transferiu uma conversa para você',
  body: 'Maria precisa de um atendente.',
  href: '/acme/zap?conversa=c1',
  module: 'COMMUNICATION',
  moduleLabel: 'Comunicação',
  kindLabel: 'IA transferiu a conversa',
  read: true,
  readAt: new Date().toISOString(),
})

function page(items: unknown[], extra: Record<string, unknown> = {}) {
  return {
    items,
    unreadCount: 1,
    nextCursor: null,
    counts: { all: items.length, unread: 1, archived: 0, snoozed: 3 },
    ...extra,
  }
}

const IN_4_MIN = () => new Date(Date.now() + 4 * 60 * 1000).toISOString()
const IN_2_DAYS = () =>
  new Date(Date.now() + 2 * 24 * 60 * 60 * 1000 + 60_000).toISOString()

function pendingAction(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pa1',
    conversationId: 'conv1',
    agentRunId: null,
    toolName: 'sd_update_ticket',
    kind: 'UPDATE',
    module: 'SERVICE_DESK',
    preview: {
      title: 'Alterar prioridade do chamado INC-000040',
      summary: 'Sobe a prioridade.',
      fields: [{ label: 'Prioridade', before: 'Média', after: 'Alta' }],
    },
    status: 'PENDING',
    requiresDoubleConfirm: false,
    resultSummary: null,
    error: null,
    expiresAt: IN_4_MIN(),
    decidedAt: null,
    executedAt: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

const AI_PENDING = () => ({
  count: 2,
  items: [
    {
      source: 'ASSISTANT',
      action: pendingAction(),
      path: '/ai/conv1',
      conversation: { id: 'conv1', title: 'Priorizar a VPN' },
      agent: null,
      runId: null,
      client: null,
    },
    {
      source: 'AGENT',
      action: pendingAction({
        id: 'pa2',
        conversationId: null,
        agentRunId: 'run1',
        kind: 'DELETE',
        toolName: 'crm_delete_opportunity',
        requiresDoubleConfirm: true,
        expiresAt: IN_2_DAYS(),
        preview: {
          title: 'Excluir a oportunidade “Renovação Acme”',
          summary: '',
          fields: [{ label: 'Valor', after: 'R$ 12.000,00' }],
        },
      }),
      path: '/ai/agents/ag1/runs/run1',
      conversation: null,
      agent: { id: 'ag1', name: 'Triagem' },
      runId: 'run1',
      client: null,
    },
  ],
})

function routes(extra: FetchRoute[] = []): FetchRoute[] {
  return [
    ...extra,
    { match: `${BASE}/ai-pending`, handler: AI_PENDING },
    {
      match: `${BASE}/preferences/delivery`,
      data: { browserEnabled: false },
    },
    { method: 'POST', match: `${BASE}/actions`, data: { updated: 1 } },
    { method: 'POST', match: `${BASE}/read`, data: { updated: 4 } },
    { method: 'POST', match: `${BASE}/archive-read`, data: { updated: 2 } },
    {
      method: 'POST',
      match: `${BASE}/snooze`,
      data: { updated: 1, snoozedUntil: '2026-10-08T12:00:00.000Z' },
    },
    {
      method: 'POST',
      match: /\/ai\/actions\/pa1\/confirm/,
      data: pendingAction({ status: 'EXECUTED', resultSummary: 'Feito' }),
    },
    {
      method: 'POST',
      match: /\/agents\/runs\/run1\/actions\/pa2\/approve/,
      data: pendingAction({ id: 'pa2', status: 'EXECUTED' }),
    },
    {
      method: 'POST',
      match: /\/agents\/runs\/run1\/actions\/pa2\/reject/,
      data: pendingAction({ id: 'pa2', status: 'CANCELED' }),
    },
    {
      match: /\/servicedesk\/tickets\/123$/,
      data: {
        id: 'tk_123',
        code: 'INC-000123',
        phase: null,
        priority: null,
        assignee: null,
      },
    },
    {
      method: 'PATCH',
      match: /\/servicedesk\/tickets\/tk_123$/,
      data: { id: 'tk_123' },
    },
    {
      match: /\/whatsapp\/conversations\/c1$/,
      data: { id: 'c1', assignedUserId: null },
    },
    {
      method: 'PATCH',
      match: /\/whatsapp\/conversations\/c1\/assign$/,
      data: { id: 'c1' },
    },
    { match: BASE, handler: () => page([notification(), CONVERSATION]) },
  ]
}

function render() {
  return renderWithQuery(
    <ShortcutsProvider>
      <NotificationInbox workspaceId='ws_1' slug='acme' userId='u_me' />
      <ShortcutsCheatSheet />
    </ShortcutsProvider>,
  )
}

function actionBodies(spy: ReturnType<typeof mockFetch>): unknown[] {
  return spy.mock.calls
    .filter(([input, init]) => String(input).includes('/actions') && init)
    .map(([, init]) => JSON.parse(String(init?.body)))
}

function listCalls(spy: ReturnType<typeof mockFetch>): string[] {
  return spy.mock.calls
    .map(([input]) => String(input))
    .filter((url) => url.includes(`${BASE}?`))
}

beforeEach(() => {
  vi.clearAllMocks()
  search.value = ''
  try {
    window.localStorage.clear()
  } catch {
    // jsdom without storage: nothing to clear.
  }
})

describe('<NotificationInbox /> — filtros rápidos e pastas', () => {
  it('filtra por menções e por atribuídas a mim', async () => {
    const spy = mockFetch(routes())
    render()
    await screen.findByText('Nova mensagem em INC-000123')

    fireEvent.click(screen.getByRole('button', { name: 'Menções' }))
    await waitFor(() =>
      expect(listCalls(spy).some((url) => url.includes('quick=mentions'))).toBe(
        true,
      ),
    )

    fireEvent.click(screen.getByRole('button', { name: 'Atribuídas a mim' }))
    await waitFor(() =>
      expect(listCalls(spy).some((url) => url.includes('quick=assigned'))).toBe(
        true,
      ),
    )
    expect(
      screen
        .getByRole('button', { name: 'Atribuídas a mim' })
        .getAttribute('aria-pressed'),
    ).toBe('true')
  })

  it('o atalho "Não lidas" troca a pasta e a pasta Adiadas mostra a contagem', async () => {
    const spy = mockFetch(routes())
    render()
    await screen.findByText('Nova mensagem em INC-000123')

    const folders = screen.getByRole('tablist', { name: 'Pastas' })
    expect(
      within(folders).getByRole('tab', { name: /Adiadas\s*3/ }),
    ).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /^Não lidas$/ }))
    await waitFor(() =>
      expect(listCalls(spy).some((url) => url.includes('folder=unread'))).toBe(
        true,
      ),
    )
  })

  it('marca todas como lidas e arquiva as lidas no escopo do filtro', async () => {
    const spy = mockFetch(routes())
    render()
    await screen.findByText('Nova mensagem em INC-000123')

    fireEvent.click(
      screen.getByRole('button', { name: 'Mais ações da caixa de entrada' }),
    )
    fireEvent.click(
      await screen.findByRole('menuitem', { name: /Arquivar todas as lidas/ }),
    )
    await waitFor(() =>
      expect(fetchBody(spy, `${BASE}/archive-read`)).toEqual({}),
    )
    await waitFor(() =>
      expect(notify.success).toHaveBeenCalledWith('2 lidas arquivadas'),
    )
  })
})

describe('<NotificationInbox /> — adiar', () => {
  it('adia pelo painel de leitura e oferece desfazer', async () => {
    const spy = mockFetch(routes())
    render()
    fireEvent.click(await screen.findByText('Nova mensagem em INC-000123'))
    const panel = await screen.findByRole('article', { name: 'Notificação' })

    fireEvent.click(within(panel).getByRole('button', { name: 'Adiar' }))
    fireEvent.click(
      await screen.findByRole('menuitem', { name: 'Amanhã, às 9h' }),
    )

    await waitFor(() =>
      expect(fetchBody(spy, `${BASE}/snooze`)).toEqual({
        ids: ['n1'],
        preset: 'tomorrow',
      }),
    )
    await waitFor(() => expect(toast.success).toHaveBeenCalled())
    const [message, options] = toast.success.mock.calls[0]
    expect(message).toMatch(/^Adiada até /)
    options.action.onClick()
    await waitFor(() =>
      expect(actionBodies(spy)).toContainEqual({
        action: 'unsnooze',
        ids: ['n1'],
      }),
    )
  })

  it('adia a seleção em lote', async () => {
    const spy = mockFetch(routes())
    render()
    await screen.findByText('Nova mensagem em INC-000123')

    fireEvent.click(
      screen.getByRole('checkbox', {
        name: 'Selecionar: Nova mensagem em INC-000123',
      }),
    )
    fireEvent.click(
      screen.getByRole('checkbox', {
        name: 'Selecionar: A IA transferiu uma conversa para você',
      }),
    )
    const toolbar = await screen.findByRole('toolbar', {
      name: 'Ações da seleção',
    })
    fireEvent.click(within(toolbar).getByRole('button', { name: 'Adiar' }))
    fireEvent.click(
      await screen.findByRole('menuitem', { name: 'Daqui a 3 horas' }),
    )

    await waitFor(() =>
      expect(fetchBody(spy, `${BASE}/snooze`)).toEqual({
        ids: ['n1', 'n2'],
        preset: '3h',
      }),
    )
  })
})

describe('<NotificationInbox /> — atalhos novos', () => {
  async function renderWithRows() {
    const spy = mockFetch(routes())
    render()
    await screen.findByText('Nova mensagem em INC-000123')
    fireEvent.keyDown(window, { key: 'j' })
    return spy
  }

  it('"r" alterna lida/não lida da linha em foco', async () => {
    const spy = await renderWithRows()
    fireEvent.keyDown(window, { key: 'r' })
    await waitFor(() =>
      expect(fetchBody(spy, `${BASE}/actions`)).toEqual({
        action: 'read',
        ids: ['n1'],
      }),
    )
  })

  it('"s" abre o adiamento e "1" escolhe 1 hora', async () => {
    const spy = await renderWithRows()
    fireEvent.keyDown(window, { key: 's' })
    const dialog = await screen.findByRole('dialog', {
      name: 'Adiar notificação',
    })
    fireEvent.keyDown(dialog, { key: '1' })

    await waitFor(() =>
      expect(fetchBody(spy, `${BASE}/snooze`)).toEqual({
        ids: ['n1'],
        preset: '1h',
      }),
    )
  })

  it('"i" abre as pendências da IA e volta', async () => {
    await renderWithRows()
    fireEvent.keyDown(window, { key: 'i' })
    expect(
      await screen.findByRole('region', { name: 'Pendências da IA' }),
    ).toBeTruthy()
    fireEvent.keyDown(window, { key: 'i' })
    await waitFor(() =>
      expect(
        screen.queryByRole('region', { name: 'Pendências da IA' }),
      ).toBeNull(),
    )
  })
})

describe('<NotificationInbox /> — pendências da IA', () => {
  it('abre direto pela URL (?view=ai), lista com contagem e confirma inline', async () => {
    search.value = 'view=ai'
    const spy = mockFetch(routes())
    render()

    const region = await screen.findByRole('region', {
      name: 'Pendências da IA',
    })
    expect(
      screen.getByRole('button', { name: /Pendências da IA/ }).textContent,
    ).toContain('2')

    const first = within(region).getByRole('article', {
      name: 'Pendência da IA: Alterar prioridade do chamado INC-000040',
    })
    expect(within(first).getByText('Média')).toBeTruthy()
    expect(within(first).getByText('Alta')).toBeTruthy()
    expect(first.textContent).toMatch(/Expira em [45] min/)
    expect(
      within(first)
        .getByRole('link', { name: 'Abrir conversa' })
        .getAttribute('href'),
    ).toBe('/acme/ai/conv1')

    fireEvent.click(within(first).getByRole('button', { name: 'Confirmar' }))
    await waitFor(() =>
      expect(fetchBody(spy, /\/ai\/actions\/pa1\/confirm/)).toEqual({}),
    )
    await waitFor(() => expect(notify.success).toHaveBeenCalledWith('Feito'))
  })

  it('exclusão de agente pede confirmação dupla e envia doubleConfirmed', async () => {
    search.value = 'view=ai'
    const spy = mockFetch(routes())
    render()

    const card = await screen.findByRole('article', {
      name: 'Pendência da IA: Excluir a oportunidade “Renovação Acme”',
    })
    expect(within(card).getByText(/Agente · Triagem/)).toBeTruthy()
    expect(within(card).getByText('Expira em 2 dias')).toBeTruthy()

    fireEvent.click(within(card).getByRole('button', { name: 'Aprovar' }))
    // Nothing is sent before the second confirmation.
    expect(fetchBody(spy, /\/approve/)).toBeUndefined()

    fireEvent.click(
      await screen.findByRole('button', { name: 'Excluir definitivamente' }),
    )
    await waitFor(() =>
      expect(
        fetchBody(spy, /\/agents\/runs\/run1\/actions\/pa2\/approve/),
      ).toEqual({ doubleConfirmed: true }),
    )
  })

  it('rejeita uma aprovação de agente', async () => {
    search.value = 'view=ai'
    const spy = mockFetch(routes())
    render()

    const card = await screen.findByRole('article', {
      name: 'Pendência da IA: Excluir a oportunidade “Renovação Acme”',
    })
    fireEvent.click(within(card).getByRole('button', { name: 'Rejeitar' }))
    await waitFor(() => expect(fetchBody(spy, /\/pa2\/reject/)).toEqual({}))
    await waitFor(() =>
      expect(notify.success).toHaveBeenCalledWith('Ação rejeitada'),
    )
  })

  it('o link de confirmação do MCP destaca a ação (?action=)', async () => {
    search.value = 'view=ai&action=pa1'
    Element.prototype.scrollIntoView = vi.fn()
    mockFetch(routes())
    render()

    const card = await screen.findByRole('article', {
      name: 'Pendência da IA: Alterar prioridade do chamado INC-000040',
    })
    expect(card.getAttribute('aria-current')).toBe('true')
    expect(
      screen.queryByText(/A ação deste link não está mais pendente/),
    ).toBeNull()
  })

  it('avisa quando a ação do link não está mais pendente', async () => {
    search.value = 'view=ai&action=gone'
    mockFetch(routes())
    render()
    expect(
      await screen.findByText(/A ação deste link não está mais pendente/),
    ).toBeTruthy()

    search.value = 'view=ai&action=gone'
    mockFetch(
      routes([{ match: `${BASE}/ai-pending`, data: { items: [], count: 0 } }]),
    )
    render()
    expect(await screen.findByText(/Nenhuma pendência da IA/)).toBeTruthy()
  })

  it('mostra o estado vazio quando não há pendências', async () => {
    search.value = 'view=ai'
    mockFetch(
      routes([{ match: `${BASE}/ai-pending`, data: { items: [], count: 0 } }]),
    )
    render()
    expect(await screen.findByText(/Nenhuma pendência da IA/)).toBeTruthy()
  })
})

describe('<NotificationInbox /> — ações rápidas por tipo', () => {
  it('responder abre o histórico do chamado e atribuir a mim usa o id real', async () => {
    const spy = mockFetch(routes())
    render()
    fireEvent.click(await screen.findByText('Nova mensagem em INC-000123'))
    const panel = await screen.findByRole('article', { name: 'Notificação' })

    fireEvent.click(
      await within(panel).findByRole('button', { name: 'Responder' }),
    )
    expect(push).toHaveBeenCalledWith(
      '/acme/servicedesk/tickets/123?tab=history&reply=1',
    )

    fireEvent.click(
      await within(panel).findByRole('button', { name: 'Atribuir a mim' }),
    )
    await waitFor(() =>
      expect(fetchBody(spy, /\/tickets\/tk_123$/, 'PATCH')).toEqual({
        assigneeId: 'u_me',
      }),
    )

    expect(
      within(panel)
        .getByRole('link', { name: /Silenciar avisos do tipo/ })
        .getAttribute('href'),
    ).toBe('/acme/servicedesk/settings?tab=notifications')
  })

  it('atribui a conversa sem responsável e silencia na tela de preferências', async () => {
    const spy = mockFetch(routes())
    render()
    fireEvent.click(
      await screen.findByText('A IA transferiu uma conversa para você'),
    )
    const panel = await screen.findByRole('article', { name: 'Notificação' })

    fireEvent.click(
      await within(panel).findByRole('button', { name: 'Atribuir a mim' }),
    )
    await waitFor(() =>
      expect(fetchBody(spy, /\/conversations\/c1\/assign$/, 'PATCH')).toEqual({
        assignedUserId: 'u_me',
      }),
    )
    expect(
      within(panel)
        .getByRole('link', { name: /Silenciar avisos do tipo/ })
        .getAttribute('href'),
    ).toBe('/acme/settings/notifications')
  })
})
