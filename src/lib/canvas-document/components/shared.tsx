import type { IconSvgElement } from '@hugeicons/react'
import type { CSSProperties, ReactNode } from 'react'
import type { CanvasDocument } from '@/src/lib/canvas/types'
import {
  backgroundToCss,
  type CanvasBackground,
  type CanvasColorToken,
  type CanvasLink,
  linkHref,
  resolveColor,
} from '@/src/lib/canvas/values'
import { IconSvg } from '@/src/lib/canvas-site/icons'
import {
  escapeHtml,
  safeHref,
  sanitizeRichText,
} from '@/src/lib/canvas-site/sanitize'
import {
  DEFAULT_DOCUMENT_SETTINGS,
  type DocumentFieldValuesDTO,
  type DocumentPricingSelectionDTO,
  type DocumentSettingsDTO,
} from '@/src/schemas/document.schema'
import { DOC_TRACK_ATTR } from '../constants'
import type {
  DocumentRenderContext,
  DocumentRenderMode,
  DocumentVariableValues,
} from '../context'
import { DEFAULT_DOCUMENT_TIME_ZONE } from '../format'
import {
  splitVariables,
  substituteVariables,
  variablesForMode,
} from '../variables'

/**
 * What every component of the `document` catalog reads besides its node:
 * the render mode, the settings, the merge-tag values already chosen for
 * the mode (samples in the editor), validity, payment flag and, in print,
 * the recipient's answers. `getDocument` gives the live document to the
 * few elements that read other nodes (table of contents, payment total,
 * section names).
 */
export interface DocCtx {
  mode: DocumentRenderMode
  settings: DocumentSettingsDTO
  values: DocumentVariableValues
  validUntil: string | null
  brand?: { name: string; logoUrl?: string | null }
  paymentEnabled: boolean
  timeZone: string
  fieldValues?: DocumentFieldValuesDTO
  selection?: DocumentPricingSelectionDTO
  acceptedByName?: string | null
  acceptedAt?: string | null
  getDocument: () => CanvasDocument | undefined
  /** Editor: `dependsOn` hands the live document over (see the catalog). */
  remember: (doc: CanvasDocument) => void
}

export function toDocCtx(
  input: Partial<DocumentRenderContext> | undefined,
  getDocument: () => CanvasDocument | undefined,
  remember: (doc: CanvasDocument) => void = () => {},
): DocCtx {
  const mode = input?.mode ?? 'editor'
  return {
    mode,
    settings: { ...DEFAULT_DOCUMENT_SETTINGS, ...input?.settings },
    values: variablesForMode(mode, input?.variables),
    validUntil: input?.validUntil ?? null,
    brand: input?.brand,
    paymentEnabled: input?.paymentEnabled === true,
    timeZone: input?.timeZone ?? DEFAULT_DOCUMENT_TIME_ZONE,
    fieldValues: input?.fieldValues,
    selection: input?.selection,
    acceptedByName: input?.acceptedByName,
    acceptedAt: input?.acceptedAt,
    getDocument,
    remember,
  }
}

/** A plain text with its merge tags resolved; the editor highlights each
 * sample so the author sees what is a variable. */
export function renderVars(text: string | undefined, ctx: DocCtx): ReactNode {
  if (!text) return null
  if (!text.includes('{{')) return text
  if (ctx.mode !== 'editor') return substituteVariables(text, ctx.values)
  const parts = splitVariables(text)
  return parts.map((part, index) => {
    if (part.kind === 'text') return part.text
    return (
      <span key={index} className='d-var' title={part.tag}>
        {ctx.values[part.key] ?? ''}
      </span>
    )
  })
}

/** A string with its merge tags resolved (attributes, links, labels). */
export function varsText(text: string | undefined, ctx: DocCtx): string {
  return text ? substituteVariables(text, ctx.values) : ''
}

/** Sanitized rich text with merge tags resolved (values escaped) and, on
 * the public link and in the PDF, links marked for the tracker. */
export function richHtml(html: string | undefined, ctx: DocCtx): string {
  if (!html) return ''
  const clean = sanitizeRichText(html)
  const editor = ctx.mode === 'editor'
  const format = (value: string, key: string) =>
    editor
      ? `<span class="d-var" title="{{${key}}}">${escapeHtml(value)}</span>`
      : escapeHtml(value)
  const resolved = substituteVariables(clean, ctx.values, format)
  return editor
    ? resolved
    : resolved.replace(/<a(?=[\s>])/g, `<a ${DOC_TRACK_ATTR}="link"`)
}

/** Tracker attribute (`link` | `video` | `attachment`) outside the editor. */
export function trackProps(
  ctx: DocCtx,
  kind: 'link' | 'video' | 'attachment',
): Record<string, string> {
  return ctx.mode === 'editor' ? {} : { [DOC_TRACK_ATTR]: kind }
}

/** Safe `href` of a link value (merge tags resolved), with the new-tab
 * attributes; empty when there is no usable URL. */
export function linkProps(
  link: CanvasLink | undefined,
  ctx: DocCtx,
): { href?: string; target?: '_blank'; rel?: string } {
  if (!link) return {}
  const value = varsText(link.value, ctx)
  const href = safeHref(linkHref({ ...link, value }))
  if (!href) return {}
  const external = link.newTab || /^https?:/i.test(href)
  return external
    ? { href, target: '_blank', rel: 'noopener noreferrer' }
    : { href }
}

export function colorCss(
  color: string | undefined,
  tokens?: readonly CanvasColorToken[],
): string | undefined {
  return resolveColor(color, tokens)
}

export function backgroundCss(
  background: CanvasBackground | undefined,
): CSSProperties {
  return backgroundToCss(background) as CSSProperties
}

const JUSTIFY: Record<string, CSSProperties['justifyContent']> = {
  left: 'flex-start',
  center: 'center',
  right: 'flex-end',
}

/** `justify-content` of a flex row for a text alignment. */
export function justifyFor(
  align: string | undefined,
): CSSProperties['justifyContent'] {
  return JUSTIFY[align ?? 'left'] ?? 'flex-start'
}

/** `align-self` of a block inside the flex column of its parent. */
export function alignSelfFor(
  align: string | undefined,
): CSSProperties['alignSelf'] {
  return JUSTIFY[align ?? 'left'] as CSSProperties['alignSelf']
}

export function Icon({
  icon,
  label,
}: {
  icon: IconSvgElement
  label?: string
}) {
  return <IconSvg icon={icon} label={label} />
}

/** Editor-only hint shown where an element has nothing to show yet. */
export function Placeholder({
  icon,
  title,
  hint,
  attributes,
}: {
  icon: IconSvgElement
  title: string
  hint?: string
  attributes?: Record<string, string | undefined>
}) {
  return (
    <div {...attributes} className='d-placeholder'>
      <IconSvg icon={icon} />
      <strong>{title}</strong>
      {hint ? <span>{hint}</span> : null}
    </div>
  )
}

/** Initials of a name for the avatar fallback ("Maria Souza" → "MS"). */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  const first = words[0].charAt(0)
  const last = words.length > 1 ? words[words.length - 1].charAt(0) : ''
  return `${first}${last}`.toUpperCase()
}
