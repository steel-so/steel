import { NodeApiError, NodeOperationError } from 'n8n-workflow'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fail, makeContext, ok, page } from './helpers'

const createSteelClient = vi.fn((options: unknown) => ({ options }))
vi.mock('@steel-so/sdk', async (importActual) => ({
  ...(await importActual<typeof import('@steel-so/sdk')>()),
  createSteelClient: (options: unknown) => createSteelClient(options),
}))

const {
  collectPages,
  describeSteelError,
  getSteelClient,
  normalizeBaseUrl,
  splitList,
  unwrap,
} = await import('../nodes/shared/steel')

beforeEach(() => createSteelClient.mockClear())

describe('normalizeBaseUrl', () => {
  it('trims spaces and trailing slashes', () => {
    expect(normalizeBaseUrl(' https://a.com.br// ')).toBe('https://a.com.br')
    expect(normalizeBaseUrl(undefined)).toBe('')
  })
})

describe('getSteelClient', () => {
  it('builds the SDK client from the credential', async () => {
    const client = await getSteelClient(makeContext() as never)
    expect(client).toBeDefined()
    expect(createSteelClient).toHaveBeenCalledWith({
      baseUrl: 'https://steel.example.com.br',
      token: 'stl_pat_test',
      userAgent: 'n8n-nodes-steel',
    })
  })

  it('refuses an empty URL or token', async () => {
    const noUrl = makeContext()
    noUrl.getCredentials.mockResolvedValue({ baseUrl: ' ', token: 'x' })
    await expect(getSteelClient(noUrl as never)).rejects.toBeInstanceOf(
      NodeOperationError,
    )
    const noToken = makeContext()
    noToken.getCredentials.mockResolvedValue({
      baseUrl: 'https://a.b',
    } as never)
    await expect(getSteelClient(noToken as never)).rejects.toThrow(
      'API token is empty',
    )
    expect(createSteelClient).not.toHaveBeenCalled()
  })
})

describe('unwrap', () => {
  const ctx = makeContext() as never

  it('returns the data of a successful call', () => {
    expect(unwrap(ctx, ok({ id: 'a' }))).toEqual({ id: 'a' })
  })

  it('throws a NodeApiError with a hint for a known code', () => {
    try {
      unwrap(ctx, fail(403, 'FORBIDDEN', 'Sem escopo'), 2)
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(NodeApiError)
      const apiError = error as NodeApiError
      expect(apiError.message).toBe('Sem escopo')
      expect(apiError.description).toContain('api:write')
      expect(apiError.httpCode).toBe('403')
    }
  })

  it('falls back to the code when there is no message', () => {
    expect(() => unwrap(ctx, fail(500, 'HTTP_ERROR'))).toThrow('HTTP_ERROR')
  })
})

describe('describeSteelError', () => {
  it('joins the hint and the details', () => {
    expect(
      describeSteelError({
        status: 400,
        code: 'VALIDATION_ERROR',
        details: { field: 'url' },
      }),
    ).toContain('{"field":"url"}')
  })

  it('returns only the details for an unknown code', () => {
    expect(describeSteelError({ status: 400, code: 'X', details: [1] })).toBe(
      '[1]',
    )
  })

  it('returns undefined without hint or details', () => {
    expect(describeSteelError({ status: 400, code: 'X' })).toBeUndefined()
  })
})

describe('collectPages', () => {
  const ctx = makeContext() as never

  it('walks every page when returnAll is on', async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce(page([1, 2], 'c1'))
      .mockResolvedValueOnce(page([3], null))
    const items = await collectPages(ctx, fetchPage, {
      returnAll: true,
      limit: 0,
    })
    expect(items).toEqual([1, 2, 3])
    expect(fetchPage).toHaveBeenNthCalledWith(1, undefined, 100)
    expect(fetchPage).toHaveBeenNthCalledWith(2, 'c1', 100)
  })

  it('stops at the limit and asks for what still fits', async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce(page([1, 2, 3], 'c1'))
      .mockResolvedValueOnce(page([4, 5, 6], 'c2'))
    const items = await collectPages(ctx, fetchPage, {
      returnAll: false,
      limit: 5,
    })
    expect(items).toEqual([1, 2, 3, 4, 5])
    expect(fetchPage).toHaveBeenNthCalledWith(2, 'c1', 2)
    expect(fetchPage).toHaveBeenCalledTimes(2)
  })

  it('does not loop when the server repeats the cursor', async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce(page([1], 'same'))
      .mockResolvedValueOnce(page([2], 'same'))
    const items = await collectPages(ctx, fetchPage, {
      returnAll: true,
      limit: 0,
    })
    expect(items).toEqual([1, 2])
    expect(fetchPage).toHaveBeenCalledTimes(2)
  })

  it('propagates an API failure', async () => {
    const fetchPage = vi.fn().mockResolvedValue(fail(401, 'UNAUTHORIZED'))
    await expect(
      collectPages(ctx, fetchPage, { returnAll: true, limit: 0 }),
    ).rejects.toBeInstanceOf(NodeApiError)
  })
})

describe('splitList', () => {
  it('splits, trims and drops empty parts', () => {
    expect(splitList(' a, b ,,c ')).toEqual(['a', 'b', 'c'])
    expect(splitList(undefined)).toEqual([])
  })
})
