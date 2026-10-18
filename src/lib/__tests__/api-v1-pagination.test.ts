import { describe, expect, it } from 'vitest'
import {
  decodeOffsetCursor,
  encodeOffsetCursor,
  paginateArray,
  V1_DEFAULT_LIMIT,
  V1PageQuerySchema,
} from '@/src/lib/api/v1-pagination'

describe('V1PageQuerySchema', () => {
  it('defaults to 25 items from the first page', () => {
    expect(V1PageQuerySchema.parse({})).toEqual({ limit: V1_DEFAULT_LIMIT })
    expect(V1PageQuerySchema.parse({ limit: '', cursor: '' })).toEqual({
      limit: 25,
    })
  })

  it('coerces the limit and keeps the cursor', () => {
    expect(V1PageQuerySchema.parse({ limit: '100', cursor: 'abc' })).toEqual({
      limit: 100,
      cursor: 'abc',
    })
  })

  it.each([['0'], ['101'], ['1.5'], ['x']])('rejects limit=%s', (limit) => {
    expect(V1PageQuerySchema.safeParse({ limit }).success).toBe(false)
  })
})

describe('offset cursor', () => {
  it('round-trips an offset as an opaque value', () => {
    const cursor = encodeOffsetCursor(50)
    expect(cursor).not.toContain('50')
    expect(decodeOffsetCursor(cursor)).toEqual({ ok: true, value: 50 })
  })

  it('starts at 0 without a cursor', () => {
    expect(decodeOffsetCursor(undefined)).toEqual({ ok: true, value: 0 })
  })

  it.each([
    ['garbage', 'not-a-cursor'],
    ['negative', Buffer.from('o:-1').toString('base64url')],
    ['not a number', Buffer.from('o:abc').toString('base64url')],
    ['another prefix', Buffer.from('x:10').toString('base64url')],
  ])('rejects a %s cursor with VALIDATION_ERROR', (_label, cursor) => {
    const result = decodeOffsetCursor(cursor)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('VALIDATION_ERROR')
      expect(result.error.message).toBe('Cursor inválido')
    }
  })
})

describe('paginateArray', () => {
  const items = Array.from({ length: 7 }, (_, i) => i)

  it('walks the list page by page until nextCursor is null', () => {
    const first = paginateArray(items, { limit: 3 })
    expect(first).toEqual({
      ok: true,
      value: { items: [0, 1, 2], nextCursor: encodeOffsetCursor(3) },
    })
    const second = paginateArray(items, {
      limit: 3,
      cursor: encodeOffsetCursor(3),
    })
    expect(second.ok && second.value.items).toEqual([3, 4, 5])
    const last = paginateArray(items, {
      limit: 3,
      cursor: encodeOffsetCursor(6),
    })
    expect(last).toEqual({ ok: true, value: { items: [6], nextCursor: null } })
  })

  it('returns an empty last page past the end and for an exact fit', () => {
    expect(
      paginateArray(items, { limit: 3, cursor: encodeOffsetCursor(9) }),
    ).toEqual({ ok: true, value: { items: [], nextCursor: null } })
    expect(paginateArray(items, { limit: 7 })).toEqual({
      ok: true,
      value: { items, nextCursor: null },
    })
  })

  it('propagates an invalid cursor', () => {
    const result = paginateArray(items, { limit: 3, cursor: 'bad' })
    expect(result.ok).toBe(false)
  })
})
