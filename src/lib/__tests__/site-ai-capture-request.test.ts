import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ add: vi.fn() }))

vi.mock('@/src/lib/queue/queues', () => ({
  getSiteReferenceCaptureQueue: () => ({ add: mocks.add }),
}))
vi.mock('@/src/lib/queue/connection', () => ({
  getQueueConnection: () => ({}),
}))

import {
  awaitCapture,
  CAPTURE_WAIT_TIMEOUT_MESSAGE,
  requestCapture,
} from '@/src/lib/site-ai/fidelity/capture/request'

describe('requestCapture', () => {
  it('should queue the job and return the request id', async () => {
    mocks.add.mockResolvedValue(undefined)
    const result = await requestCapture('ws-1', 'https://example.com/a')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(mocks.add).toHaveBeenCalledWith(
      'capture',
      {
        workspaceId: 'ws-1',
        url: 'https://example.com/a',
        requestId: result.value.requestId,
      },
      { jobId: `site-reference-capture-${result.value.requestId}` },
    )
  })

  it('should refuse invalid and non-web URLs', async () => {
    expect((await requestCapture('ws-1', 'not a url')).ok).toBe(false)
    expect((await requestCapture('ws-1', 'ftp://example.com')).ok).toBe(false)
  })
})

describe('awaitCapture', () => {
  it('should poll until the result shows up', async () => {
    const stored = JSON.stringify({ ok: true, value: { url: 'https://x.com' } })
    const get = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(stored)
    const result = await awaitCapture('req', 10_000, {
      redis: { get, set: vi.fn() },
      sleep: async () => undefined,
    })
    expect(result.ok).toBe(true)
    expect(get).toHaveBeenCalledTimes(3)
  })

  it('should fail in pt-BR when the time runs out', async () => {
    let clock = 0
    const result = await awaitCapture('req', 1_000, {
      redis: { get: vi.fn().mockResolvedValue(null), set: vi.fn() },
      now: () => clock,
      sleep: async (ms) => {
        clock += ms
      },
    })
    expect(result).toMatchObject({
      ok: false,
      error: { message: CAPTURE_WAIT_TIMEOUT_MESSAGE },
    })
  })
})
