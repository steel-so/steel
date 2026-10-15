import { isResponsive, resolveResponsive } from '@/src/lib/canvas/responsive'
import type { CanvasBreakpoint } from '@/src/lib/canvas/types'

/** Props that hold per-breakpoint data but are not `Responsive<T>` values
 * (`visibility` is `{ base, tablet, mobile }` booleans). */
const NOT_RESPONSIVE = new Set(['visibility'])

/**
 * Props with every responsive value resolved for `breakpoint` (top-level
 * and nested inside plain objects; arrays are kept as they are). The style
 * functions of the catalog work on these.
 */
export function resolveProps<P extends Record<string, unknown>>(
  props: P,
  breakpoint: CanvasBreakpoint,
): P {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(props)) {
    out[key] = NOT_RESPONSIVE.has(key) ? value : resolveValue(value, breakpoint)
  }
  return out as P
}

function resolveValue(value: unknown, breakpoint: CanvasBreakpoint): unknown {
  if (isResponsive(value)) return resolveResponsive(value, breakpoint)
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return value
  }
  const out: Record<string, unknown> = {}
  for (const [key, inner] of Object.entries(value)) {
    out[key] = resolveValue(inner, breakpoint)
  }
  return out
}
