import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CHATBOT_AUTOSAVE_DELAY_MS,
  useChatbotAutosave,
} from '../use-chatbot-autosave'

type Props = Parameters<typeof useChatbotAutosave>[0]

function setup(overrides: Partial<Props> = {}) {
  const persist = vi.fn(async () => undefined)
  const props: Props = {
    enabled: true,
    dirty: true,
    invalid: false,
    busy: false,
    serialized: 'v1',
    persist,
    ...overrides,
  }
  const hook = renderHook((current: Props) => useChatbotAutosave(current), {
    initialProps: props,
  })
  return { persist, props, ...hook }
}

const tick = (ms: number) => act(async () => vi.advanceTimersByTimeAsync(ms))

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('useChatbotAutosave()', () => {
  it('saves a quiet moment after the last edit and reports it', async () => {
    const { persist, result } = setup()

    await tick(CHATBOT_AUTOSAVE_DELAY_MS - 1)
    expect(persist).not.toHaveBeenCalled()

    await tick(1)
    expect(persist).toHaveBeenCalledTimes(1)
    expect(result.current.state).toBe('idle')
    expect(result.current.autoSaved).toBe(true)
  })

  it('debounces: a new edit restarts the wait', async () => {
    const { persist, rerender, props } = setup()

    await tick(CHATBOT_AUTOSAVE_DELAY_MS - 500)
    rerender({ ...props, serialized: 'v2' })
    await tick(CHATBOT_AUTOSAVE_DELAY_MS - 500)
    expect(persist).not.toHaveBeenCalled()

    await tick(500)
    expect(persist).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['without permission', { enabled: false }],
    ['with nothing to save', { dirty: false }],
    ['for a draft the schema rejects', { invalid: true }],
    ['while another save is running', { busy: true }],
  ])('does nothing %s', async (_label, overrides) => {
    const { persist } = setup(overrides)
    await tick(CHATBOT_AUTOSAVE_DELAY_MS * 3)
    expect(persist).not.toHaveBeenCalled()
  })

  it('does not retry a failed draft until it changes, then tries again', async () => {
    const { persist, result, rerender, props } = setup()
    persist.mockRejectedValueOnce(new Error('down'))

    await tick(CHATBOT_AUTOSAVE_DELAY_MS)
    expect(result.current.state).toBe('failed')
    expect(result.current.autoSaved).toBe(false)

    await tick(CHATBOT_AUTOSAVE_DELAY_MS * 3)
    expect(persist).toHaveBeenCalledTimes(1)

    rerender({ ...props, serialized: 'v2' })
    await tick(CHATBOT_AUTOSAVE_DELAY_MS)
    expect(persist).toHaveBeenCalledTimes(2)
    expect(result.current.state).toBe('idle')
  })

  it('forgets the "saved" message on a new edit and after a manual save', async () => {
    const { result, rerender, props } = setup()
    await tick(CHATBOT_AUTOSAVE_DELAY_MS)
    expect(result.current.autoSaved).toBe(true)

    rerender({ ...props, dirty: false })
    expect(result.current.autoSaved).toBe(true)

    rerender({ ...props, dirty: true, serialized: 'v2' })
    expect(result.current.autoSaved).toBe(false)

    await tick(CHATBOT_AUTOSAVE_DELAY_MS)
    expect(result.current.autoSaved).toBe(true)
    act(() => result.current.reset())
    expect(result.current.autoSaved).toBe(false)
    expect(result.current.state).toBe('idle')
  })

  it('honours a custom delay', async () => {
    const { persist } = setup({ delayMs: 100 })
    await tick(100)
    expect(persist).toHaveBeenCalledTimes(1)
  })
})
