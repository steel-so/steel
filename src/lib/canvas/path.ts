/**
 * Dot-path helpers over plain JSON-like props (`style.padding.top`,
 * `items.2.label`). Reads never throw; writes are immutable and copy only the
 * objects along the path, so untouched branches keep their identity.
 */

/** Keys that would reach `Object.prototype` — never valid in a prop path. */
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor'])

const INDEX = /^(0|[1-9]\d*)$/

type Container = Record<string, unknown> | unknown[]

function isContainer(value: unknown): value is Container {
  return typeof value === 'object' && value !== null
}

/** Splits a path; `null` when it is empty, has empty segments or a
 * prototype-polluting key. */
export function parsePath(path: string): string[] | null {
  if (path === '') return null
  const keys = path.split('.')
  for (const key of keys) {
    if (key === '' || FORBIDDEN_KEYS.has(key)) return null
  }
  return keys
}

/** Value at `path`, or `undefined` when any segment is missing. Only own
 * properties are followed. */
export function getIn(source: unknown, path: string): unknown {
  let current = source
  for (const key of path.split('.')) {
    if (!isContainer(current) || !Object.hasOwn(current, key)) return undefined
    current = (current as Record<string, unknown>)[key]
  }
  return current
}

/** Whether every segment of `path` exists as an own property. */
export function hasIn(source: unknown, path: string): boolean {
  let current = source
  for (const key of path.split('.')) {
    if (!isContainer(current) || !Object.hasOwn(current, key)) return false
    current = (current as Record<string, unknown>)[key]
  }
  return true
}

/**
 * Immutable set. Missing or non-object intermediates become plain objects.
 * `undefined` deletes the key (an array index is spliced out). Returns the
 * same reference when nothing changes. The path must be valid (`parsePath`).
 */
export function setIn<T>(source: T, path: string, value: unknown): T {
  if (value === undefined && !hasIn(source, path)) return source
  return setAt(source, path.split('.'), 0, value) as T
}

function setAt(
  current: unknown,
  keys: string[],
  depth: number,
  value: unknown,
): unknown {
  const key = keys[depth]
  const asArray = Array.isArray(current) && INDEX.test(key)
  const container: Container =
    isContainer(current) && (asArray || !Array.isArray(current)) ? current : {}
  const exists = Object.hasOwn(container, key)
  const previous = exists
    ? (container as Record<string, unknown>)[key]
    : undefined
  const next =
    depth === keys.length - 1 ? value : setAt(previous, keys, depth + 1, value)

  if (container === current && exists && Object.is(previous, next)) {
    return current
  }
  if (asArray) {
    const copy = (container as unknown[]).slice()
    if (next === undefined) copy.splice(Number(key), 1)
    else copy[Number(key)] = next
    return copy
  }
  const copy: Record<string, unknown> = { ...container }
  if (next === undefined) delete copy[key]
  else copy[key] = next
  return copy
}

/**
 * The `[path, value]` that restores what `setIn(source, path, …)` will
 * overwrite. It points at the shallowest place the write changes shape: the
 * first missing key (restored by deleting it), a non-object intermediate
 * (restored whole) or an array on the way (restored whole, since a splice
 * shifts its items). Used to build exact inverse `update` ops.
 */
export function restoreEntry(source: unknown, path: string): [string, unknown] {
  const keys = path.split('.')
  let current = source
  for (let i = 0; i < keys.length; i++) {
    if (Array.isArray(current) || !isContainer(current)) {
      return [keys.slice(0, i).join('.'), current]
    }
    if (!Object.hasOwn(current, keys[i])) {
      return [keys.slice(0, i + 1).join('.'), undefined]
    }
    current = (current as Record<string, unknown>)[keys[i]]
  }
  return [path, current]
}

/**
 * Structural equality of JSON-like values: same primitives (`Object.is`),
 * arrays of equal items in order, objects with equal own keys. A key holding
 * `undefined` counts as absent, like JSON. Values rebuilt from elsewhere
 * (a co-editor's change projected back) compare equal to the local ones.
 */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (!isContainer(a) || !isContainer(b)) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a)) {
    const other = b as unknown[]
    return (
      a.length === other.length &&
      a.every((item, i) => jsonEqual(item, other[i]))
    )
  }
  const left = a as Record<string, unknown>
  const right = b as Record<string, unknown>
  const keys = Object.keys(left).filter((key) => left[key] !== undefined)
  const count = Object.keys(right).filter((key) => right[key] !== undefined)
  return (
    keys.length === count.length &&
    keys.every(
      (key) => Object.hasOwn(right, key) && jsonEqual(left[key], right[key]),
    )
  )
}
