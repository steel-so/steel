import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeWhatsAppConnection } from '@/src/__tests__/factories/whatsapp-connection.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('@/src/repositories/whatsapp-connection.repository')
vi.mock('../whatsapp-notify', () => ({
  notifyWhatsAppUsers: vi.fn(async () => 1),
  whatsAppAdminIds: vi.fn(async () => ['owner', 'admin']),
}))

import { WhatsAppConnectionRepository } from '@/src/repositories/whatsapp-connection.repository'
import {
  metaConnectionError,
  WhatsAppConnectionHealthService,
} from '../whatsapp-connection-health.service'
import { notifyWhatsAppUsers } from '../whatsapp-notify'

const repo = vi.mocked(WhatsAppConnectionRepository)
const notify = vi.mocked(notifyWhatsAppUsers)

const connection = (overrides = {}) =>
  createFakeWhatsAppConnection({
    id: 'conn1',
    workspaceId: 'ws1',
    label: 'Atendimento',
    phoneNumber: '5511999990000',
    module: 'COMMUNICATION',
    ...overrides,
  })

beforeEach(() => {
  vi.clearAllMocks()
  repo.transitionStatus.mockResolvedValue(ok(true))
  repo.update.mockResolvedValue(ok(connection()))
})

describe('WhatsAppConnectionHealthService.markDown', () => {
  it('tells the admins when a connected number drops', async () => {
    const lost = expectOk(
      await WhatsAppConnectionHealthService.markDown(connection(), {
        status: 'DISCONNECTED',
        error: 'phone offline',
        source: 'zapi_webhook',
      }),
    )
    expect(lost).toBe(true)
    expect(repo.transitionStatus).toHaveBeenCalledWith('conn1', ['CONNECTED'], {
      status: 'DISCONNECTED',
      statusError: 'phone offline',
    })
    const [input] = notify.mock.calls[0]
    expect(input).toMatchObject({
      workspaceId: 'ws1',
      kind: 'WHATSAPP_CONNECTION_LOST',
      userIds: ['owner', 'admin'],
      title: 'Conexão do WhatsApp caiu: Atendimento',
    })
    expect(input.body).toContain('(phone offline)')
    expect(input.path).toBe('/settings/whatsapp')
  })

  it('links ServiceDesk connections to their settings tab and spares the actor', async () => {
    expectOk(
      await WhatsAppConnectionHealthService.markDown(
        connection({ module: 'SERVICE_DESK' }),
        { status: 'ERROR', error: null, source: 'test', actorId: 'admin' },
      ),
    )
    const [input] = notify.mock.calls[0]
    expect(input.actorId).toBe('admin')
    expect(input.body).not.toContain('(')
    expect(input.path).toBe('/servicedesk/settings?tab=whatsapp')
  })

  it('does not repeat the notice while the connection is still down', async () => {
    repo.transitionStatus.mockResolvedValue(ok(false))
    const lost = expectOk(
      await WhatsAppConnectionHealthService.markDown(connection(), {
        status: 'DISCONNECTED',
        error: null,
        source: 'zapi_webhook',
      }),
    )
    expect(lost).toBe(false)
    expect(repo.update).toHaveBeenCalledWith('conn1', {
      status: 'DISCONNECTED',
      statusError: null,
    })
    expect(notify).not.toHaveBeenCalled()
  })

  it('propagates repository failures', async () => {
    repo.transitionStatus.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await WhatsAppConnectionHealthService.markDown(connection(), {
        status: 'ERROR',
        error: null,
        source: 'meta_webhook',
      }),
      'DATABASE_ERROR',
    )
    repo.transitionStatus.mockResolvedValueOnce(ok(false))
    repo.update.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await WhatsAppConnectionHealthService.markDown(connection(), {
        status: 'ERROR',
        error: null,
        source: 'meta_webhook',
      }),
      'DATABASE_ERROR',
    )
  })
})

describe('WhatsAppConnectionHealthService.markUp', () => {
  it('re-arms the notice by moving any down state back to CONNECTED', async () => {
    expectOk(await WhatsAppConnectionHealthService.markUp(connection()))
    expect(repo.transitionStatus).toHaveBeenCalledWith(
      'conn1',
      ['CONNECTING', 'DISCONNECTED', 'ERROR'],
      { status: 'CONNECTED', statusError: null },
    )
  })
})

describe('metaConnectionError', () => {
  it('spots a connection-level error code', () => {
    expect(
      metaConnectionError([
        { code: 131047, title: 'Re-engagement message' },
        { code: 190, title: 'Access token expired' },
      ]),
    ).toBe('Access token expired')
    expect(metaConnectionError([{ code: 131031, message: 'locked' }])).toBe(
      'locked',
    )
    expect(metaConnectionError([{ code: 368 }])).toBe('Erro 368 da Meta')
  })

  it('ignores message-level failures and missing errors', () => {
    expect(metaConnectionError([{ code: 131026 }])).toBeNull()
    expect(metaConnectionError([{ title: 'sem código' }])).toBeNull()
    expect(metaConnectionError(undefined)).toBeNull()
  })
})
