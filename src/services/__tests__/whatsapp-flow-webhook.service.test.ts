import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakePublishedFlow } from '@/src/__tests__/factories/nov-z3-whatsapp-flows.factory'
import { createFakeWhatsAppConnection } from '@/src/__tests__/factories/whatsapp-connection.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/repositories/whatsapp-connection.repository')
vi.mock('@/src/repositories/whatsapp-flow.repository')
vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { WhatsAppConnectionRepository } from '@/src/repositories/whatsapp-connection.repository'
import { WhatsAppFlowRepository } from '@/src/repositories/whatsapp-flow.repository'
import { WhatsAppFlowWebhookService } from '../whatsapp-flow-webhook.service'

const connectionRepo = vi.mocked(WhatsAppConnectionRepository)
const flowRepo = vi.mocked(WhatsAppFlowRepository)

const change = (overrides = {}) => ({
  wabaId: 'waba-1',
  value: {
    event: 'FLOW_STATUS_CHANGE',
    flow_id: 'meta-flow-1',
    old_status: 'PUBLISHED',
    new_status: 'BLOCKED',
    ...overrides,
  },
})

beforeEach(() => {
  vi.resetAllMocks()
  connectionRepo.listByMetaWabaId.mockResolvedValue(
    ok([createFakeWhatsAppConnection({ id: 'conn-1' })]),
  )
  flowRepo.update.mockResolvedValue(ok(createFakePublishedFlow()))
})

describe('WhatsAppFlowWebhookService.applyStatusChange', () => {
  it('stores the status Meta reports on the flows of that WABA', async () => {
    flowRepo.listByMetaFlowId.mockResolvedValue(
      ok([createFakePublishedFlow({ id: 'f1' })]),
    )

    expect(
      expectOk(await WhatsAppFlowWebhookService.applyStatusChange(change())),
    ).toEqual({ updated: 1 })

    expect(flowRepo.listByMetaFlowId).toHaveBeenCalledWith('meta-flow-1', [
      'conn-1',
    ])
    expect(flowRepo.update).toHaveBeenCalledWith('f1', {
      metaStatus: 'BLOCKED',
      publishError: expect.stringContaining('bloqueou'),
    })
  })

  it('notes a throttled flow and keeps it published here', async () => {
    flowRepo.listByMetaFlowId.mockResolvedValue(
      ok([createFakePublishedFlow({ id: 'f1' })]),
    )
    await WhatsAppFlowWebhookService.applyStatusChange(
      change({ new_status: 'throttled' }),
    )
    const data = flowRepo.update.mock.calls[0][1]
    expect(data).toMatchObject({ metaStatus: 'THROTTLED' })
    expect(data).not.toHaveProperty('status')
    expect(String(data.publishError)).toContain('limitou')
  })

  it('retires the flow when Meta deprecates it', async () => {
    flowRepo.listByMetaFlowId.mockResolvedValue(
      ok([createFakePublishedFlow({ id: 'f1' })]),
    )
    await WhatsAppFlowWebhookService.applyStatusChange(
      change({ new_status: 'DEPRECATED' }),
    )
    expect(flowRepo.update).toHaveBeenCalledWith('f1', {
      metaStatus: 'DEPRECATED',
      status: 'DEPRECATED',
    })
  })

  it('clears the suspension note when the flow recovers', async () => {
    flowRepo.listByMetaFlowId.mockResolvedValue(
      ok([
        createFakePublishedFlow({
          id: 'f1',
          metaStatus: 'BLOCKED',
          publishError: 'nota',
        }),
      ]),
    )
    await WhatsAppFlowWebhookService.applyStatusChange(
      change({ new_status: 'PUBLISHED' }),
    )
    expect(flowRepo.update).toHaveBeenCalledWith('f1', {
      metaStatus: 'PUBLISHED',
      publishError: null,
    })
  })

  it('does not touch an unrelated publish error', async () => {
    flowRepo.listByMetaFlowId.mockResolvedValue(
      ok([createFakePublishedFlow({ id: 'f1', metaStatus: 'DRAFT' })]),
    )
    await WhatsAppFlowWebhookService.applyStatusChange(
      change({ new_status: 'PUBLISHED' }),
    )
    expect(flowRepo.update).toHaveBeenCalledWith('f1', {
      metaStatus: 'PUBLISHED',
    })
  })

  it('is idempotent for a repeated delivery', async () => {
    flowRepo.listByMetaFlowId.mockResolvedValue(
      ok([createFakePublishedFlow({ metaStatus: 'BLOCKED' })]),
    )
    expect(
      expectOk(await WhatsAppFlowWebhookService.applyStatusChange(change())),
    ).toEqual({ updated: 0 })
    expect(flowRepo.update).not.toHaveBeenCalled()
  })

  it.each([
    ['another event', { event: 'ENDPOINT_AVAILABILITY' }],
    ['no flow id', { flow_id: undefined }],
    ['no new status', { new_status: undefined }],
    ['an unknown status', { new_status: 'EXPLODED' }],
  ])('ignores %s', async (_name, overrides) => {
    expect(
      expectOk(
        await WhatsAppFlowWebhookService.applyStatusChange(change(overrides)),
      ),
    ).toEqual({ updated: 0 })
    expect(connectionRepo.listByMetaWabaId).not.toHaveBeenCalled()
  })

  it('ignores a WABA without connections', async () => {
    connectionRepo.listByMetaWabaId.mockResolvedValue(ok([]))
    expect(
      expectOk(await WhatsAppFlowWebhookService.applyStatusChange(change())),
    ).toEqual({ updated: 0 })
    expect(flowRepo.listByMetaFlowId).not.toHaveBeenCalled()
  })

  it('propagates database failures', async () => {
    connectionRepo.listByMetaWabaId.mockResolvedValueOnce(
      err(databaseError('x')),
    )
    expectErr(
      await WhatsAppFlowWebhookService.applyStatusChange(change()),
      'DATABASE_ERROR',
    )
    flowRepo.listByMetaFlowId.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await WhatsAppFlowWebhookService.applyStatusChange(change()),
      'DATABASE_ERROR',
    )
    flowRepo.listByMetaFlowId.mockResolvedValueOnce(
      ok([createFakePublishedFlow()]),
    )
    flowRepo.update.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await WhatsAppFlowWebhookService.applyStatusChange(change()),
      'DATABASE_ERROR',
    )
  })
})
