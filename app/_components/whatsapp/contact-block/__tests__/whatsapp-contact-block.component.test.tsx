import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  fetchBody,
  mockFetch,
  renderWithQuery,
} from '@/src/__tests__/component-utils'
import type {
  WhatsAppContactBlockDTO,
  WhatsAppContactBlockSyncDTO,
} from '@/types/whatsapp-contact-block'
import {
  blockStatusHint,
  blockStatusLabel,
  formatBlockDate,
} from '../contact-block-format'
import { WhatsappBlockContactDialog } from '../whatsapp-block-contact-dialog'
import {
  syncSummary,
  WhatsappBlockedContactsSettings,
} from '../whatsapp-blocked-contacts-settings'
import { WhatsappContactBlockStatusBadge } from '../whatsapp-contact-block-status-badge'
import { WhatsappContactBlockedBanner } from '../whatsapp-contact-blocked-banner'

vi.setConfig({ testTimeout: 20_000 })

const notify = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
}))
vi.mock('@/lib/notify', () => ({ notify }))

const API = '/api/workspaces/ws_1/whatsapp/blocks'

function block(
  overrides: Partial<WhatsAppContactBlockDTO> = {},
): WhatsAppContactBlockDTO {
  return {
    id: 'blk1',
    connectionId: 'conn1',
    connectionLabel: 'Oficial',
    connectionPhoneNumber: '551130000000',
    provider: 'META',
    contactId: 'ct1',
    contactName: 'Maria Souza',
    waId: '5511988887777',
    hasPhone: true,
    reason: 'Mensagens ofensivas',
    providerStatus: 'APPLIED',
    providerError: null,
    appliedAt: '2026-11-12T15:00:00.000Z',
    origin: 'STEEL',
    droppedCount: 4,
    lastDroppedAt: '2026-11-12T18:30:00.000Z',
    blockedBy: { id: 'u1', name: 'Ana Lima' },
    blockedAt: '2026-11-12T15:00:00.000Z',
    ...overrides,
  }
}

describe('contact block format', () => {
  it('formats dates in São Paulo time regardless of the runner', () => {
    expect(formatBlockDate('2026-11-12T15:00:00.000Z')).toBe(
      '12/11/2026, 12:00',
    )
    expect(formatBlockDate(null)).toBe('—')
  })

  it('labels each provider status', () => {
    expect(blockStatusLabel('APPLIED', 'META')).toBe('Bloqueado na Meta')
    expect(blockStatusLabel('APPLIED', 'ZAPI')).toBe('Bloqueado na Z-API')
    expect(blockStatusLabel('PENDING', 'META')).toBe(
      'Aguardando a pessoa escrever',
    )
    expect(blockStatusLabel('FAILED', 'META')).toBe('Falhou')
    expect(blockStatusHint(block())).toBe('Também bloqueado na Meta.')
    expect(blockStatusHint(block({ providerStatus: 'PENDING' }))).toContain(
      '24 horas',
    )
    expect(
      blockStatusHint(
        block({ providerStatus: 'FAILED', providerError: 'Lista cheia.' }),
      ),
    ).toContain('A Meta recusou o bloqueio: Lista cheia.')
    expect(
      blockStatusHint(
        block({ providerStatus: 'FAILED', provider: 'ZAPI', providerError: null }),
      ),
    ).toContain('A Z-API recusou o bloqueio.')
  })

  it('summarizes a sync', () => {
    const result: WhatsAppContactBlockSyncDTO = {
      connections: [
        {
          connectionId: 'c1',
          label: 'Oficial',
          provider: 'META',
          imported: 1,
          retried: 1,
          applied: 1,
          listSupported: true,
          error: null,
        },
        {
          connectionId: 'c2',
          label: 'Loja',
          provider: 'ZAPI',
          imported: 0,
          retried: 0,
          applied: 0,
          listSupported: false,
          error: 'Sem credenciais.',
        },
      ],
    }
    const text = syncSummary(result)
    expect(text).toContain('1 bloqueio importado, 1 aplicado no provedor')
    expect(text).toContain('Não deu para sincronizar Loja: Sem credenciais.')
    expect(text).toContain('A Z-API não informa a lista de bloqueados')
    expect(syncSummary({ connections: [] })).toBe(
      'Nenhum número do WhatsApp conectado para sincronizar.',
    )
    expect(
      syncSummary({
        connections: [
          { ...result.connections[0], imported: 3, applied: 2 },
        ],
      }),
    ).toBe('Sincronizado: 3 bloqueios importados, 2 aplicados no provedor.')
  })
})

describe('<WhatsappContactBlockStatusBadge />', () => {
  it('shows the failure reason', () => {
    renderWithQuery(
      <WhatsappContactBlockStatusBadge
        block={block({ providerStatus: 'FAILED', providerError: 'Lista cheia' })}
      />,
    )
    expect(screen.getByText('Falhou: Lista cheia')).toBeTruthy()
  })

  it('shows a failure without a reason and the pending state', () => {
    const { rerender } = renderWithQuery(
      <WhatsappContactBlockStatusBadge
        block={block({ providerStatus: 'FAILED', providerError: null })}
      />,
    )
    expect(screen.getByText('Falhou')).toBeTruthy()
    rerender(
      <WhatsappContactBlockStatusBadge
        block={block({ providerStatus: 'PENDING' })}
      />,
    )
    expect(screen.getByText('Aguardando a pessoa escrever')).toBeTruthy()
  })
})

describe('<WhatsappContactBlockedBanner />', () => {
  it('explains the block and unblocks when allowed', () => {
    const onUnblock = vi.fn()
    renderWithQuery(
      <WhatsappContactBlockedBanner
        block={block({ providerStatus: 'PENDING' })}
        canUnblock
        isUnblocking={false}
        onUnblock={onUnblock}
      />,
    )
    expect(screen.getByText('Contato bloqueado neste número')).toBeTruthy()
    expect(screen.getByRole('status').textContent).toContain('24 horas')
    fireEvent.click(screen.getByRole('button', { name: 'Desbloquear' }))
    expect(onUnblock).toHaveBeenCalledTimes(1)
  })

  it('tells an agent who can unblock, without the button', () => {
    renderWithQuery(
      <WhatsappContactBlockedBanner
        block={block()}
        canUnblock={false}
        isUnblocking={false}
        onUnblock={vi.fn()}
      />,
    )
    expect(screen.queryByRole('button', { name: 'Desbloquear' })).toBeNull()
    expect(screen.getByRole('status').textContent).toContain(
      'Só administradores e líderes de equipe podem desbloquear.',
    )
  })

  it('shows the pending unblock', () => {
    renderWithQuery(
      <WhatsappContactBlockedBanner
        block={block()}
        canUnblock
        isUnblocking
        onUnblock={vi.fn()}
      />,
    )
    const button = screen.getByRole('button', { name: 'Desbloqueando...' })
    expect((button as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('<WhatsappBlockContactDialog />', () => {
  it('explains the Meta 24 h rule and blocks with the reason', async () => {
    const fetchSpy = mockFetch([
      {
        method: 'POST',
        match: API,
        data: {
          block: block({ providerStatus: 'PENDING' }),
          notice: 'Contato bloqueado no Steel. A Meta só aceita...',
        },
      },
    ])
    const onOpenChange = vi.fn()
    const onBlocked = vi.fn()
    renderWithQuery(
      <WhatsappBlockContactDialog
        workspaceId='ws_1'
        open
        onOpenChange={onOpenChange}
        target={{ conversationId: 'cv1' }}
        contactName='Maria Souza'
        provider='META'
        onBlocked={onBlocked}
      />,
    )
    expect(screen.getByText('Bloquear Maria Souza?')).toBeTruthy()
    expect(screen.getByText(/nas últimas 24 horas/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Motivo (opcional)'), {
      target: { value: '  Spam  ' },
    })
    expect(screen.getByText('8/500')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Bloquear contato' }))

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(fetchBody(fetchSpy, API)).toEqual({
      conversationId: 'cv1',
      reason: 'Spam',
    })
    expect(notify.warning).toHaveBeenCalledWith(
      'Contato bloqueado no Steel. A Meta só aceita...',
    )
    expect(onBlocked).toHaveBeenCalledWith(
      expect.objectContaining({ providerStatus: 'PENDING' }),
    )
  })

  it('confirms an applied Z-API block and sends a null reason', async () => {
    const fetchSpy = mockFetch([
      {
        method: 'POST',
        match: API,
        data: { block: block({ provider: 'ZAPI' }), notice: 'Bloqueado.' },
      },
    ])
    renderWithQuery(
      <WhatsappBlockContactDialog
        workspaceId='ws_1'
        open
        onOpenChange={vi.fn()}
        target={{ connectionId: 'conn1', contactId: 'ct1' }}
        contactName='Maria'
        provider='ZAPI'
      />,
    )
    expect(screen.getByText(/aparelho conectado pela Z-API/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Bloquear contato' }))
    await waitFor(() => expect(notify.success).toHaveBeenCalledWith('Bloqueado.'))
    expect(fetchBody(fetchSpy, API)).toEqual({
      connectionId: 'conn1',
      contactId: 'ct1',
      reason: null,
    })
  })

  it('shows the API error and keeps the dialog open', async () => {
    mockFetch([
      { method: 'POST', match: API, status: 404, error: 'Conversa não encontrada' },
    ])
    const onOpenChange = vi.fn()
    renderWithQuery(
      <WhatsappBlockContactDialog
        workspaceId='ws_1'
        open
        onOpenChange={onOpenChange}
        target={{ conversationId: 'cv1' }}
        contactName='Maria'
        provider='META'
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Bloquear contato' }))
    await waitFor(() => expect(notify.error).toHaveBeenCalled())
    expect(onOpenChange).not.toHaveBeenCalledWith(false)

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})

describe('<WhatsappBlockedContactsSettings />', () => {
  it('lists the blocks per number with who, when, reason and ignored messages', async () => {
    mockFetch([
      {
        match: API,
        data: [
          block(),
          block({
            id: 'blk2',
            connectionId: 'conn2',
            connectionLabel: 'Loja',
            provider: 'ZAPI',
            contactName: null,
            waId: '5521977770000',
            origin: 'PROVIDER',
            blockedBy: null,
            reason: null,
            droppedCount: 0,
            lastDroppedAt: null,
            providerStatus: 'FAILED',
            providerError: 'Instância desconectada',
          }),
        ],
      },
    ])
    renderWithQuery(<WhatsappBlockedContactsSettings workspaceId='ws_1' />)

    expect(await screen.findByText('Maria Souza')).toBeTruthy()
    expect(screen.getByText('Bloqueado na Meta')).toBeTruthy()
    expect(screen.getByText('Ana Lima · 12/11/2026, 12:00')).toBeTruthy()
    expect(screen.getByText('Mensagens ofensivas')).toBeTruthy()
    expect(screen.getByText(/^4 · última em 12\/11\/2026, 15:30$/)).toBeTruthy()
    expect(screen.getByText('+5521977770000')).toBeTruthy()
    expect(screen.getByText('Falhou: Instância desconectada')).toBeTruthy()
    expect(screen.getByText(/Importado da Z-API/)).toBeTruthy()
    expect(screen.getByText('Não informado')).toBeTruthy()
    expect(screen.getByLabelText('Filtrar por número')).toBeTruthy()
  })

  it('shows the empty state', async () => {
    mockFetch([{ match: API, data: [] }])
    renderWithQuery(<WhatsappBlockedContactsSettings workspaceId='ws_1' />)
    expect(await screen.findByText('Nenhum contato bloqueado')).toBeTruthy()
  })

  it('tells a plain agent the list is for managers', async () => {
    mockFetch([
      {
        match: API,
        handler: () =>
          new Response(
            JSON.stringify({
              success: false,
              message: 'Acesso negado',
              error: { code: 'FORBIDDEN' },
            }),
            { status: 403, headers: { 'Content-Type': 'application/json' } },
          ),
      },
    ])
    renderWithQuery(<WhatsappBlockedContactsSettings workspaceId='ws_1' />)
    expect(
      await screen.findByText(
        'Só administradores e líderes de equipe veem os contatos bloqueados.',
      ),
    ).toBeTruthy()
  })

  it('shows a load error', async () => {
    mockFetch([{ match: API, status: 500, error: 'Falhou' }])
    renderWithQuery(<WhatsappBlockedContactsSettings workspaceId='ws_1' />)
    expect(
      await screen.findByText(
        'Não foi possível carregar os contatos bloqueados agora.',
      ),
    ).toBeTruthy()
  })

  it('unblocks after confirming and warns about a provider refusal', async () => {
    const fetchSpy = mockFetch([
      {
        method: 'DELETE',
        match: `${API}/blk1`,
        data: { id: 'blk1', providerWarning: 'Desbloqueado no Steel, mas...' },
      },
      { match: API, data: [block()] },
    ])
    renderWithQuery(<WhatsappBlockedContactsSettings workspaceId='ws_1' />)
    fireEvent.click(await screen.findByRole('button', { name: 'Desbloquear' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText('Desbloquear Maria Souza?')).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Desbloquear' }))

    await waitFor(() =>
      expect(notify.warning).toHaveBeenCalledWith('Desbloqueado no Steel, mas...'),
    )
    expect(
      fetchSpy.mock.calls.some(
        ([url, init]) =>
          String(url).endsWith(`${API}/blk1`) && init?.method === 'DELETE',
      ),
    ).toBe(true)
  })

  it('syncs every number and reports the result', async () => {
    const fetchSpy = mockFetch([
      {
        method: 'POST',
        match: `${API}/sync`,
        data: {
          connections: [
            {
              connectionId: 'conn1',
              label: 'Oficial',
              provider: 'META',
              imported: 2,
              retried: 0,
              applied: 0,
              listSupported: true,
              error: null,
            },
          ],
        },
      },
      { match: API, data: [] },
    ])
    renderWithQuery(<WhatsappBlockedContactsSettings workspaceId='ws_1' />)
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Sincronizar com a Meta/Z-API',
      }),
    )
    await waitFor(() =>
      expect(notify.success).toHaveBeenCalledWith(
        'Sincronizado: 2 bloqueios importados, 0 aplicados no provedor.',
      ),
    )
    expect(fetchBody(fetchSpy, `${API}/sync`)).toEqual({})
  })

  it('warns when a number could not be synced and reports a failed call', async () => {
    mockFetch([
      {
        method: 'POST',
        match: `${API}/sync`,
        data: {
          connections: [
            {
              connectionId: 'conn1',
              label: 'Oficial',
              provider: 'META',
              imported: 0,
              retried: 0,
              applied: 0,
              listSupported: true,
              error: 'Sem credenciais.',
            },
          ],
        },
      },
      { match: API, data: [] },
    ])
    renderWithQuery(<WhatsappBlockedContactsSettings workspaceId='ws_1' />)
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Sincronizar com a Meta/Z-API',
      }),
    )
    await waitFor(() => expect(notify.warning).toHaveBeenCalled())
  })
})
