import { beforeEach, describe, expect, it, vi } from 'vitest'

const { addMock, loggerMock } = vi.hoisted(() => ({
  addMock: vi.fn(),
  loggerMock: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('@/src/lib/queue/queues', () => ({
  getServicedeskMailQueue: () => ({ add: addMock }),
}))
vi.mock('@/lib/axiom/logger', () => ({ logger: loggerMock }))

import { enqueueSdStatusUpdateNotice } from '../servicedesk/status-notify-queue'

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
