import { getIn } from '@/src/lib/canvas/path'
import type {
  InspectorControl,
  InspectorField,
  InspectorSection,
  InspectorTab,
} from '@/src/lib/canvas/registry'
import {
  clearResponsive,
  hasOverride,
  isResponsive,
  resolveResponsive,
  setResponsive,
} from '@/src/lib/canvas/responsive'
import type { CanvasBreakpoint, CanvasProps } from '@/src/lib/canvas/types'

/** What a field shows at the active breakpoint. */
export interface FieldReading {
  /** Value the control edits (resolved for the breakpoint). */
  value: unknown
  /** Stored value at the path (plain or `Responsive`). */
  raw: unknown
  /** The active (non-base) breakpoint has its own value. */
  overridden: boolean
  /** The value is inherited from a larger breakpoint. */
  inherited: boolean
}

export function readField(
  props: CanvasProps,
  field: InspectorField,
  breakpoint: CanvasBreakpoint,
): FieldReading {
  const raw = getIn(props, field.path)
  if (!field.responsive) {
    return { value: raw, raw, overridden: false, inherited: false }
  }
  const overridden = breakpoint !== 'base' && hasOverride(raw, breakpoint)
  return {
    value: resolveResponsive(raw, breakpoint),
    raw,
    overridden,
    inherited: breakpoint !== 'base' && !overridden,
  }
}

/**
 * Value to store at the field's path after an edit. Non-responsive fields
 * store the value; responsive ones write the active breakpoint (a plain value
 * stays plain while only `base` is edited).
 */
export function writeField(
  raw: unknown,
  field: InspectorField,
  breakpoint: CanvasBreakpoint,
  next: unknown,
): unknown {
  if (!field.responsive) return next
  if (breakpoint === 'base' && !isResponsive(raw)) return next
  if (breakpoint === 'base') return { ...(raw as object), base: next }
  return setResponsive(raw, breakpoint, next)
}

/** Stored value after "Limpar sobrescrita" (collapses `{ base }` back to
 * a plain value). */
export function clearField(
  raw: unknown,
  breakpoint: Exclude<CanvasBreakpoint, 'base'>,
): unknown {
  const cleared = clearResponsive(raw, breakpoint)
  if (isResponsive(cleared) && Object.keys(cleared).length === 1) {
    return cleared.base
  }
  return cleared
}

export function isFieldVisible(
  props: CanvasProps,
  field: InspectorField,
): boolean {
  const rule = field.showIf
  if (!rule) return true
  if (typeof rule === 'function') return rule(props)
  return Object.is(getIn(props, rule.path), rule.equals)
}

export const TAB_LABELS: Record<InspectorTab, string> = {
  content: 'Conteúdo',
  style: 'Estilo',
  advanced: 'Avançado',
}

export const TAB_ORDER: InspectorTab[] = ['content', 'style', 'advanced']

/** Tabs that have at least one section, in the fixed order. */
export function tabsOf(sections: InspectorSection[]): InspectorTab[] {
  return TAB_ORDER.filter((tab) =>
    sections.some((section) => section.tab === tab),
  )
}

/** Starting value of a new list item field. */
export function emptyValue(control: InspectorControl): unknown {
  switch (control.kind) {
    case 'text':
    case 'textarea':
    case 'richtext':
      return ''
    case 'toggle':
      return false
    case 'image':
      return { src: '', alt: '' }
    case 'link':
      return { type: control.targets?.[0] ?? 'url', value: '' }
    case 'select':
    case 'segmented':
      return control.options[0]?.value
    case 'list':
      return []
    default:
      return undefined
  }
}

/** Short summary of a list item for its collapsed header. */
export function itemSummary(
  item: unknown,
  fields: InspectorField[],
  fallback: string,
): string {
  for (const field of fields) {
    const value = getIn(item, field.path)
    if (typeof value === 'string' && value.trim()) {
      return value
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    }
    const alt = getIn(value, 'alt')
    if (typeof alt === 'string' && alt.trim()) return alt.trim()
  }
  return fallback
}
