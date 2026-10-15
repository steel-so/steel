import {
  CANVAS_BREAKPOINTS,
  type CanvasBreakpoint,
  type Responsive,
} from './types'

const BREAKPOINT_KEYS = new Set<string>(CANVAS_BREAKPOINTS)

/** `{ base, tablet?, mobile? }` — an object with `base` and only breakpoint
 * keys. Anything else (including arrays and `null`) is a plain value. */
export function isResponsive<T>(
  value: T | Responsive<T>,
): value is Responsive<T> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }
  const keys = Object.keys(value)
  return keys.includes('base') && keys.every((key) => BREAKPOINT_KEYS.has(key))
}

/** Value for `breakpoint`, cascading base → tablet → mobile: a missing
 * override inherits from the nearest larger breakpoint. */
export function resolveResponsive<T>(
  value: T | Responsive<T>,
  breakpoint: CanvasBreakpoint,
): T {
  if (!isResponsive(value)) return value
  for (let i = CANVAS_BREAKPOINTS.indexOf(breakpoint); i > 0; i--) {
    const override = value[CANVAS_BREAKPOINTS[i]]
    if (override !== undefined) return override
  }
  return value.base
}

/** Whether `breakpoint` has its own value (always true for `base`). */
export function hasOverride<T>(
  value: T | Responsive<T>,
  breakpoint: CanvasBreakpoint,
): boolean {
  if (breakpoint === 'base') return true
  return isResponsive(value) && value[breakpoint] !== undefined
}

/** Sets the value for one breakpoint, promoting a plain value to
 * `{ base }` first. */
export function setResponsive<T>(
  value: T | Responsive<T>,
  breakpoint: CanvasBreakpoint,
  next: T,
): Responsive<T> {
  const current: Responsive<T> = isResponsive(value) ? value : { base: value }
  return { ...current, [breakpoint]: next }
}

/** Drops a breakpoint override ("Limpar sobrescrita"); `base` stays. */
export function clearResponsive<T>(
  value: T | Responsive<T>,
  breakpoint: Exclude<CanvasBreakpoint, 'base'>,
): T | Responsive<T> {
  if (!isResponsive(value) || value[breakpoint] === undefined) return value
  const { [breakpoint]: _removed, ...rest } = value
  return rest as Responsive<T>
}
