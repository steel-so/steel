import { describe, expect, it } from 'vitest'
import {
  getIn,
  hasIn,
  jsonEqual,
  parsePath,
  restoreEntry,
  setIn,
} from '@/src/lib/canvas/path'
import {
  clearResponsive,
  hasOverride,
  isResponsive,
  resolveResponsive,
  setResponsive,
} from '@/src/lib/canvas/responsive'

describe('parsePath', () => {
  it('splits a dotted path', () => {
    expect(parsePath('style.padding.top')).toEqual(['style', 'padding', 'top'])
  })

  it.each([
    '',
    'a..b',
    '.a',
    'a.',
    '__proto__.x',
    'a.constructor',
    'prototype',
  ])('rejects %j', (path) => {
    expect(parsePath(path)).toBeNull()
  })
})

describe('getIn / hasIn', () => {
  const source = { a: { b: [10, { c: 'x' }] }, n: null, u: undefined }

  it('reads nested objects and array indexes', () => {
    expect(getIn(source, 'a.b.1.c')).toBe('x')
    expect(getIn(source, 'a.b.0')).toBe(10)
    expect(hasIn(source, 'a.b.1.c')).toBe(true)
  })

  it('returns undefined for missing or non-object segments', () => {
    expect(getIn(source, 'a.z')).toBeUndefined()
    expect(getIn(source, 'n.x')).toBeUndefined()
    expect(getIn(source, 'a.b.0.c')).toBeUndefined()
    expect(hasIn(source, 'a.z')).toBe(false)
    expect(hasIn(source, 'n.x')).toBe(false)
  })

  it('only follows own properties', () => {
    expect(getIn({}, 'toString')).toBeUndefined()
    expect(hasIn({}, 'constructor')).toBe(false)
  })

  it('distinguishes an own undefined value from a missing key', () => {
    expect(hasIn(source, 'u')).toBe(true)
    expect(getIn(source, 'u')).toBeUndefined()
  })
})

describe('setIn', () => {
  it('sets nested values copying only the path', () => {
    const source = { style: { color: 'red', padding: { top: 1 } }, other: {} }
    const next = setIn(source, 'style.padding.top', 2)
    expect(next).toEqual({
      style: { color: 'red', padding: { top: 2 } },
      other: {},
    })
    expect(next.other).toBe(source.other)
    expect(source.style.padding.top).toBe(1)
  })

  it('creates missing intermediates as objects', () => {
    expect(setIn({}, 'a.b.c', 1)).toEqual({ a: { b: { c: 1 } } })
  })

  it('replaces a primitive intermediate with an object', () => {
    expect(setIn({ a: 5 }, 'a.b', 1)).toEqual({ a: { b: 1 } })
  })

  it('treats a non-index key on an array as an object key', () => {
    expect(setIn({ a: [1] }, 'a.x', 1)).toEqual({ a: { x: 1 } })
  })

  it('sets and splices array items', () => {
    const source = { items: ['a', 'b', 'c'] }
    expect(setIn(source, 'items.1', 'B')).toEqual({ items: ['a', 'B', 'c'] })
    expect(setIn(source, 'items.1', undefined)).toEqual({ items: ['a', 'c'] })
    expect(setIn(source, 'items.3', 'd')).toEqual({
      items: ['a', 'b', 'c', 'd'],
    })
  })

  it('deletes keys with undefined', () => {
    expect(setIn({ a: 1, b: 2 }, 'a', undefined)).toEqual({ b: 2 })
  })

  it('returns the same reference when nothing changes', () => {
    const source = { a: { b: 1 } }
    expect(setIn(source, 'a.b', 1)).toBe(source)
    expect(setIn(source, 'a.z', undefined)).toBe(source)
    expect(setIn(source, 'x.y', undefined)).toBe(source)
  })
})

describe('restoreEntry', () => {
  it('points at the leaf when the path exists', () => {
    expect(restoreEntry({ a: { b: 1 } }, 'a.b')).toEqual(['a.b', 1])
  })

  it('points at the first missing key', () => {
    expect(restoreEntry({ a: {} }, 'a.b.c')).toEqual(['a.b', undefined])
    expect(restoreEntry({}, 'a.b')).toEqual(['a', undefined])
  })

  it('restores a primitive intermediate whole', () => {
    expect(restoreEntry({ a: 5 }, 'a.b')).toEqual(['a', 5])
  })

  it('restores an array on the way whole', () => {
    const items = ['x', 'y']
    expect(restoreEntry({ items }, 'items.0')).toEqual(['items', items])
  })

  it('round-trips through setIn', () => {
    const cases: Array<[Record<string, unknown>, string, unknown]> = [
      [{ a: { b: 1 } }, 'a.b', 2],
      [{}, 'a.b.c', 3],
      [{ a: 5 }, 'a.b', 1],
      [{ items: ['x', 'y'] }, 'items.0', undefined],
      [{ items: ['x'] }, 'items.1', 'z'],
    ]
    for (const [source, path, value] of cases) {
      const [restorePath, restoreValue] = restoreEntry(source, path)
      const changed = setIn(source, path, value)
      expect(setIn(changed, restorePath, restoreValue)).toEqual(source)
    }
  })
})

describe('responsive values', () => {
  const value = { base: 16, mobile: 12 }

  it('recognizes responsive objects only', () => {
    expect(isResponsive(value)).toBe(true)
    expect(isResponsive<unknown>({ tablet: 1 })).toBe(false)
    expect(isResponsive<unknown>({ base: 1, other: 2 })).toBe(false)
    expect(isResponsive([1])).toBe(false)
    expect(isResponsive(null)).toBe(false)
    expect(isResponsive(3)).toBe(false)
  })

  it('cascades base → tablet → mobile', () => {
    expect(resolveResponsive(value, 'base')).toBe(16)
    expect(resolveResponsive(value, 'tablet')).toBe(16)
    expect(resolveResponsive(value, 'mobile')).toBe(12)
    const withTablet = { base: 16, tablet: 14 }
    expect(resolveResponsive(withTablet, 'mobile')).toBe(14)
    expect(resolveResponsive(withTablet, 'tablet')).toBe(14)
  })

  it('returns plain values as they are', () => {
    expect(resolveResponsive('left', 'mobile')).toBe('left')
  })

  it('reports overrides', () => {
    expect(hasOverride(value, 'base')).toBe(true)
    expect(hasOverride(value, 'mobile')).toBe(true)
    expect(hasOverride(value, 'tablet')).toBe(false)
    expect(hasOverride(16, 'mobile')).toBe(false)
  })

  it('sets a breakpoint, promoting plain values', () => {
    expect(setResponsive(16, 'mobile', 12)).toEqual({ base: 16, mobile: 12 })
    expect(setResponsive(value, 'base', 18)).toEqual({ base: 18, mobile: 12 })
  })

  it('clears an override', () => {
    expect(clearResponsive(value, 'mobile')).toEqual({ base: 16 })
    expect(clearResponsive(value, 'tablet')).toBe(value)
    expect(clearResponsive(16, 'mobile')).toBe(16)
  })
})

describe('jsonEqual', () => {
  it.each([
    [1, 1],
    [Number.NaN, Number.NaN],
    ['a', 'a'],
    [null, null],
    [
      [1, { a: 2 }],
      [1, { a: 2 }],
    ],
    [
      { a: 1, b: { c: [1] } },
      { b: { c: [1] }, a: 1 },
    ],
    [{ a: 1, u: undefined }, { a: 1 }],
  ])('%j equals %j', (a, b) => {
    expect(jsonEqual(a, b)).toBe(true)
  })

  it.each([
    [1, 2],
    [1, '1'],
    [null, {}],
    [{}, null],
    [[1], { 0: 1 }],
    [[1, 2], [1]],
    [
      [1, 2],
      [1, 3],
    ],
    [{ a: 1 }, { a: 1, b: 2 }],
    [{ a: 1, b: undefined }, { b: 1 }],
    [{ a: { b: 1 } }, { a: { b: 2 } }],
  ])('%j differs from %j', (a, b) => {
    expect(jsonEqual(a, b)).toBe(false)
  })
})
