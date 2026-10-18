import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createWebhookListenStream,
  webhookListenFrame,
} from '@/src/lib/webhooks/listen-stream'
import type { WebhookRealtimeMessage } from '@/src/lib/webhooks/realtime'
import {
  signWebhookPayload,
  verifyWebhookSignature,
} from '@/src/lib/webhooks/signature'

const SECRET = 'whsec_listen'

async function readChunks(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  count: number,
): Promise<string[]> {
  const decoder = new TextDecoder()
  const out: string[] = []
  for (let i = 0; i < count; i++) {
    const { value } = await reader.read()
    out.push(decoder.decode(value))
  }
  return out
}

describe('webhook listen stream', () => {
  afterEach(() => vi.useRealTimers())

  it('should sign the exact body with the listen secret', () => {
    const frame = webhookListenFrame(
      { id: 'evt_1', type: 'crm.lead.created', body: '{"a":1}' },
      SECRET,
      1_760_788_800_500,
    )
    expect(frame).toEqual({
      id: 'evt_1',
      timestamp: 1_760_788_800,
      signature: signWebhookPayload(SECRET, 1_760_788_800, '{"a":1}'),
      body: '{"a":1}',
    })
  })

  it('should send ready, then the accepted events, and unsubscribe on cancel', async () => {
    let push: ((message: WebhookRealtimeMessage) => void) | undefined
    const unsubscribe = vi.fn()
    const stream = createWebhookListenStream({
      workspaceId: 'w1',
      secret: SECRET,
      events: ['crm.lead.created'],
      accepts: (type) => type === 'crm.lead.created',
      subscribe: (onMessage) => {
        push = onMessage
        return unsubscribe
      },
      now: () => 1_760_788_800_000,
    })
    const reader = stream.getReader()
    const [ready] = await readChunks(reader, 1)
    expect(ready).toBe(
      `event: ready\ndata: ${JSON.stringify({ workspaceId: 'w1', events: ['crm.lead.created'], secret: SECRET })}\n\n`,
    )

    push?.({ id: 'evt_skip', type: 'crm.deal.won', body: '{}' })
    push?.({ id: 'evt_1', type: 'crm.lead.created', body: '{"x":true}' })
    const [webhook] = await readChunks(reader, 1)
    expect(webhook.startsWith('event: webhook\nid: evt_1\ndata: ')).toBe(true)
    const frame = JSON.parse(webhook.split('data: ')[1])
    expect(frame.body).toBe('{"x":true}')
    expect(
      verifyWebhookSignature({
        secret: SECRET,
        body: frame.body,
        timestamp: frame.timestamp,
        signature: frame.signature,
        nowSeconds: frame.timestamp,
      }),
    ).toBe(true)

    await reader.cancel()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
    // after cancel nothing is sent (and nothing throws)
    push?.({ id: 'evt_2', type: 'crm.lead.created', body: '{}' })
  })

  it('should send a heartbeat comment', async () => {
    vi.useFakeTimers()
    const stream = createWebhookListenStream({
      workspaceId: 'w1',
      secret: SECRET,
      events: [],
      accepts: () => true,
      subscribe: () => () => undefined,
      heartbeatMs: 1000,
    })
    const reader = stream.getReader()
    await readChunks(reader, 1)
    vi.advanceTimersByTime(1000)
    const [ping] = await readChunks(reader, 1)
    expect(ping).toBe(': ping\n\n')
    await reader.cancel()
  })
})
