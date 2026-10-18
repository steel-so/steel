import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  encrypt: vi.fn(),
  decrypt: vi.fn(),
  checkUrl: vi.fn(),
  run: vi.fn(),
}))

vi.mock('@/lib/axiom/audit')
vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('@/src/lib/crypto', () => ({
  encryptConnectionSecret: mocks.encrypt,
  decryptConnectionSecret: mocks.decrypt,
}))
vi.mock('@/src/lib/webhooks/url-guard', async (orig) => ({
  ...(await orig<typeof import('@/src/lib/webhooks/url-guard')>()),
  checkWebhookUrl: mocks.checkUrl,
}))
vi.mock('../webhook-delivery-runner', () => ({ runWebhookDelivery: mocks.run }))
vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/webhook-endpoint.repository')
vi.mock('@/src/repositories/webhook-delivery.repository')

import { auditMutation } from '@/lib/axiom/audit'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import {
  createFakeWebhookDelivery,
  createFakeWebhookEndpoint,
} from '@/src/__tests__/factories/webhook.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError, webhookEndpointNotFound } from '@/src/errors'
import { err, ok } from '@/src/lib/result'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { WebhookDeliveryRepository } from '@/src/repositories/webhook-delivery.repository'
import { WebhookEndpointRepository } from '@/src/repositories/webhook-endpoint.repository'
import { WEBHOOK_ENDPOINT_LIMIT } from '@/src/schemas/webhook.schema'
import {
  WebhookService,
  webhookListenSecret,
  webhookTypeVisible,
} from '../webhook.service'
import {
  dispatchWebhookEvent,
  enqueueWebhookDelivery,
} from '../webhook-emitter'

const memberships = vi.mocked(MembershipRepository)
const endpoints = vi.mocked(WebhookEndpointRepository)
const deliveries = vi.mocked(WebhookDeliveryRepository)
const dispatch = vi.mocked(dispatchWebhookEvent)
const enqueue = vi.mocked(enqueueWebhookDelivery)
const audit = vi.mocked(auditMutation)

const ADMIN = 'admin-1'
const WS = 'ws-1'
const DB = databaseError('boom')
const API = { source: 'api' as const, modules: ['CRM' as const] }

function asRole(role: 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER' | null) {
  memberships.findByUserAndWorkspace.mockResolvedValue(
    ok(
      role
        ? createFakeMembership({ userId: ADMIN, workspaceId: WS, role })
        : null,
    ),
  )
}

const endpoint = createFakeWebhookEndpoint({ id: 'e1', workspaceId: WS })

beforeEach(() => {
  asRole('ADMIN')
  mocks.encrypt.mockImplementation(async (plain: string) => `enc(${plain})`)
  mocks.decrypt.mockResolvedValue('whsec_plain')
  mocks.checkUrl.mockImplementation(async (raw: string) => ({
    ok: true,
    url: new URL(raw),
  }))
  endpoints.listByWorkspace.mockResolvedValue(ok([endpoint]))
  endpoints.countByWorkspace.mockResolvedValue(ok(0))
  endpoints.findById.mockResolvedValue(ok(endpoint))
  endpoints.create.mockImplementation(async (data) =>
    ok(createFakeWebhookEndpoint({ ...data, id: 'e-new' })),
  )
  endpoints.update.mockImplementation(async (id, data) =>
    ok(createFakeWebhookEndpoint({ ...endpoint, ...data, id })),
  )
  endpoints.softDelete.mockResolvedValue(ok(undefined))
  deliveries.findById.mockResolvedValue(
    ok(
      createFakeWebhookDelivery({
        id: 'd1',
        endpointId: 'e1',
        workspaceId: WS,
        attempts: 3,
      }),
    ),
  )
  deliveries.markPending.mockImplementation(async (id) =>
    ok(createFakeWebhookDelivery({ id, status: 'PENDING' })),
  )
  deliveries.list.mockResolvedValue(
    ok({ items: [createFakeWebhookDelivery({ id: 'd1' })], nextCursor: 'd1' }),
  )
  dispatch.mockResolvedValue(
    ok({
      event: {
        id: 'evt_1',
        type: 'steel.ping',
        createdAt: '',
        workspaceId: WS,
        data: { message: '' },
      },
      deliveries: [createFakeWebhookDelivery({ id: 'd-ping' })],
    }),
  )
  mocks.run.mockResolvedValue(
    ok({
      outcome: 'succeeded',
      delivery: createFakeWebhookDelivery({
        id: 'd-ping',
        status: 'SUCCEEDED',
      }),
    }),
  )
})

describe('authorization', () => {
  it.each(['MEMBER', 'VIEWER'] as const)(
    'should refuse a %s on every operation',
    async (role) => {
      asRole(role)
      const calls = [
        WebhookService.listEndpoints(ADMIN, WS),
        WebhookService.createEndpoint(ADMIN, WS, {
          url: 'https://h.example.com',
          events: ['*'],
        }),
        WebhookService.updateEndpoint(ADMIN, WS, 'e1', { active: false }),
        WebhookService.deleteEndpoint(ADMIN, WS, 'e1'),
        WebhookService.revealSecret(ADMIN, WS, 'e1'),
        WebhookService.rotateSecret(ADMIN, WS, 'e1'),
        WebhookService.testEndpoint(ADMIN, WS, 'e1'),
        WebhookService.listDeliveries(ADMIN, WS, { limit: 25 }),
        WebhookService.retryDelivery(ADMIN, WS, 'd1'),
        WebhookService.trigger(ADMIN, WS, { type: 'crm.deal.won' }),
        WebhookService.openListen(ADMIN, WS, []),
      ]
      for (const result of await Promise.all(calls)) {
        expectErr(result, 'FORBIDDEN')
      }
      expect(endpoints.create).not.toHaveBeenCalled()
    },
  )

  it('should refuse a non-member', async () => {
    asRole(null)
    expectErr(await WebhookService.listEndpoints(ADMIN, WS), 'FORBIDDEN')
  })

  it('should scope by workspace (an id of another workspace is not found)', async () => {
    endpoints.findById.mockResolvedValue(err(webhookEndpointNotFound()))
    expectErr(
      await WebhookService.updateEndpoint(ADMIN, WS, 'other', { active: true }),
      'WEBHOOK_ENDPOINT_NOT_FOUND',
    )
    expect(endpoints.findById).toHaveBeenCalledWith('other', WS)
  })
})

describe('listEvents', () => {
  it('should list the whole catalog in the app and filter by token modules in the API', () => {
    const all = WebhookService.listEvents()
    expect(all.some((event) => event.module === 'SERVICE_DESK')).toBe(true)
    const crm = WebhookService.listEvents(API)
    expect(
      crm.every((event) =>
        ['CRM', 'AGENTS', 'PLATFORM'].includes(event.module),
      ),
    ).toBe(true)
    expect(crm.some((event) => event.type === 'agents.approval.pending')).toBe(
      true,
    )
  })

  it('should tell which types a token sees', () => {
    expect(webhookTypeVisible('servicedesk.ticket.created', undefined)).toBe(
      true,
    )
    expect(webhookTypeVisible('servicedesk.ticket.created', ['CRM'])).toBe(
      false,
    )
    expect(webhookTypeVisible('steel.ping', [])).toBe(true)
  })
})

describe('endpoints', () => {
  it('should list the endpoints as one page', async () => {
    const page = expectOk(await WebhookService.listEndpoints(ADMIN, WS))
    expect(page.items.map((item) => item.id)).toEqual(['e1'])
    expect(page.nextCursor).toBeNull()
  })

  it('should create an endpoint with an encrypted secret shown once', async () => {
    const created = expectOk(
      await WebhookService.createEndpoint(
        ADMIN,
        WS,
        {
          url: 'https://h.example.com',
          description: '  ERP  ',
          events: ['crm.deal.won'],
        },
        API,
      ),
    )
    expect(created.secret).toMatch(/^whsec_/)
    expect(endpoints.create).toHaveBeenCalledWith({
      workspaceId: WS,
      url: 'https://h.example.com',
      description: 'ERP',
      events: ['crm.deal.won'],
      encryptedSecret: `enc(${created.secret})`,
      secretHint: created.secret.slice(-4),
      active: true,
      createdById: ADMIN,
    })
    expect(created.endpoint.secretHint).toBe(
      `whsec_…${created.secret.slice(-4)}`,
    )
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'webhook_endpoint',
        action: 'create',
        targetId: 'e-new',
        meta: expect.objectContaining({ source: 'api', workspaceId: WS }),
      }),
    )
  })

  it('should create a disabled endpoint without a description', async () => {
    expectOk(
      await WebhookService.createEndpoint(ADMIN, WS, {
        url: 'https://h.example.com',
        events: ['*'],
        active: false,
      }),
    )
    expect(endpoints.create).toHaveBeenCalledWith(
      expect.objectContaining({ description: null, active: false }),
    )
  })

  it('should enforce the per-workspace limit', async () => {
    endpoints.countByWorkspace.mockResolvedValue(ok(WEBHOOK_ENDPOINT_LIMIT))
    const error = expectErr(
      await WebhookService.createEndpoint(ADMIN, WS, {
        url: 'https://h.example.com',
        events: ['*'],
      }),
      'WEBHOOK_ENDPOINT_LIMIT_REACHED',
    )
    expect(error.message).toContain(String(WEBHOOK_ENDPOINT_LIMIT))
  })

  it('should refuse a private URL and audit the failure', async () => {
    mocks.checkUrl.mockResolvedValue({ ok: false, reason: 'private_host' })
    expectErr(
      await WebhookService.createEndpoint(ADMIN, WS, {
        url: 'https://10.0.0.1',
        events: ['*'],
      }),
      'WEBHOOK_URL_NOT_ALLOWED',
    )
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'create',
        outcome: 'failure',
        reason: 'WEBHOOK_URL_NOT_ALLOWED',
      }),
    )
    expect(endpoints.create).not.toHaveBeenCalled()
  })

  it('should update fields and re-check a new URL only', async () => {
    expectOk(
      await WebhookService.updateEndpoint(ADMIN, WS, 'e1', {
        url: endpoint.url,
        description: null,
        events: ['crm.lead.created'],
      }),
    )
    expect(mocks.checkUrl).not.toHaveBeenCalled()
    expect(endpoints.update).toHaveBeenCalledWith('e1', {
      url: endpoint.url,
      description: null,
      events: ['crm.lead.created'],
    })

    mocks.checkUrl.mockResolvedValue({ ok: false, reason: 'not_https' })
    expectErr(
      await WebhookService.updateEndpoint(ADMIN, WS, 'e1', {
        url: 'https://new.example.com',
      }),
      'WEBHOOK_URL_NOT_ALLOWED',
    )
  })

  it('should clear the failure state when re-enabled and record a manual switch-off', async () => {
    endpoints.findById.mockResolvedValue(
      ok(
        createFakeWebhookEndpoint({
          ...endpoint,
          active: false,
          failingSince: new Date(),
        }),
      ),
    )
    expectOk(
      await WebhookService.updateEndpoint(ADMIN, WS, 'e1', { active: true }),
    )
    expect(endpoints.update).toHaveBeenLastCalledWith('e1', {
      active: true,
      disabledAt: null,
      disabledReason: null,
      failingSince: null,
    })

    endpoints.findById.mockResolvedValue(ok(endpoint))
    expectOk(
      await WebhookService.updateEndpoint(ADMIN, WS, 'e1', {
        active: false,
        description: ' x ',
      }),
    )
    expect(endpoints.update).toHaveBeenLastCalledWith('e1', {
      active: false,
      description: 'x',
      disabledAt: expect.any(Date),
      disabledReason: 'manual',
    })

    expectOk(
      await WebhookService.updateEndpoint(ADMIN, WS, 'e1', { active: true }),
    )
    expect(endpoints.update).toHaveBeenLastCalledWith('e1', { active: true })
  })

  it('should delete an endpoint', async () => {
    expect(
      expectOk(await WebhookService.deleteEndpoint(ADMIN, WS, 'e1')),
    ).toEqual({ id: 'e1' })
    expect(endpoints.softDelete).toHaveBeenCalledWith('e1')
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'delete' }),
    )
  })

  it('should reveal (audited) and rotate the secret', async () => {
    expect(
      expectOk(await WebhookService.revealSecret(ADMIN, WS, 'e1')),
    ).toEqual({
      secret: 'whsec_plain',
    })
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'reveal', targetId: 'e1' }),
    )

    const rotated = expectOk(await WebhookService.rotateSecret(ADMIN, WS, 'e1'))
    expect(rotated.secret).toMatch(/^whsec_/)
    expect(rotated.secret).not.toBe('whsec_plain')
    expect(endpoints.update).toHaveBeenCalledWith('e1', {
      encryptedSecret: `enc(${rotated.secret})`,
      secretHint: rotated.secret.slice(-4),
    })
  })

  it('should report an unreadable secret as not found', async () => {
    mocks.decrypt.mockRejectedValue(new Error('bad key'))
    expectErr(
      await WebhookService.revealSecret(ADMIN, WS, 'e1'),
      'WEBHOOK_ENDPOINT_NOT_FOUND',
    )
  })
})

describe('testEndpoint', () => {
  it('should send a ping inline to this endpoint only and return the delivery', async () => {
    const delivery = expectOk(
      await WebhookService.testEndpoint(ADMIN, WS, 'e1'),
    )
    expect(delivery.status).toBe('SUCCEEDED')
    expect(dispatch).toHaveBeenCalledWith(
      WS,
      'steel.ping',
      expect.any(Object),
      {
        endpointIds: ['e1'],
        broadcast: false,
        enqueue: false,
      },
    )
    expect(mocks.run).toHaveBeenCalledWith('d-ping', {
      finalAttempt: true,
      manual: true,
    })
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'test', outcome: 'success' }),
    )
  })

  it('should audit a failed ping', async () => {
    mocks.run.mockResolvedValue(
      ok({
        outcome: 'failed',
        delivery: createFakeWebhookDelivery({
          status: 'FAILED',
          error: 'http_500',
        }),
      }),
    )
    expectOk(await WebhookService.testEndpoint(ADMIN, WS, 'e1'))
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'test',
        outcome: 'failure',
        reason: 'http_500',
      }),
    )
  })

  it('should propagate dispatch and run errors', async () => {
    dispatch.mockResolvedValueOnce(err(DB))
    expectErr(
      await WebhookService.testEndpoint(ADMIN, WS, 'e1'),
      'DATABASE_ERROR',
    )

    dispatch.mockResolvedValueOnce(
      ok({
        event: {
          id: 'evt',
          type: 'steel.ping',
          createdAt: '',
          workspaceId: WS,
          data: { message: '' },
        },
        deliveries: [],
      }),
    )
    expectErr(
      await WebhookService.testEndpoint(ADMIN, WS, 'e1'),
      'WEBHOOK_DELIVERY_NOT_FOUND',
    )

    mocks.run.mockResolvedValueOnce(err(DB))
    expectErr(
      await WebhookService.testEndpoint(ADMIN, WS, 'e1'),
      'DATABASE_ERROR',
    )

    mocks.run.mockResolvedValueOnce(ok({ outcome: 'skipped', delivery: null }))
    expectErr(
      await WebhookService.testEndpoint(ADMIN, WS, 'e1'),
      'WEBHOOK_DELIVERY_NOT_FOUND',
    )
  })
})

describe('deliveries', () => {
  it('should list a page, checking the endpoint filter belongs to the workspace', async () => {
    const page = expectOk(
      await WebhookService.listDeliveries(ADMIN, WS, {
        limit: 10,
        endpointId: 'e1',
      }),
    )
    expect(page).toMatchObject({ nextCursor: 'd1', items: [{ id: 'd1' }] })
    expect(endpoints.findById).toHaveBeenCalledWith('e1', WS)
    expect(deliveries.list).toHaveBeenCalledWith(WS, {
      limit: 10,
      endpointId: 'e1',
    })

    endpoints.findById.mockResolvedValue(err(webhookEndpointNotFound()))
    expectErr(
      await WebhookService.listDeliveries(ADMIN, WS, {
        limit: 10,
        endpointId: 'x',
      }),
      'WEBHOOK_ENDPOINT_NOT_FOUND',
    )
  })

  it('should re-deliver manually: back to PENDING and one more job', async () => {
    const delivery = expectOk(
      await WebhookService.retryDelivery(ADMIN, WS, 'd1'),
    )
    expect(delivery.status).toBe('PENDING')
    expect(enqueue).toHaveBeenCalledWith('d1', { manual: true, attempt: 3 })
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'webhook_delivery',
        action: 'retry',
        targetId: 'd1',
      }),
    )
  })

  it('should not re-deliver to a removed endpoint', async () => {
    endpoints.findById.mockResolvedValue(err(webhookEndpointNotFound()))
    expectErr(
      await WebhookService.retryDelivery(ADMIN, WS, 'd1'),
      'WEBHOOK_ENDPOINT_NOT_FOUND',
    )
    expect(enqueue).not.toHaveBeenCalled()
  })
})

describe('trigger', () => {
  it('should send the sample data to the listeners only', async () => {
    dispatch.mockResolvedValue(
      ok({
        event: {
          id: 'evt_9',
          type: 'crm.deal.won',
          createdAt: '',
          workspaceId: WS,
          data: {} as never,
        },
        deliveries: [],
      }),
    )
    expect(
      expectOk(
        await WebhookService.trigger(ADMIN, WS, { type: 'crm.deal.won' }, API),
      ),
    ).toEqual({
      event: { id: 'evt_9', type: 'crm.deal.won' },
      deliveries: 0,
    })
    expect(dispatch).toHaveBeenCalledWith(
      WS,
      'crm.deal.won',
      expect.objectContaining({ source: 'opportunity' }),
      {
        endpointIds: [],
      },
    )
  })

  it('should also deliver to the chosen endpoint of the workspace', async () => {
    expectOk(
      await WebhookService.trigger(ADMIN, WS, {
        type: 'crm.deal.won',
        endpointId: 'e1',
      }),
    )
    expect(dispatch).toHaveBeenCalledWith(
      WS,
      'crm.deal.won',
      expect.any(Object),
      { endpointIds: ['e1'] },
    )

    endpoints.findById.mockResolvedValue(err(webhookEndpointNotFound()))
    expectErr(
      await WebhookService.trigger(ADMIN, WS, {
        type: 'crm.deal.won',
        endpointId: 'x',
      }),
      'WEBHOOK_ENDPOINT_NOT_FOUND',
    )
  })

  it('should refuse an event of a module outside the token', async () => {
    const error = expectErr(
      await WebhookService.trigger(
        ADMIN,
        WS,
        { type: 'servicedesk.ticket.created' },
        API,
      ),
      'FORBIDDEN',
    )
    expect(error.message).toContain('módulo')
  })

  it('should propagate a dispatch error', async () => {
    dispatch.mockResolvedValue(err(DB))
    expectErr(
      await WebhookService.trigger(ADMIN, WS, { type: 'crm.deal.won' }),
      'DATABASE_ERROR',
    )
  })
})

describe('openListen', () => {
  it('should give a stable per-member secret and filter by type and module', async () => {
    const listen = expectOk(
      await WebhookService.openListen(ADMIN, WS, ['crm.deal.won'], API),
    )
    expect(listen.secret).toBe(webhookListenSecret(WS, ADMIN))
    expect(listen.secret).not.toBe(webhookListenSecret(WS, 'someone-else'))
    expect(listen.accepts('crm.deal.won')).toBe(true)
    expect(listen.accepts('crm.lead.created')).toBe(false)
    expect(listen.accepts('steel.ping')).toBe(false)

    const all = expectOk(await WebhookService.openListen(ADMIN, WS, [], API))
    expect(all.accepts('crm.lead.created')).toBe(true)
    expect(all.accepts('servicedesk.ticket.created')).toBe(false)
  })
})

describe('database errors', () => {
  it('should propagate them as err(...)', async () => {
    endpoints.listByWorkspace.mockResolvedValue(err(DB))
    expectErr(await WebhookService.listEndpoints(ADMIN, WS), 'DATABASE_ERROR')

    endpoints.countByWorkspace.mockResolvedValue(err(DB))
    expectErr(
      await WebhookService.createEndpoint(ADMIN, WS, {
        url: 'https://h.example.com',
        events: ['*'],
      }),
      'DATABASE_ERROR',
    )
    endpoints.countByWorkspace.mockResolvedValue(ok(0))
    endpoints.create.mockResolvedValue(err(DB))
    expectErr(
      await WebhookService.createEndpoint(ADMIN, WS, {
        url: 'https://h.example.com',
        events: ['*'],
      }),
      'DATABASE_ERROR',
    )

    endpoints.update.mockResolvedValue(err(DB))
    expectErr(
      await WebhookService.updateEndpoint(ADMIN, WS, 'e1', { events: ['*'] }),
      'DATABASE_ERROR',
    )
    expectErr(
      await WebhookService.rotateSecret(ADMIN, WS, 'e1'),
      'DATABASE_ERROR',
    )

    endpoints.softDelete.mockResolvedValue(err(DB))
    expectErr(
      await WebhookService.deleteEndpoint(ADMIN, WS, 'e1'),
      'DATABASE_ERROR',
    )

    deliveries.list.mockResolvedValue(err(DB))
    expectErr(
      await WebhookService.listDeliveries(ADMIN, WS, { limit: 5 }),
      'DATABASE_ERROR',
    )

    deliveries.markPending.mockResolvedValue(err(DB))
    expectErr(
      await WebhookService.retryDelivery(ADMIN, WS, 'd1'),
      'DATABASE_ERROR',
    )
    deliveries.findById.mockResolvedValue(err(DB))
    expectErr(
      await WebhookService.retryDelivery(ADMIN, WS, 'd1'),
      'DATABASE_ERROR',
    )

    endpoints.findById.mockResolvedValue(err(DB))
    for (const result of await Promise.all([
      WebhookService.deleteEndpoint(ADMIN, WS, 'e1'),
      WebhookService.revealSecret(ADMIN, WS, 'e1'),
      WebhookService.rotateSecret(ADMIN, WS, 'e1'),
      WebhookService.testEndpoint(ADMIN, WS, 'e1'),
    ])) {
      expectErr(result, 'DATABASE_ERROR')
    }
  })
})
