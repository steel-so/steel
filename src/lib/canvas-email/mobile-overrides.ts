import {
  clearResponsive,
  isResponsive,
  setResponsive,
} from '@/src/lib/canvas/responsive'
import type { Responsive } from '@/src/lib/canvas/types'
import type {
  CanvasSpacing,
  CanvasTypography,
  CanvasVisibility,
} from '@/src/lib/canvas/values'

/**
 * Mobile-only overrides edited from the inspector's "Celular" section,
 * whatever breakpoint the canvas shows. They write the catalog's responsive
 * props (`{ base, mobile }`), which become media queries in the output
 * (`mobile.ts`), and the per-device visibility.
 */

/** Mobile value of a responsive prop (`undefined` when it inherits). */
export function mobileOverride<T>(raw: unknown): T | undefined {
  return isResponsive(raw as T) ? (raw as Responsive<T>).mobile : undefined
}

/** Desktop value of a responsive (or plain) prop. */
export function desktopValue<T>(raw: unknown): T {
  return isResponsive(raw as T) ? (raw as Responsive<T>).base : (raw as T)
}

/** Stored value after setting (or clearing, with `undefined`) the mobile
 * override; a cleared `{ base }` collapses back to the plain value. */
export function withMobileOverride<T>(
  raw: unknown,
  next: T | undefined,
): unknown {
  if (next !== undefined) return setResponsive(raw as T, 'mobile', next)
  const cleared = clearResponsive(raw as T, 'mobile')
  if (isResponsive(cleared) && Object.keys(cleared).length === 1) {
    return (cleared as Responsive<T>).base
  }
  return cleared
}

/** Mobile padding override. */
export function mobilePadding(raw: unknown): CanvasSpacing | undefined {
  return mobileOverride<CanvasSpacing>(raw)
}

/** Font size used on phones: the mobile override, else `undefined`. */
export function mobileFontSize(raw: unknown): number | undefined {
  return mobileOverride<CanvasTypography>(raw)?.fontSize
}

/** Typography after setting (or clearing) only the mobile font size; other
 * mobile typography overrides are kept. `raw` may be absent. */
export function withMobileFontSize(
  raw: unknown,
  size: number | undefined,
): unknown {
  const base = raw === undefined ? {} : desktopValue<CanvasTypography>(raw)
  const current = mobileOverride<CanvasTypography>(raw) ?? {}
  const { fontSize: _previous, ...rest } = current
  const next: CanvasTypography =
    size === undefined ? rest : { ...rest, fontSize: size }
  const stored = withMobileOverride<CanvasTypography>(
    raw === undefined ? base : raw,
    Object.keys(next).length > 0 ? next : undefined,
  )
  // An emptied typography goes away entirely.
  return isResponsive(stored as CanvasTypography) ||
    Object.keys(stored as object).length > 0
    ? stored
    : undefined
}

/** Visibility after toggling one device. At least one device stays on: a
 * block hidden everywhere would vanish from the e-mail. */
export function toggleDevice(
  visibility: CanvasVisibility,
  device: 'base' | 'mobile',
  shown: boolean,
): CanvasVisibility {
  const next = { ...visibility, [device]: shown }
  if (device === 'mobile') next.tablet = shown
  if (!next.base && !next.mobile) return visibility
  return next
}
