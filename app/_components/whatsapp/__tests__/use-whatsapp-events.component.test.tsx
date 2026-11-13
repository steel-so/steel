import { QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestQueryClient } from '@/src/__tests__/component-utils'
import {
  REALTIME_FALLBACK_POLL_MS,
  REALTIME_RECONNECT_MS,
  useWhatsAppRealtimeEvents,
} from '@/src/hooks/use-whatsapp-events'

class FakeEventSource {
  static instances: FakeEventSource[] = []
  onopen: (() => void) | null = null
  onerror: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  readyState = 0
  close = vi.fn(() => {
    this.readyState = 2
  })
  constructor(readonly url: string) {
    FakeEventSource.instances.push(this)
  }
}

function setup() {
  const client = createTestQueryClient()
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  const hook = renderHook(() => useWhatsAppRealtimeEvents('ws_1'), { wrapper })
  return { ...hook, invalidate }
}

describe('useWhatsAppRealtimeEvents()', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    FakeEventSource.instances = []
    vi.stubGlobal('EventSource', FakeEventSource)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('opens the stream and reports it as open', () => {
    const { result } = setup()
    expect(result.current).toBe('connecting')
    act(() => FakeEventSource.instances[0].onopen?.())
    expect(result.current).toBe('open')
    expect(FakeEventSource.instances[0].url).toContain('workspaceId=ws_1')
  })

  it('reports reconnecting, polls meanwhile and refetches when it reopens', () => {
    const { result, invalidate } = setup()
    const stream = FakeEventSource.instances[0]
    act(() => stream.onopen?.())

    act(() => stream.onerror?.())
    expect(result.current).toBe('reconnecting')

    invalidate.mockClear()
    act(() => {
      vi.advanceTimersByTime(REALTIME_FALLBACK_POLL_MS)
    })
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['whatsapp-conversations', 'ws_1'],
    })

    invalidate.mockClear()
    act(() => stream.onopen?.())
    expect(result.current).toBe('open')
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['whatsapp-messages', 'ws_1'],
    })

    // Polling stopped once the stream is back.
    invalidate.mockClear()
    act(() => {
      vi.advanceTimersByTime(REALTIME_FALLBACK_POLL_MS * 2)
    })
    expect(invalidate).not.toHaveBeenCalled()
  })

  it('opens a new stream when the browser gave up on the old one', () => {
    setup()
    const stream = FakeEventSource.instances[0]
    stream.readyState = 2
    act(() => stream.onerror?.())
    expect(stream.close).toHaveBeenCalled()
    expect(FakeEventSource.instances).toHaveLength(1)

    act(() => {
      vi.advanceTimersByTime(REALTIME_RECONNECT_MS)
    })
    expect(FakeEventSource.instances).toHaveLength(2)
  })

  it('invalidates the message list on a message event and closes on unmount', () => {
    const { invalidate, unmount } = setup()
    const stream = FakeEventSource.instances[0]
    act(() =>
      stream.onmessage?.({
        data: JSON.stringify({
          type: 'message.created',
          conversationId: 'cv_1',
          message: {},
        }),
      }),
    )
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['whatsapp-messages', 'ws_1', 'cv_1'],
    })

    unmount()
    expect(stream.close).toHaveBeenCalled()
  })
})
