import { beforeEach, describe, expect, it, vi } from 'vitest'

const publish = vi.fn()
const subscribe = vi.fn()
const unsubscribe = vi.fn()
const quit = vi.fn()
const handlers: Record<string, (...args: string[]) => void> = {}
const duplicate = vi.fn(() => ({
  subscribe,
  unsubscribe,
  quit,
  on: (name: string, fn: (...args: string[]) => void) => {
    handlers[name] = fn
  },
}))

vi.mock('@/src/lib/queue/connection', () => ({
  getQueueConnection: () => ({ publish, duplicate }),
}))
vi.mock('@/lib/axiom/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}))

import { logger } from '@/lib/axiom/logger'
import {
  publishWebhookEvent,
  subscribeWebhookEvents,
  webhookChannel,
} from '@/src/lib/webhooks/realtime'

const message = { id: 'evt_1', type: 'crm.lead.created' as const, body: '{}' }

beforeEach(() => {
  publish.mockResolvedValue(1)
  subscribe.mockResolvedValue(1)
  unsubscribe.mockResolvedValue(1)
  quit.mockResolvedValue('OK')
})

describe('webhook realtime feed', () => {
  it('should publish the message on the workspace channel', async () => {
    await publishWebhookEvent('w1', message)
    expect(publish).toHaveBeenCalledWith(
      'webhooks:workspace:w1',
      JSON.stringify(message),
    )
    expect(webhookChannel('w1')).toBe('webhooks:workspace:w1')
  })

  it('should log (not throw) when Redis refuses the publish', async () => {
    publish.mockRejectedValueOnce(new Error('down'))
    await expect(publishWebhookEvent('w1', message)).resolves.toBeUndefined()
    publish.mockRejectedValueOnce('down')
    await publishWebhookEvent('w1', message)
    expect(vi.mocked(logger.error)).toHaveBeenCalledTimes(2)
  })

  it('should deliver the channel messages, ignore others and malformed ones', async () => {
    const received: unknown[] = []
    const stop = subscribeWebhookEvents('w1', (m) => received.push(m))
    expect(subscribe).toHaveBeenCalledWith('webhooks:workspace:w1')
    handlers.message('webhooks:workspace:w2', JSON.stringify(message))
    handlers.message('webhooks:workspace:w1', '{oops')
    handlers.message('webhooks:workspace:w1', JSON.stringify(message))
    expect(received).toEqual([message])

    stop()
    await vi.waitFor(() => expect(quit).toHaveBeenCalled())
    expect(unsubscribe).toHaveBeenCalledWith('webhooks:workspace:w1')
  })

  it('should log a failed subscription and survive a failed quit', async () => {
    subscribe.mockRejectedValueOnce(new Error('nope'))
    quit.mockRejectedValueOnce(new Error('closed'))
    const stop = subscribeWebhookEvents('w1', () => undefined)
    await vi.waitFor(() => expect(vi.mocked(logger.error)).toHaveBeenCalled())
    subscribe.mockRejectedValueOnce('nope')
    subscribeWebhookEvents('w2', () => undefined)
    stop()
    await vi.waitFor(() => expect(quit).toHaveBeenCalled())
  })
})
