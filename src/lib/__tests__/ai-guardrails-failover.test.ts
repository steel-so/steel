import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AiTimeoutError,
  failoverReason,
  isFailoverError,
  selectFallbackModels,
  withTimeout,
} from '@/src/lib/ai/guardrails/failover'
import { AI_MODEL_CATALOG, type AiModelDefinition } from '@/src/lib/ai/models'

const catalog = AI_MODEL_CATALOG as readonly AiModelDefinition[]
const byKey = (key: string) =>
  catalog.find((m) => m.key === key) as AiModelDefinition

afterEach(() => {
  vi.useRealTimers()
})

describe('isFailoverError()', () => {
  it.each([
    [{ status: 429 }, true],
    [{ status: 500 }, true],
    [{ status: 529 }, true],
    [{ status: 401 }, true],
    [{ status: 404 }, true],
    [{ status: 400 }, false],
    [{ status: 422 }, false],
    [{ status: 413 }, false],
    [{ name: 'APIConnectionTimeoutError' }, true],
    [{ code: 'ECONNRESET' }, true],
    [new AiTimeoutError(10), true],
    [new Error('boom'), false],
    ['string', false],
    [null, false],
  ])('%o → %s', (error, expected) => {
    expect(isFailoverError(error)).toBe(expected)
  })
})

describe('failoverReason()', () => {
  it('should summarize without the error body', () => {
    expect(failoverReason({ status: 503, message: 'secret' })).toBe(
      'status_503',
    )
    expect(failoverReason(new AiTimeoutError(5))).toBe('timeout')
    expect(failoverReason({ code: 'ECONNRESET' })).toBe('econnreset')
    expect(failoverReason({ name: 'FetchError' })).toBe('FetchError')
    expect(failoverReason(42)).toBe('unknown')
    expect(failoverReason({})).toBe('unknown')
  })
})

describe('selectFallbackModels()', () => {
  it('should prefer the other provider and the tier of the class', () => {
    const fallbacks = selectFallbackModels(
      byKey('openai:gpt-4o-mini'),
      catalog,
      'CLASSIFICATION',
    )
    expect(fallbacks.map((m) => m.key)).toEqual([
      'anthropic:claude-haiku-4-5',
      'anthropic:claude-sonnet-5',
    ])
    expect(
      selectFallbackModels(byKey('anthropic:claude-sonnet-5'), catalog, 'AGENT')
        .map((m) => m.key)
        .at(0),
    ).toBe('openai:gpt-5')
  })

  it('should use the same provider when it is the only one enabled', () => {
    const openai = catalog.filter((m) => m.provider === 'openai')
    expect(
      selectFallbackModels(byKey('openai:gpt-5'), openai, 'ASSISTANT', 1).map(
        (m) => m.key,
      ),
    ).toEqual(['openai:gpt-4o-mini'])
    expect(
      selectFallbackModels(
        byKey('openai:gpt-5'),
        [byKey('openai:gpt-5')],
        'AGENT',
      ),
    ).toEqual([])
  })
})

describe('withTimeout()', () => {
  it('should resolve in time and reject with AiTimeoutError when late', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 50)).resolves.toBe('ok')
    vi.useFakeTimers()
    const late = withTimeout(new Promise(() => {}), 1_000)
    vi.advanceTimersByTime(1_000)
    await expect(late).rejects.toBeInstanceOf(AiTimeoutError)
  })
})
