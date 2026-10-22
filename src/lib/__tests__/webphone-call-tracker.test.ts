import { beforeEach, describe, expect, it, vi } from 'vitest'

const fetchMock = vi.hoisted(() => vi.fn())
vi.mock('@/src/hooks/_fetch', () => ({ apiFetch: fetchMock }))

import type { WebphoneCallTrackingDTO } from '@/types/whatsapp-phone-call'
import { WebPhoneCallTracker } from '../webphone/call-tracker'

function tracking(
  overrides: Partial<WebphoneCallTrackingDTO> = {},
  notice: string | null = null,
): WebphoneCallTrackingDTO {
  return {
    call: { id: 'call/1', recordingNotice: notice } as never,
    callbackToken: 'tok',
    callbackUrl: 'https://steel.test/api/pabx/calls/webhook',
    record: false,
    adopted: false,
    ...overrides,
  }
}

const body = (call: number) => JSON.parse(fetchMock.mock.calls[call][1].body)

beforeEach(() => {
  vi.clearAllMocks()
  fetchMock.mockResolvedValue(tracking())
})

describe('WebPhoneCallTracker outbound', () => {
  it('registers the call first and hands back the callback headers', async () => {
    const onNotice = vi.fn()
    const tracker = new WebPhoneCallTracker('ws 1', onNotice)

    const headers = await tracker.prepareOutbound({
      number: '11999998888',
      name: 'Maria',
      conversationId: 'conv1',
    })

    expect(headers).toEqual([
      'X-Steel-Callback-Url: https://steel.test/api/pabx/calls/webhook',
      'X-Steel-Callback-Token: tok',
    ])
    expect(fetchMock.mock.calls[0][0]).toBe(
      '/api/workspaces/ws%201/phone-calls/webphone',
    )
    expect(body(0)).toEqual({
      direction: 'out',
      number: '11999998888',
      name: 'Maria',
      conversationId: 'conv1',
    })
    expect(onNotice).toHaveBeenCalledWith(null)
  })

  it('asks the PABX to record when the workspace does, and shows the notice', async () => {
    fetchMock.mockResolvedValue(
      tracking({ record: true }, 'Esta ligação será gravada.'),
    )
    const onNotice = vi.fn()
    const tracker = new WebPhoneCallTracker('ws1', onNotice)

    const headers = await tracker.prepareOutbound({
      number: '1',
      name: null,
    })

    expect(headers).toContain('X-Steel-Record: 1')
    expect(onNotice).toHaveBeenCalledWith('Esta ligação será gravada.')
  })

  it('still lets the call go out when it cannot be registered', async () => {
    fetchMock.mockRejectedValue(new Error('403'))
    const onNotice = vi.fn()
    const tracker = new WebPhoneCallTracker('ws1', onNotice)

    expect(await tracker.prepareOutbound({ number: '1', name: null })).toEqual(
      [],
    )
    expect(onNotice).toHaveBeenCalledWith(null)

    // The phone reports the call it placed; nothing is sent for it.
    tracker.handle({
      type: 'started',
      direction: 'out',
      number: '1',
      name: null,
      pabxUniqueId: null,
    })
    tracker.handle({ type: 'answered' })
    await Promise.resolve()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not register the same outbound call twice, and reports answered then ended in order', async () => {
    const onNotice = vi.fn()
    const tracker = new WebPhoneCallTracker('ws1', onNotice)
    await tracker.prepareOutbound({ number: '11999998888', name: null })

    tracker.handle({
      type: 'started',
      direction: 'out',
      number: '11999998888',
      name: null,
      pabxUniqueId: null,
    })
    tracker.handle({ type: 'answered' })
    tracker.handle({ type: 'ended', answered: true, outcome: 'completed' })
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))

    expect(fetchMock.mock.calls[1][0]).toBe(
      '/api/workspaces/ws1/phone-calls/call%2F1/webphone',
    )
    expect(fetchMock.mock.calls[1][1].method).toBe('PATCH')
    expect(body(1)).toEqual({ event: 'answered' })
    expect(body(2)).toEqual({ event: 'ended', outcome: 'completed' })
    expect(onNotice).toHaveBeenLastCalledWith(null)
  })

  it('closes the registered call as failed when the INVITE never left', async () => {
    const tracker = new WebPhoneCallTracker('ws1')
    await tracker.prepareOutbound({ number: '1', name: null })

    tracker.abandonPrepared()
    tracker.abandonPrepared()
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))

    expect(body(1)).toEqual({ event: 'ended', outcome: 'failed' })
  })
})

describe('WebPhoneCallTracker inbound', () => {
  it('registers the incoming call and reports its end', async () => {
    const tracker = new WebPhoneCallTracker('ws1')

    tracker.handle({
      type: 'started',
      direction: 'in',
      number: '11999998888',
      name: 'Maria',
      pabxUniqueId: '1729.1',
    })
    tracker.handle({ type: 'ended', answered: false, outcome: 'missed' })
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))

    expect(body(0)).toEqual({
      direction: 'in',
      number: '11999998888',
      name: 'Maria',
      pabxUniqueId: '1729.1',
    })
    expect(body(1)).toEqual({ event: 'ended', outcome: 'missed' })
  })

  it('omits the PABX id when the INVITE had none', async () => {
    const tracker = new WebPhoneCallTracker('ws1')
    tracker.handle({
      type: 'started',
      direction: 'in',
      number: '200',
      name: null,
      pabxUniqueId: null,
    })
    expect(body(0).pabxUniqueId).toBeUndefined()
  })

  it('ignores a step with no call being tracked', () => {
    const tracker = new WebPhoneCallTracker('ws1')
    tracker.handle({ type: 'answered' })
    tracker.abandonPrepared()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('survives a failing report', async () => {
    fetchMock
      .mockResolvedValueOnce(tracking())
      .mockRejectedValueOnce(new Error('offline'))
    const tracker = new WebPhoneCallTracker('ws1')
    tracker.handle({
      type: 'started',
      direction: 'in',
      number: '1',
      name: null,
      pabxUniqueId: null,
    })
    tracker.handle({ type: 'answered' })
    tracker.handle({ type: 'ended', answered: true, outcome: 'completed' })
    // The failed `answered` does not stop the `ended` that follows.
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
  })

  it('skips the report of a call the server never accepted', async () => {
    fetchMock.mockRejectedValueOnce(new Error('403'))
    const tracker = new WebPhoneCallTracker('ws1')
    tracker.handle({
      type: 'started',
      direction: 'in',
      number: '1',
      name: null,
      pabxUniqueId: null,
    })
    tracker.handle({ type: 'answered' })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
