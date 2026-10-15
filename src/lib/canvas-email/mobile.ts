import { getNode } from '@/src/lib/canvas/nodes'
import { isResponsive } from '@/src/lib/canvas/responsive'
import type { CanvasDocument, CanvasNode } from '@/src/lib/canvas/types'
import type { CanvasSpacing, CanvasTypography } from '@/src/lib/canvas/values'

/**
 * Mobile overrides of the e-mail output. The editor resolves responsive
 * props per breakpoint and renders them inline; the final HTML renders the
 * desktop (`base`) values inline and turns every `mobile` override into a
 * media-query rule on a per-node class (`ec-<id>` on the cell, `ec-<id>-t`
 * on the text element). Clients without media queries keep the desktop
 * layout, which still fits on a phone.
 */

export type MobileTarget = 'cell' | 'text'

type Rule = { target: MobileTarget; css: string }

/** CSS class safe from any node id (cuid2 ids already are). */
export function nodeClass(id: string, target: MobileTarget = 'cell'): string {
  const safe = id.replace(/[^a-zA-Z0-9_-]/g, '')
  return target === 'cell' ? `ec-${safe}` : `ec-${safe}-t`
}

function mobileValue<T>(value: unknown): T | undefined {
  return isResponsive(value as T) ? (value as { mobile?: T }).mobile : undefined
}

function spacingCss(value: CanvasSpacing): string {
  return `padding:${value.top}px ${value.right}px ${value.bottom}px ${value.left}px`
}

/** Font families come from user input: keep only what a CSS family list
 * can contain, so nothing escapes the declaration. */
function safeFontFamily(value: string): string {
  return value.replace(/[^a-zA-Z0-9 ,'"-]/g, '')
}

export function typographyCss(value: CanvasTypography): string {
  const parts: string[] = []
  if (value.fontFamily) {
    parts.push(`font-family:${safeFontFamily(value.fontFamily)}`)
  }
  if (value.fontSize !== undefined) parts.push(`font-size:${value.fontSize}px`)
  if (value.fontWeight !== undefined) {
    parts.push(`font-weight:${value.fontWeight}`)
  }
  if (value.lineHeight !== undefined) {
    parts.push(`line-height:${value.lineHeight}`)
  }
  if (value.letterSpacing !== undefined) {
    parts.push(`letter-spacing:${value.letterSpacing}px`)
  }
  if (value.textTransform) parts.push(`text-transform:${value.textTransform}`)
  if (value.italic !== undefined) {
    parts.push(`font-style:${value.italic ? 'italic' : 'normal'}`)
  }
  return parts.join(';')
}

/** Media-query rules a node needs (empty when it has no mobile override). */
export function mobileRules(node: CanvasNode): Rule[] {
  const props = node.props as Record<string, unknown>
  const rules: Rule[] = []
  const padding = mobileValue<CanvasSpacing>(props.padding)
  if (padding) rules.push({ target: 'cell', css: spacingCss(padding) })
  const align = mobileValue<string>(props.align)
  if (align) rules.push({ target: 'cell', css: `text-align:${align}` })
  const height = mobileValue<number>(props.height)
  if (height !== undefined) {
    rules.push({
      target: 'cell',
      css: `height:${height}px;line-height:${height}px`,
    })
  }
  const typography = mobileValue<CanvasTypography>(props.typography)
  const typographyRule = typography && typographyCss(typography)
  if (typographyRule) rules.push({ target: 'text', css: typographyRule })
  return rules
}

/** Class for `target` when the node has a mobile rule for it. */
export function mobileClass(
  node: CanvasNode,
  target: MobileTarget,
): string | undefined {
  return mobileRules(node).some((rule) => rule.target === target)
    ? nodeClass(node.id, target)
    : undefined
}

function important(css: string): string {
  return css
    .split(';')
    .map((declaration) => `${declaration} !important`)
    .join(';')
}

/** Static helper classes used by the components. */
const STATIC_RULES = [
  '.ec-stack{display:block !important;width:100% !important;max-width:100% !important;box-sizing:border-box !important}',
  '.ec-hide-m{display:none !important;max-height:0 !important;overflow:hidden !important;mso-hide:all !important}',
  '.ec-show-m{display:table !important;max-height:none !important;overflow:visible !important}',
  '.ec-img-full{width:100% !important;max-width:100% !important;height:auto !important}',
  '.ec-container{width:100% !important;border-radius:0 !important}',
]

/**
 * The `<style>` content of a document: static helpers plus one rule per
 * mobile override, inside a max-width media query. Hidden nodes are skipped.
 */
export function collectMobileCss(
  doc: CanvasDocument,
  breakpointWidth: number,
): string {
  const rules: string[] = [...STATIC_RULES]
  const stack = [doc.rootId]
  while (stack.length > 0) {
    const node = getNode(doc, stack.pop() as string)
    if (!node || node.meta?.hidden) continue
    for (const rule of mobileRules(node)) {
      rules.push(`.${nodeClass(node.id, rule.target)}{${important(rule.css)}}`)
    }
    for (const child of [...(node.children ?? [])].reverse()) stack.push(child)
  }
  return `@media only screen and (max-width:${breakpointWidth}px){${rules.join('')}}`
}
