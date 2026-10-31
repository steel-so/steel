import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createFakeSdRemoteEndpoint,
  createFakeSdRemoteSession,
  createFakeSdRemoteSettings,
} from '@/src/__tests__/factories/nov-sd-remote.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { actAs } from '@/src/__tests__/helpers/sd-config.helpers'
import {
  databaseError,
  sdConfigItemNotFound,
  sdRemoteEndpointNotFound,
  sdTicketNotFound,
} from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/lib/axiom/audit', () => ({ auditMutation: vi.fn() }))
vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/sd-access.repository')
vi.mock('@/src/repositories/sd-config-item.repository')
vi.mock('@/src/repositories/sd-remote.repository')
vi.mock('@/src/repositories/sd-ticket.repository')
vi.mock('../sd-ticket-event-recorder')

import { auditMutation } from '@/lib/axiom/audit'
import { SdConfigItemRepository } from '@/src/repositories/sd-config-item.repository'
import { SdRemoteRepository } from '@/src/repositories/sd-remote.repository'
import { SdTicketRepository } from '@/src/repositories/sd-ticket.repository'
import { SdRemoteService } from '../sd-remote.service'
import { recordSdTicketEvent } from '../sd-ticket-event-recorder'

const repo = vi.mocked(SdRemoteRepository)
const items = vi.mocked(SdConfigItemRepository)
const tickets = vi.mocked(SdTicketRepository)
const record = vi.mocked(recordSdTicketEvent)
const WS = 'ws1'

beforeEach(() => {
  vi.clearAllMocks()
  actAs('agent')
  repo.findSettings.mockResolvedValue(ok(createFakeSdRemoteSettings()))
  repo.upsertSettings.mockResolvedValue(
    ok(createFakeSdRemoteSettings({ provider: 'ANYDESK' })),
  )
  repo.listEndpoints.mockResolvedValue(ok([createFakeSdRemoteEndpoint()]))
  repo.findEndpoint.mockResolvedValue(ok(createFakeSdRemoteEndpoint()))
  repo.findEndpointById.mockResolvedValue(ok(createFakeSdRemoteEndpoint()))
  repo.upsertEndpoint.mockResolvedValue(ok(createFakeSdRemoteEndpoint()))
  repo.deleteEndpoint.mockResolvedValue(ok(createFakeSdRemoteEndpoint()))
  repo.createSession.mockResolvedValue(
    ok(createFakeSdRemoteSession({ id: 'sess1' })),
  )
  repo.listSessions.mockResolvedValue(ok([createFakeSdRemoteSession()]))
  items.findById.mockResolvedValue(ok({ id: 'ci1', name: 'PC-01' } as never))
  tickets.findById.mockResolvedValue(ok({ id: 't1', number: 42 } as never))
  record.mockResolvedValue(ok(1))
})

describe('getSettings / updateSettings', () => {
  it('lets agents read and returns the defaults when nothing is saved', async () => {
    repo.findSettings.mockResolvedValue(ok(null))
    const dto = expectOk(await SdRemoteService.getSettings('u1', WS))
    expect(dto).toMatchObject({ enabled: false, provider: 'RUSTDESK' })
  })

  it('propagates a database error on read', async () => {
    repo.findSettings.mockResolvedValue(err(databaseError()))
    expectErr(await SdRemoteService.getSettings('u1', WS), 'DATABASE_ERROR')
  })

  it.each(['requester', 'stranger', 'disabled'] as const)(
    'refuses %s on read',
    async (actor) => {
      actAs(actor)
      expectErr(await SdRemoteService.getSettings('u1', WS))
    },
  )

  it('lets admins save and audits it', async () => {
    actAs('owner')
    const dto = expectOk(
      await SdRemoteService.updateSettings('u1', WS, { provider: 'ANYDESK' }),
    )
    expect(dto.provider).toBe('ANYDESK')
    expect(repo.upsertSettings).toHaveBeenCalledWith(WS, {
      provider: 'ANYDESK',
    })
    expect(auditMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'sd_remote_settings',
        action: 'update',
      }),
    )
  })

  it('refuses agents that are not admins', async () => {
    expectErr(
      await SdRemoteService.updateSettings('u1', WS, { enabled: true }),
      'FORBIDDEN',
    )
    expect(repo.upsertSettings).not.toHaveBeenCalled()
  })

  it('propagates a save failure', async () => {
    actAs('owner')
    repo.upsertSettings.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdRemoteService.updateSettings('u1', WS, { enabled: true }),
      'DATABASE_ERROR',
    )
  })
})

describe('endpoints', () => {
  it('lists the endpoints of an asset of the workspace', async () => {
    const list = expectOk(await SdRemoteService.listEndpoints('u1', WS, 'ci1'))
    expect(list).toHaveLength(1)
    expect(items.findById).toHaveBeenCalledWith('ci1', WS)
  })

  it('refuses a requester and an asset from another workspace', async () => {
    actAs('requester')
    expectErr(await SdRemoteService.listEndpoints('u1', WS, 'ci1'))
    actAs('agent')
    items.findById.mockResolvedValue(err(sdConfigItemNotFound()))
    expectErr(
      await SdRemoteService.listEndpoints('u1', WS, 'other'),
      'SD_CONFIG_ITEM_NOT_FOUND',
    )
  })

  it('propagates a list failure', async () => {
    repo.listEndpoints.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdRemoteService.listEndpoints('u1', WS, 'ci1'),
      'DATABASE_ERROR',
    )
  })

  it('saves an endpoint as MANUAL and audits it', async () => {
    expectOk(
      await SdRemoteService.upsertEndpoint('u1', WS, {
        configItemId: 'ci1',
        provider: 'RUSTDESK',
        remoteId: '123456789',
      }),
    )
    expect(repo.upsertEndpoint).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'MANUAL', workspaceId: WS }),
    )
    expect(auditMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'sd_remote_endpoint',
        action: 'update',
      }),
    )
  })

  it('refuses non-agents, unknown assets and database failures on save', async () => {
    const dto = {
      configItemId: 'ci1',
      provider: 'RUSTDESK' as const,
      remoteId: '123456789',
    }
    actAs('requester')
    expectErr(await SdRemoteService.upsertEndpoint('u1', WS, dto))
    actAs('agent')
    items.findById.mockResolvedValueOnce(err(sdConfigItemNotFound()))
    expectErr(await SdRemoteService.upsertEndpoint('u1', WS, dto))
    repo.upsertEndpoint.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdRemoteService.upsertEndpoint('u1', WS, dto),
      'DATABASE_ERROR',
    )
    expect(auditMutation).toHaveBeenLastCalledWith(
      expect.objectContaining({ outcome: 'failure' }),
    )
  })

  it('deletes an endpoint of the workspace', async () => {
    expect(
      expectOk(await SdRemoteService.deleteEndpoint('u1', WS, 'e1')),
    ).toEqual({
      id: 'e1',
    })
    expect(repo.deleteEndpoint).toHaveBeenCalledWith('e1')
  })

  it('does not delete what it cannot find, nor for a requester, nor on failure', async () => {
    repo.findEndpointById.mockResolvedValueOnce(err(sdRemoteEndpointNotFound()))
    expectErr(
      await SdRemoteService.deleteEndpoint('u1', WS, 'x'),
      'SD_REMOTE_ENDPOINT_NOT_FOUND',
    )
    actAs('requester')
    expectErr(await SdRemoteService.deleteEndpoint('u1', WS, 'e1'))
    actAs('agent')
    repo.deleteEndpoint.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdRemoteService.deleteEndpoint('u1', WS, 'e1'),
      'DATABASE_ERROR',
    )
  })
})

describe('connect', () => {
  it('builds the link, records the session, the audit and the ticket event', async () => {
    const result = expectOk(
      await SdRemoteService.connect('u1', WS, {
        configItemId: 'ci1',
        ticketId: 't1',
      }),
    )
    expect(result).toEqual({
      sessionId: 'sess1',
      provider: 'RUSTDESK',
      remoteId: '123456789',
      link: 'rustdesk://connection/new/123456789',
    })
    expect(repo.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        ticketId: 't1',
        userId: 'u1',
        configItemId: 'ci1',
      }),
    )
    expect(auditMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'sd_remote_session',
        action: 'connect',
      }),
    )
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        ticketId: 't1',
        action: 'remote.session_started',
        actorKind: 'AGENT',
        toValue: { id: 'ci1', label: 'PC-01' },
      }),
    )
  })

  it('connects from the asset without a ticket event', async () => {
    repo.findSettings.mockResolvedValue(
      ok(
        createFakeSdRemoteSettings({
          provider: 'ANYDESK',
          linkTemplate: 'https://r.example.com/{id}',
        }),
      ),
    )
    repo.findEndpoint.mockResolvedValue(
      ok(
        createFakeSdRemoteEndpoint({
          provider: 'ANYDESK',
          remoteId: '99887766',
        }),
      ),
    )
    const result = expectOk(
      await SdRemoteService.connect('u1', WS, { configItemId: 'ci1' }),
    )
    expect(result.link).toBe('https://r.example.com/99887766')
    expect(record).not.toHaveBeenCalled()
    expect(tickets.findById).not.toHaveBeenCalled()
  })

  it('refuses when the feature is off or never configured', async () => {
    repo.findSettings.mockResolvedValue(
      ok(createFakeSdRemoteSettings({ enabled: false })),
    )
    expectErr(
      await SdRemoteService.connect('u1', WS, { configItemId: 'ci1' }),
      'SD_REMOTE_DISABLED',
    )
    repo.findSettings.mockResolvedValue(ok(null))
    expectErr(
      await SdRemoteService.connect('u1', WS, { configItemId: 'ci1' }),
      'SD_REMOTE_DISABLED',
    )
    expect(repo.createSession).not.toHaveBeenCalled()
  })

  it('refuses requesters, strangers and cross-workspace ids', async () => {
    actAs('requester')
    expectErr(await SdRemoteService.connect('u1', WS, { configItemId: 'ci1' }))
    actAs('stranger')
    expectErr(await SdRemoteService.connect('u1', WS, { configItemId: 'ci1' }))
    actAs('agent')
    items.findById.mockResolvedValueOnce(err(sdConfigItemNotFound()))
    expectErr(
      await SdRemoteService.connect('u1', WS, { configItemId: 'other' }),
      'SD_CONFIG_ITEM_NOT_FOUND',
    )
    tickets.findById.mockResolvedValueOnce(err(sdTicketNotFound()))
    expectErr(
      await SdRemoteService.connect('u1', WS, {
        configItemId: 'ci1',
        ticketId: 'other',
      }),
      'SD_TICKET_NOT_FOUND',
    )
  })

  it('tells the technician when the asset has no id for the provider', async () => {
    repo.findEndpoint.mockResolvedValue(err(sdRemoteEndpointNotFound()))
    expectErr(
      await SdRemoteService.connect('u1', WS, { configItemId: 'ci1' }),
      'SD_REMOTE_ENDPOINT_NOT_FOUND',
    )
  })

  it('propagates database errors from the lookups and the session', async () => {
    repo.findSettings.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await SdRemoteService.connect('u1', WS, { configItemId: 'ci1' }),
      'DATABASE_ERROR',
    )
    repo.findEndpoint.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await SdRemoteService.connect('u1', WS, { configItemId: 'ci1' }),
      'DATABASE_ERROR',
    )
    repo.createSession.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await SdRemoteService.connect('u1', WS, { configItemId: 'ci1' }),
      'DATABASE_ERROR',
    )
    expect(record).not.toHaveBeenCalled()
  })
})

describe('listSessions', () => {
  it('lists the sessions of an asset', async () => {
    const list = expectOk(
      await SdRemoteService.listSessions('u1', WS, {
        configItemId: 'ci1',
        limit: 5,
      }),
    )
    expect(list[0].user.name).toBe('Ana Técnica')
    expect(repo.listSessions).toHaveBeenCalledWith(WS, 'ci1', 5)
  })

  it('refuses requesters, unknown assets and propagates failures', async () => {
    actAs('requester')
    expectErr(
      await SdRemoteService.listSessions('u1', WS, {
        configItemId: 'ci1',
        limit: 5,
      }),
    )
    actAs('agent')
    items.findById.mockResolvedValueOnce(err(sdConfigItemNotFound()))
    expectErr(
      await SdRemoteService.listSessions('u1', WS, {
        configItemId: 'x',
        limit: 5,
      }),
    )
    repo.listSessions.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdRemoteService.listSessions('u1', WS, {
        configItemId: 'ci1',
        limit: 5,
      }),
      'DATABASE_ERROR',
    )
  })
})

describe('saveInventoryEndpoints', () => {
  it('stores ids that are new or changed, as INVENTORY', async () => {
    repo.findEndpoint
      .mockResolvedValueOnce(err(sdRemoteEndpointNotFound()))
      .mockResolvedValueOnce(
        ok(
          createFakeSdRemoteEndpoint({
            provider: 'ANYDESK',
            source: 'INVENTORY',
            remoteId: 'old',
          }),
        ),
      )
    const saved = expectOk(
      await SdRemoteService.saveInventoryEndpoints(WS, 'ci1', {
        rustdesk: '123456789',
        anydesk: '987654321',
      }),
    )
    expect(saved).toBe(2)
    expect(repo.upsertEndpoint).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'RUSTDESK', source: 'INVENTORY' }),
    )
  })

  it('never overrides a manual id and skips unchanged or missing ones', async () => {
    repo.findEndpoint
      .mockResolvedValueOnce(
        ok(createFakeSdRemoteEndpoint({ source: 'MANUAL' })),
      )
      .mockResolvedValueOnce(
        ok(
          createFakeSdRemoteEndpoint({
            provider: 'ANYDESK',
            source: 'INVENTORY',
            remoteId: '987654321',
          }),
        ),
      )
    const saved = expectOk(
      await SdRemoteService.saveInventoryEndpoints(WS, 'ci1', {
        rustdesk: '555555555',
        anydesk: '987654321',
      }),
    )
    expect(saved).toBe(0)
    expect(repo.upsertEndpoint).not.toHaveBeenCalled()
    expect(
      expectOk(await SdRemoteService.saveInventoryEndpoints(WS, 'ci1', {})),
    ).toBe(0)
  })

  it('propagates a save failure', async () => {
    repo.findEndpoint.mockResolvedValue(err(sdRemoteEndpointNotFound()))
    repo.upsertEndpoint.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdRemoteService.saveInventoryEndpoints(WS, 'ci1', {
        rustdesk: '123456789',
      }),
      'DATABASE_ERROR',
    )
  })
})
