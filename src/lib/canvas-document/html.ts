import { Fragment, isValidElement, type ReactNode } from 'react'
import { cssProperty } from '@/src/lib/canvas-site/css-value'
import { escapeHtml } from '@/src/lib/canvas-site/sanitize'

/**
 * A minimal React element → HTML serializer for the static print render.
 * `react-dom/server` cannot be imported from modules the App Router may
 * load as Server Components or route handlers (Next refuses the import),
 * and the PDF worker needs the HTML synchronously. The print render only
 * uses host elements and hook-free function components, which is all this
 * handles: props become attributes the way React writes them, `style`
 * objects become CSS, text is escaped, `dangerouslySetInnerHTML` is raw.
 */

const VOID_ELEMENTS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'source',
  'track',
  'wbr',
])

const RAW_TEXT_ELEMENTS = new Set(['style', 'script'])

const ATTRIBUTE_NAMES: Record<string, string> = {
  className: 'class',
  htmlFor: 'for',
  httpEquiv: 'http-equiv',
  acceptCharset: 'accept-charset',
  readOnly: 'readonly',
  allowFullScreen: 'allowfullscreen',
  autoPlay: 'autoplay',
  playsInline: 'playsinline',
  tabIndex: 'tabindex',
  colSpan: 'colspan',
  rowSpan: 'rowspan',
  crossOrigin: 'crossorigin',
  referrerPolicy: 'referrerpolicy',
  defaultChecked: 'checked',
  defaultValue: 'value',
}

/** SVG presentation attributes React accepts in camelCase. */
const SVG_KEBAB = new Set([
  'strokeWidth',
  'strokeLinecap',
  'strokeLinejoin',
  'strokeMiterlimit',
  'strokeDasharray',
  'strokeDashoffset',
  'strokeOpacity',
  'fillOpacity',
  'fillRule',
  'clipRule',
  'clipPath',
  'stopColor',
  'stopOpacity',
  'textAnchor',
  'dominantBaseline',
])

const BOOLEAN_ATTRIBUTES = new Set([
  'checked',
  'disabled',
  'readonly',
  'required',
  'selected',
  'multiple',
  'open',
  'hidden',
  'allowfullscreen',
  'autoplay',
  'controls',
  'loop',
  'muted',
  'playsinline',
  'novalidate',
])

/** CSS properties React writes without `px` when given a number. */
const UNITLESS = new Set([
  'flex',
  'flexGrow',
  'flexShrink',
  'fontWeight',
  'lineHeight',
  'opacity',
  'order',
  'zIndex',
  'zoom',
  'gridRow',
  'gridColumn',
  'columnCount',
  'aspectRatio',
])

const SKIPPED_PROPS = new Set([
  'children',
  'dangerouslySetInnerHTML',
  'key',
  'ref',
  'suppressHydrationWarning',
  'suppressContentEditableWarning',
])

function escapeText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

export function styleToCss(style: Record<string, unknown>): string {
  const parts: string[] = []
  for (const [key, raw] of Object.entries(style)) {
    if (raw === undefined || raw === null || raw === false || raw === '') {
      continue
    }
    const value =
      typeof raw === 'number' && raw !== 0 && !UNITLESS.has(key)
        ? `${raw}px`
        : String(raw)
    parts.push(`${cssProperty(key)}:${value}`)
  }
  return parts.join(';')
}

function attributeName(key: string): string {
  if (Object.hasOwn(ATTRIBUTE_NAMES, key)) return ATTRIBUTE_NAMES[key]
  if (SVG_KEBAB.has(key)) return cssProperty(key)
  return key
}

function attributes(props: Record<string, unknown>): string {
  let out = ''
  for (const [key, value] of Object.entries(props)) {
    if (SKIPPED_PROPS.has(key) || /^on[A-Z]/.test(key)) continue
    if (value === undefined || value === null || value === false) continue
    if (typeof value === 'function' || typeof value === 'symbol') continue
    if (key === 'style') {
      if (typeof value === 'object') {
        const css = styleToCss(value as Record<string, unknown>)
        if (css) out += ` style="${escapeHtml(css)}"`
      }
      continue
    }
    const name = attributeName(key)
    if (value === true) {
      out += BOOLEAN_ATTRIBUTES.has(name) ? ` ${name}` : ` ${name}=""`
      continue
    }
    out += ` ${name}="${escapeHtml(String(value))}"`
  }
  return out
}

function isContextLike(type: unknown): boolean {
  if (typeof type !== 'object' || type === null) return false
  const tag = (type as { $$typeof?: symbol }).$$typeof
  return (
    tag === Symbol.for('react.context') ||
    tag === Symbol.for('react.provider') ||
    tag === Symbol.for('react.consumer')
  )
}

/** HTML of a React tree made of host elements and hook-free function
 * components. Context providers render their children. */
export function renderToHtml(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') {
    return ''
  }
  if (typeof node === 'string') return escapeText(node)
  if (typeof node === 'number' || typeof node === 'bigint') {
    return String(node)
  }
  if (Array.isArray(node)) return node.map(renderToHtml).join('')
  if (!isValidElement(node)) return ''
  const props = (node.props ?? {}) as Record<string, unknown>
  const type: unknown = node.type
  if (type === Fragment || isContextLike(type)) {
    return renderToHtml(props.children as ReactNode)
  }
  if (typeof type === 'function') {
    const render = type as (props: Record<string, unknown>) => ReactNode
    return renderToHtml(render(props))
  }
  if (typeof type !== 'string') return ''
  const open = `<${type}${attributes(props)}>`
  if (VOID_ELEMENTS.has(type)) return open
  const inner = props.dangerouslySetInnerHTML as { __html?: string } | undefined
  if (inner && typeof inner.__html === 'string') {
    return `${open}${inner.__html}</${type}>`
  }
  const children = props.children as ReactNode
  if (RAW_TEXT_ELEMENTS.has(type) && typeof children === 'string') {
    return `${open}${children}</${type}>`
  }
  return `${open}${renderToHtml(children)}</${type}>`
}
