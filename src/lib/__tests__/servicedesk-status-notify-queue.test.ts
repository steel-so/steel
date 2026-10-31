import { beforeEach, describe, expect, it, vi } from 'vitest'

const { addMock, loggerMock } = vi.hoisted(() => ({
  addMock: vi.fn(),
  loggerMock: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('@/src/lib/queue/queues', () => ({
  getServicedeskMailQueue: () => ({ add: addMock }),
}))
vi.mock('@/lib/axiom/logger', () => ({ logger: loggerMock }))

import {
  enqueueSdMaintenanceNotice,
  enqueueSdStatusUpdateNotice,
} from '../servicedesk/status-notify-queue'

beforeEach(() => vi.clearAllMocks())

describe('enqueueSdStatusUpdateNotice', () => {
  it('enqueues one idempotent job per update', async () => {
    await enqueueSdStatusUpdateNotice('u1')
    expect(addMock).toHaveBeenCalledWith(
      'notify-status-update',
      { updateId: 'u1' },
      { jobId: 'status-update-u1' },
    )
  })

  it('never throws when Redis is down', async () => {
    addMock.mockRejectedValue(new Error('down'))
    await expect(enqueueSdStatusUpdateNotice('u1')).resolves.toBeUndefined()
    expect(loggerMock.error).toHaveBeenCalled()
    addMock.mockRejectedValue('x')
    await enqueueSdStatusUpdateNotice('u2')
  })
})

describe('enqueueSdMaintenanceNotice', () => {
  it('enqueues one idempotent job per window and kind', async () => {
    addMock.mockResolvedValue(undefined)
    await enqueueSdMaintenanceNotice('m1', 'scheduled')
    await enqueueSdMaintenanceNotice('m1', 'canceled')
    expect(addMock).toHaveBeenCalledWith(
      'notify-maintenance',
      { maintenanceId: 'm1', kind: 'scheduled' },
      { jobId: 'maintenance-scheduled-m1' },
    )
    expect(addMock).toHaveBeenCalledWith(
      'notify-maintenance',
      { maintenanceId: 'm1', kind: 'canceled' },
      { jobId: 'maintenance-canceled-m1' },
    )
  })

  it('gives a rescheduled window a fresh job id', async () => {
    addMock.mockResolvedValue(undefined)
    await enqueueSdMaintenanceNotice('m1', 'rescheduled')
    const jobId = addMock.mock.calls[0][2].jobId as string
    expect(jobId).toMatch(/^maintenance-rescheduled-m1-\d+$/)
  })

  it('never throws when Redis is down', async () => {
    addMock.mockRejectedValue(new Error('down'))
    await expect(
      enqueueSdMaintenanceNotice('m1', 'scheduled'),
    ).resolves.toBeUndefined()
    addMock.mockRejectedValue('x')
    await enqueueSdMaintenanceNotice('m2', 'canceled')
    expect(loggerMock.error).toHaveBeenCalledTimes(2)
  })
})
