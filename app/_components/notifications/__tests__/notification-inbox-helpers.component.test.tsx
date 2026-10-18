import { fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { inboxButtonLabel } from '@/app/_components/header/header-inbox-button'
import { mockFetch, renderWithQuery } from '@/src/__tests__/component-utils'
import {
  shouldNotifyInBrowser,
  showBrowserNotification,
} from '@/src/hooks/use-browser-notifications'
import {
  expiryLabel,
  isExpiringSoon,
  NotificationAiPendingCard,
} from '../notification-ai-pending-card'
import {
  NotificationBrowserPrompt,
  NotificationBrowserSettingCard,
} from '../notification-browser-toggle'
import {
  notificationAssignRef,
  notificationMuteHref,
  notificationReplyHref,
  notificationSnoozeState,
} from '../notification-quick-actions'

const notify = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}))
vi.mock('@/lib/notify', () => ({ notify }))

const NOW = Date.parse('2026-10-07T12:00:00.000Z')
const MIN = 60 * 1000

beforeEach(() => {
  vi.clearAllMocks()
  try {
    window.localStorage.clear()
  } catch {
    // jsdom without storage.
  }
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('expiry countdown', () => {
  const at = (ms: number) => new Date(NOW + ms).toISOString()

  it('labels every range', () => {
    expect(expiryLabel(at(-1), NOW)).toBe('Expirada')
    expect(expiryLabel(at(30_000), NOW)).toBe('Expira em menos de 1 min')
    expect(expiryLabel(at(12 * MIN), NOW)).toBe('Expira em 12 min')
    expect(expiryLabel(at(150 * MIN), NOW)).toBe('Expira em 2 h')
    expect(expiryLabel(at(25 * 60 * MIN), NOW)).toBe('Expira em 1 dia')
    expect(expiryLabel(at(72 * 60 * MIN), NOW)).toBe('Expira em 3 dias')
  })

  it('warns in the last 5 minutes only', () => {
    expect(isExpiringSoon(at(4 * MIN), NOW)).toBe(true)
    expect(isExpiringSoon(at(6 * MIN), NOW)).toBe(false)
    expect(isExpiringSoon(at(-MIN), NOW)).toBe(false)
  })
})

describe('quick actions by kind', () => {
  it('reply goes to the ticket history composer or the conversation', () => {
    expect(
      notificationReplyHref({
        kind: 'SD_TICKET_MENTIONED',
        href: '/acme/servicedesk/tickets/12',
      }),
    ).toBe('/acme/servicedesk/tickets/12?tab=history&reply=1')
    expect(
      notificationReplyHref({
        kind: 'SD_TICKET_MESSAGE',
        href: '/acme/servicedesk/tickets/12?tab=agent#m1',
      }),
    ).toBe('/acme/servicedesk/tickets/12?tab=history&reply=1#m1')
    expect(
      notificationReplyHref({
        kind: 'WHATSAPP_CONVERSATION_ASSIGNED',
        href: '/acme/zap?conversa=c1',
      }),
    ).toBe('/acme/zap?conversa=c1')
    expect(
      notificationReplyHref({ kind: 'SD_SLA_BREACHED', href: '/acme/x' }),
    ).toBeNull()
    expect(
      notificationReplyHref({ kind: 'SD_KB_COMMENT', href: '/acme/wiki' }),
    ).toBeNull()
    expect(
      notificationReplyHref({ kind: 'SD_TICKET_MESSAGE', href: null }),
    ).toBeNull()
  })

  it('mute link points to the right preferences screen', () => {
    expect(notificationMuteHref('acme', 'SD_SLA_BREACHED')).toBe(
      '/acme/servicedesk/settings?tab=notifications',
    )
    expect(notificationMuteHref('acme', 'CRM_LEAD_ASSIGNED')).toBe(
      '/acme/settings/notifications',
    )
  })

  it('knows what can be assigned and the snooze state', () => {
    expect(notificationAssignRef('/acme/servicedesk/tickets/1')).toEqual({
      type: 'ticket',
    })
    expect(notificationAssignRef('/acme/zap?conversa=c1')).toEqual({
      type: 'conversation',
    })
    expect(notificationAssignRef('/acme/crm/leads')).toBeNull()

    expect(notificationSnoozeState(null, NOW)).toBeNull()
    expect(
      notificationSnoozeState(new Date(NOW + MIN).toISOString(), NOW),
    ).toBe('snoozed')
    expect(
      notificationSnoozeState(new Date(NOW - MIN).toISOString(), NOW),
    ).toBe('resurfaced')
  })
})

describe('header inbox label', () => {
  it('counts unread and AI pendings', () => {
    expect(inboxButtonLabel(0, 0)).toBe('Caixa de entrada')
    expect(inboxButtonLabel(3, 0)).toBe('Caixa de entrada: 3 não lidas')
    expect(inboxButtonLabel(0, 1)).toBe('Caixa de entrada: 1 pendência da IA')
    expect(inboxButtonLabel(2, 4)).toBe(
      'Caixa de entrada: 2 não lidas, 4 pendências da IA',
    )
  })
})

describe('browser notifications', () => {
  const urgent = { kind: 'SD_SLA_BREACHED', title: 'SLA violado', at: 'x' }
  const ready = { enabled: true, hidden: true, permission: 'granted' as const }

  it('only for urgent kinds, enabled, granted and with the tab hidden', () => {
    expect(shouldNotifyInBrowser(urgent, ready)).toBe(true)
    expect(shouldNotifyInBrowser({ kind: 'CRM_DEAL_CLOSED' }, ready)).toBe(
      false,
    )
    expect(shouldNotifyInBrowser({}, ready)).toBe(false)
    expect(shouldNotifyInBrowser(urgent, { ...ready, enabled: false })).toBe(
      false,
    )
    expect(shouldNotifyInBrowser(urgent, { ...ready, hidden: false })).toBe(
      false,
    )
    expect(
      shouldNotifyInBrowser(urgent, { ...ready, permission: 'default' }),
    ).toBe(false)
  })

  it('shows the notification and navigates on click', () => {
    const created: { title: string; options: NotificationOptions }[] = []
    const close = vi.fn()
    class FakeNotification {
      onclick: (() => void) | null = null
      close = close
      constructor(title: string, options: NotificationOptions) {
        created.push({ title, options })
        instances.push(this)
      }
    }
    const instances: FakeNotification[] = []
    vi.stubGlobal('Notification', FakeNotification)
    const navigate = vi.fn()
    const focus = vi.spyOn(window, 'focus').mockImplementation(() => undefined)

    showBrowserNotification(
      { ...urgent, body: 'INC-000001', href: '/acme/servicedesk/tickets/1' },
      navigate,
    )
    showBrowserNotification({ kind: 'AI_ACTION_EXPIRING' }, navigate)

    expect(created[0]).toEqual({
      title: 'SLA violado',
      options: { body: 'INC-000001', tag: 'SD_SLA_BREACHED:x' },
    })
    // Without title/body the catalog labels fill in.
    expect(created[1].title).toBe('Ação da IA expirando')
    instances[0].onclick?.()
    expect(focus).toHaveBeenCalled()
    expect(navigate).toHaveBeenCalledWith('/acme/servicedesk/tickets/1')
    expect(close).toHaveBeenCalled()
    instances[1].onclick?.()
    expect(navigate).toHaveBeenCalledTimes(1)
  })
})

const DELIVERY = '/api/workspaces/ws_1/notifications/preferences/delivery'

function stubPermission(permission: NotificationPermission, next = permission) {
  const requestPermission = vi.fn(async () => next)
  vi.stubGlobal(
    'Notification',
    Object.assign(function Notification() {}, {
      permission,
      requestPermission,
    }),
  )
  return requestPermission
}

describe('<NotificationBrowserPrompt />', () => {
  it('asks the browser and saves the opt-in on the server', async () => {
    const requestPermission = stubPermission('default', 'granted')
    const spy = mockFetch([
      { method: 'PUT', match: DELIVERY, data: { browserEnabled: true } },
      { match: DELIVERY, data: { browserEnabled: false } },
    ])
    renderWithQuery(<NotificationBrowserPrompt workspaceId='ws_1' />)

    fireEvent.click(await screen.findByRole('button', { name: 'Ativar' }))

    await waitFor(() => expect(requestPermission).toHaveBeenCalled())
    await waitFor(() =>
      expect(
        spy.mock.calls.some(
          ([url, init]) =>
            String(url).includes(DELIVERY) && init?.method === 'PUT',
        ),
      ).toBe(true),
    )
    await waitFor(() =>
      expect(notify.success).toHaveBeenCalledWith(
        'Notificações do navegador ativadas',
      ),
    )
  })

  it('reports a blocked permission and then hides', async () => {
    stubPermission('default', 'denied')
    mockFetch([{ match: DELIVERY, data: { browserEnabled: false } }])
    renderWithQuery(<NotificationBrowserPrompt workspaceId='ws_1' />)

    fireEvent.click(await screen.findByRole('button', { name: 'Ativar' }))
    await waitFor(() =>
      expect(notify.error).toHaveBeenCalledWith(
        expect.stringContaining('bloqueou'),
      ),
    )
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Ativar' })).toBeNull(),
    )
  })

  it('"Agora não" hides it on this device', async () => {
    stubPermission('default')
    mockFetch([{ match: DELIVERY, data: { browserEnabled: false } }])
    renderWithQuery(<NotificationBrowserPrompt workspaceId='ws_1' />)

    fireEvent.click(await screen.findByRole('button', { name: 'Agora não' }))
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Ativar' })).toBeNull(),
    )
  })

  it('stays hidden once the browser already decided', async () => {
    stubPermission('granted')
    mockFetch([{ match: DELIVERY, data: { browserEnabled: true } }])
    renderWithQuery(<NotificationBrowserPrompt workspaceId='ws_1' />)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(screen.queryByRole('button', { name: 'Ativar' })).toBeNull()
  })
})

describe('<NotificationBrowserSettingCard />', () => {
  it('turns the switch off', async () => {
    stubPermission('granted')
    const spy = mockFetch([
      { method: 'PUT', match: DELIVERY, data: { browserEnabled: false } },
      { match: DELIVERY, data: { browserEnabled: true } },
    ])
    renderWithQuery(<NotificationBrowserSettingCard workspaceId='ws_1' />)

    const toggle = await screen.findByRole('switch', {
      name: 'Notificações do navegador',
    })
    await waitFor(() =>
      expect(toggle.getAttribute('aria-checked')).toBe('true'),
    )
    fireEvent.click(toggle)

    await waitFor(() =>
      expect(
        spy.mock.calls.find(
          ([url, init]) =>
            String(url).includes(DELIVERY) && init?.method === 'PUT',
        )?.[1]?.body,
      ).toBe(JSON.stringify({ browserEnabled: false })),
    )
    await waitFor(() =>
      expect(notify.success).toHaveBeenCalledWith(
        'Notificações do navegador desativadas',
      ),
    )
  })

  it('explains when the browser has no notifications', async () => {
    vi.stubGlobal('Notification', undefined)
    delete (window as { Notification?: unknown }).Notification
    mockFetch([{ match: DELIVERY, data: { browserEnabled: false } }])
    renderWithQuery(<NotificationBrowserSettingCard workspaceId='ws_1' />)
    expect(
      await screen.findByText(/Este navegador não oferece notificações/),
    ).toBeTruthy()
  })
})

describe('<NotificationAiPendingCard />', () => {
  const base = {
    source: 'ASSISTANT' as const,
    path: '/ai',
    conversation: null,
    agent: null,
    runId: null,
    client: null,
    action: {
      id: 'pa9',
      conversationId: null,
      agentRunId: null,
      toolName: 'crm_update_lead',
      kind: 'ACTION' as const,
      module: 'CRM' as const,
      preview: { title: 'Enviar e-mail ao lead', summary: '' },
      status: 'PENDING' as const,
      requiresDoubleConfirm: false,
      autoExecuted: false,
      resultSummary: null,
      error: null,
      expiresAt: new Date(Date.now() + 10 * MIN).toISOString(),
      decidedAt: null,
      executedAt: null,
      createdAt: new Date().toISOString(),
    },
  }

  it('reports a failed execution and a cancel', async () => {
    mockFetch([
      {
        method: 'POST',
        match: /\/pa9\/confirm/,
        data: { ...base.action, status: 'FAILED', error: 'Sem permissão' },
      },
      {
        method: 'POST',
        match: /\/pa9\/cancel/,
        data: { ...base.action, status: 'CANCELED' },
      },
    ])
    renderWithQuery(
      <NotificationAiPendingCard
        workspaceId='ws_1'
        slug='acme'
        item={base}
        now={Date.now()}
      />,
    )
    expect(screen.getByText('Steel AI · Conversa com o Steel AI')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
    await waitFor(() =>
      expect(notify.error).toHaveBeenCalledWith('Sem permissão'),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    await waitFor(() =>
      expect(notify.success).toHaveBeenCalledWith('Ação cancelada'),
    )
  })

  it('shows the server error and disables an expired action', async () => {
    mockFetch([
      {
        method: 'POST',
        match: /\/pa9\/confirm/,
        status: 409,
        error: 'A ação expirou',
      },
    ])
    const { rerender } = renderWithQuery(
      <NotificationAiPendingCard
        workspaceId='ws_1'
        slug='acme'
        item={base}
        now={Date.now()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
    await waitFor(() => expect(notify.error).toHaveBeenCalled())

    rerender(
      <NotificationAiPendingCard
        workspaceId='ws_1'
        slug='acme'
        item={base}
        now={Date.now() + 60 * MIN}
      />,
    )
    expect(screen.getByText('Expirada')).toBeTruthy()
    expect(
      (screen.getByRole('button', { name: 'Confirmar' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true)
  })

  it('shows an MCP action as a connected app request, highlighted from its link', () => {
    const scrollIntoView = vi.fn()
    HTMLElement.prototype.scrollIntoView = scrollIntoView
    renderWithQuery(
      <NotificationAiPendingCard
        workspaceId='ws_1'
        slug='acme'
        item={{
          ...base,
          path: '/inbox?view=ai',
          client: { id: 'cl1', name: 'Claude' },
        }}
        now={Date.now()}
        highlighted
      />,
    )
    const card = screen.getByRole('article', {
      name: 'Pendência da IA: Enviar e-mail ao lead',
    })
    expect(card.getAttribute('data-source')).toBe('MCP')
    expect(card.getAttribute('aria-current')).toBe('true')
    expect(screen.getByText('App conectado · Claude')).toBeTruthy()
    expect(
      screen.getByText(/Pedido por Claude em seu nome, via MCP/),
    ).toBeTruthy()
    // Decided right here: no conversation to open.
    expect(screen.queryByRole('link', { name: 'Abrir conversa' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Confirmar' })).toBeTruthy()
    expect(scrollIntoView).toHaveBeenCalled()
  })

  it('names an MCP client without a name generically', () => {
    renderWithQuery(
      <NotificationAiPendingCard
        workspaceId='ws_1'
        slug='acme'
        item={{ ...base, client: { id: 'cl1', name: null } }}
        now={Date.now()}
      />,
    )
    expect(screen.getByText('App conectado · App conectado')).toBeTruthy()
    expect(screen.getByText(/Pedido por um app conectado/)).toBeTruthy()
  })
})
