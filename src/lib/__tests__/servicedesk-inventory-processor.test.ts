import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { databaseError } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('@/src/services/sd-inventory-target.service')

import { SdInventoryTargetService } from '@/src/services/sd-inventory-target.service'
import { processServicedeskInventory } from '../queue/processors/servicedesk-inventory'

const service = vi.mocked(SdInventoryTargetService)

function job(name: string, data: { targetId?: string } = {}) {
  return { id: 'j1', name, data } as unknown as Job<{ targetId?: string }>
}

beforeEach(() => {
  service.enqueueDue.mockResolvedValue(ok(3))
  service.runScan.mockResolvedValue(
    ok({ status: 'SUCCESS', probed: 2, found: 1, failed: 0 }),
  )
})

describe('processServicedeskInventory', () => {
  it('enqueues the due targets on scan-due', async () => {
    expect(await processServicedeskInventory(job('scan-due'))).toEqual({
      enqueued: 3,
    })
  })

  it('throws so BullMQ records an infrastructure failure on scan-due', async () => {
    service.enqueueDue.mockResolvedValue(err(databaseError()))
    await expect(processServicedeskInventory(job('scan-due'))).rejects.toThrow(
      'scan-due failed: DATABASE_ERROR',
    )
  })

  it('runs the scan of the target on scan-target', async () => {
    const result = await processServicedeskInventory(
      job('scan-target', { targetId: 'tgt-1' }),
    )
    expect(service.runScan).toHaveBeenCalledWith('tgt-1')
    expect(result).toMatchObject({ status: 'SUCCESS', found: 1 })
  })

  it('completes quietly when the target vanished', async () => {
    service.runScan.mockResolvedValue(ok(null))
    expect(
      await processServicedeskInventory(
        job('scan-target', { targetId: 'tgt-1' }),
      ),
    ).toBeNull()
  })

  it('throws on a scan infrastructure failure', async () => {
    service.runScan.mockResolvedValue(err(databaseError()))
    await expect(
      processServicedeskInventory(job('scan-target', { targetId: 'tgt-1' })),
    ).rejects.toThrow('scan failed: DATABASE_ERROR')
  })

  it('rejects a scan-target job without target id', async () => {
    await expect(
      processServicedeskInventory(job('scan-target')),
    ).rejects.toThrow('without targetId')
  })

  it('rejects an unknown job name', async () => {
    await expect(processServicedeskInventory(job('nope'))).rejects.toThrow(
      'Unknown servicedesk-inventory job',
    )
  })

  it('tolerates a job without data', async () => {
    const broken = { id: 'j2', name: 'scan-target' } as unknown as Job<{
      targetId?: string
    }>
    await expect(processServicedeskInventory(broken)).rejects.toThrow(
      'without targetId',
    )
  })

  it('reports "unknown" when the job has no id', async () => {
    const anonymous = { name: 'nope', data: {} } as unknown as Job<{
      targetId?: string
    }>
    await expect(processServicedeskInventory(anonymous)).rejects.toThrow(
      'id=unknown',
    )
    const noTarget = { name: 'scan-target', data: {} } as unknown as Job<{
      targetId?: string
    }>
    await expect(processServicedeskInventory(noTarget)).rejects.toThrow(
      'id=unknown',
    )
  })
})
