import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  decrypt: vi.fn(),
  checkUrl: vi.fn(),
  post: vi.fn(),
  emitNotification: vi.fn(),
  adminIds: vi.fn(),
}))

vi.mock('@/lib/axiom/audit')
vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('@/src/lib/crypto', () => ({
  decryptConnectionSecret: mocks.decrypt,
}))
vi.mock('@/src/lib/webhooks/url-guard', () => ({
  checkWebhookUrl: mocks.checkUrl,
}))
vi.mock('@/src/lib/webhooks/http', () => ({ postWebhook: mocks.post }))
vi.mock('../notification-emitter', () => ({
  emitNotification: mocks.emitNotification,
  workspaceAdminIds: mocks.adminIds,
}))
vi.mock('@/src/repositories/webhook-delivery.repository')
vi.mock('@/src/repositories/webhook-endpoint.repository')

import { auditMutation } from '@/lib/axiom/audit'
import {
  createFakeWebhookDelivery,
  createFakeWebhookDeliveryWithEndpoint,
  createFakeWebhookEndpoint,
} from '@/src/__tests__/factories/webhook.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError } from '@/src/errors'
import { err, ok } from '@/src/lib/result'
import { verifyWebhookSignature } from '@/src/lib/webhooks/signature'
import { WebhookDeliveryRepository } from '@/src/repositories/webhook-delivery.repository'
import { WebhookEndpointRepository } from '@/src/repositories/webhook-endpoint.repository'
import {
  runWebhookDelivery,
  WEBHOOK_AUTO_DISABLE_AFTER_MS,
} from '../webhook-delivery-runner'

const deliveries = vi.mocked(WebhookDeliveryRepository)
const endpoints = vi.mocked(WebhookEndpointRepository)
const NOW = new Date('2026-10-18T12:00:00.000Z')
const now = () => NOW
const SECRET = 'whsec_runner'

function load(
  delivery?: Parameters<typeof createFakeWebhookDeliveryWithEndpoint>[0],
  endpoint?: Parameters<typeof createFakeWebhookDeliveryWithEndpoint>[1],
) {
  const row = createFakeWebhookDeliveryWithEndpoint(
    { id: 'd1', workspaceId: 'w1', endpointId: 'e1', ...delivery },
    endpoint,
  )
  deliveries.findWithEndpoint.mockResolvedValue(ok(row))
  return row
}

beforeEach(() => {
  mocks.decrypt.mockResolvedValue(SECRET)
  mocks.checkUrl.mockImplementation(async (raw: string) => ({
    ok: true,
    url: new URL(raw),
  }))
  mocks.post.mockResolvedValue({
    ok: true,
    status: 200,
    responseBody: 'ok',
    durationMs: 42,
    error: null,
  })
  mocks.adminIds.mockResolvedValue(['admin-1'])
  mocks.emitNotification.mockResolvedValue(1)
  deliveries.recordAttempt.mockImplementation(async (id, data) =>
    ok(
      createFakeWebhookDelivery({ id, status: data.status, error: data.error }),
    ),
  )
  deliveries.markSkipped.mockResolvedValue(ok(undefined))
  endpoints.markSuccess.mockResolvedValue(ok(undefined))
  endpoints.markFailure.mockResolvedValue(
    ok(createFakeWebhookEndpoint({ id: 'e1', failingSince: NOW })),
  )
  endpoints.disable.mockResolvedValue(ok(true))
})

describe('runWebhookDelivery', () => {
  it('should sign the stored body, POST it and record the success', async () => {
    const row = load()
    const report = expectOk(
      await runWebhookDelivery('d1', { finalAttempt: false, now }),
    )
    expect(report.outcome).toBe('succeeded')

    const [{ url, body, headers }] = mocks.post.mock.calls[0]
    expect(String(url)).toBe(row.endpoint.url)
    expect(body).toBe(row.body)
    expect(headers['Steel-Webhook-Id']).toBe(row.eventId)
    expect(headers['Steel-Webhook-Timestamp']).toBe(
      String(Math.floor(NOW.getTime() / 1000)),
    )
    expect(
      verifyWebhookSignature({
        secret: SECRET,
        body: row.body,
        timestamp: headers['Steel-Webhook-Timestamp'],
        signature: headers['Steel-Signature'],
        nowSeconds: Math.floor(NOW.getTime() / 1000),
      }),
    ).toBe(true)
    expect(deliveries.recordAttempt).toHaveBeenCalledWith('d1', {
      status: 'SUCCEEDED',
      responseStatus: 200,
      responseBody: 'ok',
      durationMs: 42,
      error: null,
      at: NOW,
    })
    expect(endpoints.markSuccess).toHaveBeenCalledWith('e1', NOW)
  })

  it('should use the real clock by default', async () => {
    load()
    expectOk(await runWebhookDelivery('d1', { finalAttempt: true }))
    expect(deliveries.recordAttempt).toHaveBeenCalledWith(
      'd1',
      expect.objectContaining({ at: expect.any(Date) }),
    )
  })

  it('should mark RETRYING with attempts left and FAILED on the last one', async () => {
    mocks.post.mockResolvedValue({
      ok: false,
      status: 500,
      responseBody: 'boom',
      durationMs: 10,
      error: 'http_500',
    })
    load()
    const retry = expectOk(
      await runWebhookDelivery('d1', { finalAttempt: false, now }),
    )
    expect(retry.outcome).toBe('retry')
    expect(deliveries.recordAttempt).toHaveBeenLastCalledWith(
      'd1',
      expect.objectContaining({
        status: 'RETRYING',
        responseStatus: 500,
        error: 'http_500',
      }),
    )
    expect(endpoints.markFailure).toHaveBeenCalledWith('e1', NOW)

    const last = expectOk(
      await runWebhookDelivery('d1', { finalAttempt: true, now }),
    )
    expect(last.outcome).toBe('failed')
    expect(deliveries.recordAttempt).toHaveBeenLastCalledWith(
      'd1',
      expect.objectContaining({ status: 'FAILED' }),
    )
    expect(endpoints.disable).not.toHaveBeenCalled()
  })

  it('should fall back to a generic error label', async () => {
    mocks.post.mockResolvedValue({
      ok: false,
      status: null,
      responseBody: null,
      durationMs: 1,
      error: null,
    })
    load()
    expectOk(await runWebhookDelivery('d1', { finalAttempt: true, now }))
    expect(deliveries.recordAttempt).toHaveBeenLastCalledWith(
      'd1',
      expect.objectContaining({ error: 'failed' }),
    )
  })

  it('should auto-disable an endpoint failing for 3 days and notify the admins', async () => {
    mocks.post.mockResolvedValue({
      ok: false,
      status: 503,
      responseBody: null,
      durationMs: 5,
      error: 'http_503',
    })
    load(undefined, { url: 'https://erp.example.com/hook' })
    const since = new Date(NOW.getTime() - WEBHOOK_AUTO_DISABLE_AFTER_MS)
    endpoints.markFailure.mockResolvedValue(
      ok(
        createFakeWebhookEndpoint({
          id: 'e1',
          workspaceId: 'w1',
          failingSince: since,
          url: 'https://erp.example.com/hook',
        }),
      ),
    )
    expectOk(await runWebhookDelivery('d1', { finalAttempt: true, now }))
    expect(endpoints.disable).toHaveBeenCalledWith('e1', NOW, 'auto')
    expect(vi.mocked(auditMutation)).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'webhook_endpoint',
        action: 'disable',
        targetId: 'e1',
      }),
    )
    expect(mocks.emitNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'w1',
        recipients: ['admin-1'],
        kind: 'WEBHOOK_ENDPOINT_DISABLED',
        title: 'Webhook desativado: erp.example.com',
        path: '/settings/integrations/webhooks',
        dedupeKey: 'webhook-disabled:e1:2026-10-18',
      }),
    )
  })

  it('should not notify twice when the endpoint was already disabled', async () => {
    mocks.post.mockResolvedValue({
      ok: false,
      status: 500,
      responseBody: null,
      durationMs: 1,
      error: 'http_500',
    })
    load()
    endpoints.markFailure.mockResolvedValue(
      ok(
        createFakeWebhookEndpoint({
          failingSince: new Date(0),
          url: 'not a url',
        }),
      ),
    )
    endpoints.disable.mockResolvedValue(ok(false))
    expectOk(await runWebhookDelivery('d1', { finalAttempt: true, now }))
    expect(mocks.emitNotification).not.toHaveBeenCalled()
  })

  it('should keep the raw URL in the notice when it does not parse', async () => {
    mocks.post.mockResolvedValue({
      ok: false,
      status: 500,
      responseBody: null,
      durationMs: 1,
      error: 'http_500',
    })
    load()
    endpoints.markFailure.mockResolvedValue(
      ok(
        createFakeWebhookEndpoint({
          failingSince: new Date(0),
          url: 'not a url',
          workspaceId: 'w1',
        }),
      ),
    )
    expectOk(await runWebhookDelivery('d1', { finalAttempt: true, now }))
    expect(mocks.emitNotification).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Webhook desativado: not a url' }),
    )
  })

  it('should never let the ping touch the endpoint health', async () => {
    load({ eventType: 'steel.ping' })
    expectOk(
      await runWebhookDelivery('d1', { finalAttempt: true, manual: true, now }),
    )
    expect(endpoints.markSuccess).not.toHaveBeenCalled()

    mocks.post.mockResolvedValue({
      ok: false,
      status: 500,
      responseBody: null,
      durationMs: 1,
      error: 'http_500',
    })
    expectOk(
      await runWebhookDelivery('d1', { finalAttempt: true, manual: true, now }),
    )
    expect(endpoints.markFailure).not.toHaveBeenCalled()
  })

  it('should skip a disabled endpoint, unless the attempt is manual', async () => {
    load(undefined, { active: false })
    const skipped = expectOk(
      await runWebhookDelivery('d1', { finalAttempt: false, now }),
    )
    expect(skipped.outcome).toBe('skipped')
    expect(deliveries.markSkipped).toHaveBeenCalledWith(
      'd1',
      'endpoint_disabled',
    )
    expect(mocks.post).not.toHaveBeenCalled()

    const manual = expectOk(
      await runWebhookDelivery('d1', { finalAttempt: true, manual: true, now }),
    )
    expect(manual.outcome).toBe('succeeded')
  })

  it('should always skip a deleted endpoint and a vanished row', async () => {
    load(undefined, { deletedAt: NOW })
    expectOk(
      await runWebhookDelivery('d1', { finalAttempt: true, manual: true, now }),
    )
    expect(deliveries.markSkipped).toHaveBeenCalledWith(
      'd1',
      'endpoint_deleted',
    )

    deliveries.findWithEndpoint.mockResolvedValue(ok(null))
    expect(
      expectOk(await runWebhookDelivery('gone', { finalAttempt: true })),
    ).toEqual({
      outcome: 'skipped',
      delivery: null,
    })
  })

  it('should fail for good (no retry) on a refused URL', async () => {
    load()
    mocks.checkUrl.mockResolvedValue({ ok: false, reason: 'private_host' })
    const report = expectOk(
      await runWebhookDelivery('d1', { finalAttempt: false, now }),
    )
    expect(report.outcome).toBe('failed')
    expect(deliveries.recordAttempt).toHaveBeenCalledWith(
      'd1',
      expect.objectContaining({
        status: 'FAILED',
        error: 'url_not_allowed: private_host',
      }),
    )
    expect(mocks.post).not.toHaveBeenCalled()
  })

  it('should fail for good on an unreadable or empty secret', async () => {
    load()
    mocks.decrypt.mockRejectedValueOnce(new Error('bad key'))
    expect(
      expectOk(await runWebhookDelivery('d1', { finalAttempt: false, now }))
        .outcome,
    ).toBe('failed')
    mocks.decrypt.mockResolvedValueOnce('')
    expect(
      expectOk(await runWebhookDelivery('d1', { finalAttempt: false, now }))
        .outcome,
    ).toBe('failed')
    expect(deliveries.recordAttempt).toHaveBeenLastCalledWith(
      'd1',
      expect.objectContaining({ error: 'secret_unreadable' }),
    )
  })

  it('should propagate database errors', async () => {
    deliveries.findWithEndpoint.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await runWebhookDelivery('d1', { finalAttempt: true }),
      'DATABASE_ERROR',
    )

    load(undefined, { active: false })
    deliveries.markSkipped.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await runWebhookDelivery('d1', { finalAttempt: true }),
      'DATABASE_ERROR',
    )

    load()
    deliveries.recordAttempt.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await runWebhookDelivery('d1', { finalAttempt: true }),
      'DATABASE_ERROR',
    )

    mocks.decrypt.mockResolvedValueOnce('')
    expectErr(
      await runWebhookDelivery('d1', { finalAttempt: true }),
      'DATABASE_ERROR',
    )

    mocks.checkUrl.mockResolvedValueOnce({ ok: false, reason: 'not_https' })
    expectErr(
      await runWebhookDelivery('d1', { finalAttempt: true }),
      'DATABASE_ERROR',
    )

    mocks.post.mockResolvedValue({
      ok: false,
      status: 500,
      responseBody: null,
      durationMs: 1,
      error: 'http_500',
    })
    expectErr(
      await runWebhookDelivery('d1', { finalAttempt: true }),
      'DATABASE_ERROR',
    )
  })
})
