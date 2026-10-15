import type { CSSProperties, ReactNode } from 'react'
import type { CanvasRenderProps } from '@/src/lib/canvas/registry'
import { resolveResponsive } from '@/src/lib/canvas/responsive'
import type { CanvasBreakpoint, CanvasNode } from '@/src/lib/canvas/types'
import {
  type CanvasSpacing,
  type CanvasTypography,
  type CanvasVisibility,
  spacingToCss,
  typographyToCss,
} from '@/src/lib/canvas/values'
import { tint } from '@/src/lib/crm-email-builder/brand'
import { mobileClass } from './mobile'
import type { EmailAlign, EmailLink } from './schemas'
import { EMAIL_PALETTE } from './theme'

/**
 * Building blocks shared by the e-mail components. Every block renders as a
 * React Email `Section` (a presentation table with the padding on its cell —
 * Outlook ignores padding on tables), so blocks stack safely in any client.
 */

export type Responsive<T> = T | { base: T; tablet?: T; mobile?: T }

/** Value of a responsive prop for this render: the active breakpoint in the
 * editor, the desktop value in the output (mobile goes to media queries). */
export function pick<T>(
  value: Responsive<T>,
  breakpoint: CanvasBreakpoint,
  editing: boolean,
): T {
  return resolveResponsive(value, editing ? breakpoint : 'base')
}

export function joinClasses(
  ...classes: Array<string | false | undefined>
): string | undefined {
  const joined = classes.filter(Boolean).join(' ')
  return joined || undefined
}

/** `href` of an e-mail link; empty values give `undefined`. */
export function emailHref(link: EmailLink | undefined): string | undefined {
  const value = link?.value.trim()
  if (!link || !value) return undefined
  if (link.type === 'email') {
    return value.startsWith('mailto:') ? value : `mailto:${value}`
  }
  if (link.type === 'phone') {
    return value.startsWith('tel:')
      ? value
      : `tel:${value.replace(/[^\d+]/g, '')}`
  }
  return value
}

export type BlockProps = {
  padding?: Responsive<CanvasSpacing>
  visibility: CanvasVisibility
}

type FrameProps = Pick<
  CanvasRenderProps,
  'attributes' | 'breakpoint' | 'editing'
> & {
  node: CanvasNode<BlockProps>
  align?: Responsive<EmailAlign>
  /** Extra styles on the table (background, border…). */
  style?: CSSProperties
  /** Extra styles on the cell (spacer height…). */
  cellStyle?: CSSProperties
  children: ReactNode
}

/**
 * Outer box of every block: padding (responsive), alignment and per-device
 * visibility. In the editor a block hidden on the current device is shown
 * faded so it can still be selected; the output drops or hides it.
 */
export function BlockFrame({
  node,
  attributes,
  breakpoint,
  editing,
  align,
  style,
  cellStyle,
  children,
}: FrameProps) {
  const { padding, visibility } = node.props
  if (!editing && !visibility.base && !visibility.mobile) return null
  const shownHere =
    breakpoint === 'mobile' ? visibility.mobile : visibility.base
  const desktopHidden = !editing && !visibility.base
  const textAlign = align ? pick(align, breakpoint, editing) : undefined
  return (
    <EmailTable
      attributes={attributes}
      className={
        editing
          ? undefined
          : joinClasses(
              !visibility.mobile && 'ec-hide-m',
              !visibility.base && 'ec-show-m',
            )
      }
      style={{
        ...style,
        ...(desktopHidden
          ? {
              display: 'none',
              maxHeight: 0,
              overflow: 'hidden',
              msoHide: 'all',
            }
          : {}),
        ...(editing && !shownHere ? { opacity: 0.35 } : {}),
      }}
      cellClassName={editing ? undefined : mobileClass(node, 'cell')}
      align={textAlign}
      cellStyle={{
        ...(padding
          ? { padding: spacingToCss(pick(padding, breakpoint, editing)) }
          : {}),
        ...(textAlign ? { textAlign } : {}),
        ...cellStyle,
      }}
    >
      {children}
    </EmailTable>
  )
}

/**
 * One-cell presentation table (React Email `Section` shape) with full
 * control of the cell: `align`/`valign` attributes and padding on the `td`,
 * which is what Outlook honors.
 */
export function EmailTable({
  attributes,
  className,
  style,
  cellClassName,
  cellStyle,
  align,
  valign,
  children,
}: {
  attributes?: CanvasRenderProps['attributes']
  className?: string
  style?: CSSProperties
  cellClassName?: string
  cellStyle?: CSSProperties
  align?: EmailAlign
  valign?: 'top' | 'middle' | 'bottom'
  children: ReactNode
}) {
  return (
    <table
      {...attributes}
      role='presentation'
      width='100%'
      cellPadding={0}
      cellSpacing={0}
      border={0}
      className={className}
      style={{ width: '100%', borderCollapse: 'separate', ...style }}
    >
      <tbody>
        <tr>
          <td
            className={cellClassName}
            align={align}
            valign={valign}
            style={cellStyle}
          >
            {children}
          </td>
        </tr>
      </tbody>
    </table>
  )
}

/** Inline typography of a responsive `typography` prop. */
export function typographyStyle(
  value: Responsive<CanvasTypography> | undefined,
  breakpoint: CanvasBreakpoint,
  editing: boolean,
): CSSProperties {
  if (!value) return {}
  return typographyToCss(pick(value, breakpoint, editing)) as CSSProperties
}

/** Hint shown only in the editor (empty column, missing image…). */
export function EditorHint({
  editing,
  label,
  minHeight = 48,
}: {
  editing: boolean
  label: string
  minHeight?: number
}) {
  if (!editing) return null
  return (
    <div
      style={{
        border: `1px dashed ${EMAIL_PALETTE.stroke}`,
        borderRadius: 8,
        backgroundColor: '#FAFAFA',
        color: EMAIL_PALETTE.fg3,
        fontSize: 13,
        lineHeight: '18px',
        textAlign: 'center',
        padding: '12px 16px',
        minHeight,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {label}
    </div>
  )
}

/** `hex` mixed with white (`ratio` 1 = the color); other formats as is. */
export function softColor(color: string | undefined, ratio: number) {
  if (!color) return undefined
  return /^#[0-9a-fA-F]{6}$/.test(color) ? tint(color, ratio) : color
}

/** Shared visibility default (shown on every device). */
export const SHOWN: CanvasVisibility = {
  base: true,
  tablet: true,
  mobile: true,
}
