import type { ComponentType, ReactNode } from 'react'
import type { ZodType } from 'zod'
import type {
  CanvasBreakpoint,
  CanvasFragment,
  CanvasNode,
  CanvasProps,
} from './types'

// ─── Inspector description ────────────────────────────────────────────────
// The right panel is generated from this description; a catalog never builds
// its own form. Controls live in app/_components/canvas/inspector/controls.

export type InspectorTab = 'content' | 'style' | 'advanced'

export type InspectorControl =
  | { kind: 'text'; placeholder?: string; maxLength?: number }
  | {
      kind: 'textarea'
      placeholder?: string
      maxLength?: number
      rows?: number
    }
  /** TipTap rich text with the catalog's allowed marks. */
  | {
      kind: 'richtext'
      marks?: Array<
        'bold' | 'italic' | 'underline' | 'strike' | 'link' | 'list' | 'heading'
      >
    }
  | { kind: 'number'; min?: number; max?: number; step?: number; unit?: string }
  | {
      kind: 'select'
      options: Array<{ value: string; label: string; icon?: string }>
    }
  /** Segmented buttons (alignment, direction…). */
  | {
      kind: 'segmented'
      options: Array<{ value: string; label: string; icon?: string }>
    }
  | { kind: 'toggle' }
  /** Color with theme tokens (`token:primary`) or a literal `#RRGGBB(AA)`. */
  | { kind: 'color'; allowTokens?: boolean; allowTransparent?: boolean }
  /** Box model: `{ top, right, bottom, left }` in px. */
  | { kind: 'spacing'; min?: number; max?: number }
  | { kind: 'typography' }
  | { kind: 'border' }
  | { kind: 'radius' }
  | { kind: 'shadow' }
  /** Color, gradient or image (+ position/size/repeat). */
  | { kind: 'background'; allowImage?: boolean; allowGradient?: boolean }
  /** Media library picker / upload. */
  | { kind: 'image'; accept?: string[] }
  /** URL, page, anchor, e-mail, phone, file. Catalogs restrict `targets`. */
  | {
      kind: 'link'
      targets?: Array<'url' | 'page' | 'anchor' | 'email' | 'phone' | 'file'>
    }
  /** Width/height with units (px, %, auto, fill). */
  | { kind: 'size'; units?: Array<'px' | '%' | 'auto' | 'fill' | 'vh'> }
  /** Per-breakpoint visibility. */
  | { kind: 'visibility' }
  /** Repeating items (list rows, gallery images, tabs…). `fields` describe one item. */
  | { kind: 'list'; itemLabel: string; fields: InspectorField[]; max?: number }
  /** Escape hatch: a catalog-provided control. */
  | { kind: 'custom'; component: ComponentType<CustomControlProps> }

export interface CustomControlProps {
  value: unknown
  onChange: (value: unknown) => void
  node: CanvasNode
  breakpoint: CanvasBreakpoint
}

export interface InspectorField {
  /** Dot path inside `props` (`style.padding`, `items`). */
  path: string
  label: string
  control: InspectorControl
  help?: string
  /** The value is `Responsive<T>`; the control edits the active breakpoint. */
  responsive?: boolean
  /** Show only when another prop matches. */
  showIf?: { path: string; equals: unknown } | ((props: CanvasProps) => boolean)
}

export interface InspectorSection {
  id: string
  label: string
  tab: InspectorTab
  fields: InspectorField[]
  /** Collapsed by default. */
  collapsed?: boolean
}

// ─── Component definition ─────────────────────────────────────────────────

export interface CanvasRenderProps<P extends CanvasProps = CanvasProps> {
  node: CanvasNode<P>
  /** Rendered children, in order (already wrapped by the editor when editing). */
  children?: ReactNode
  breakpoint: CanvasBreakpoint
  /** true inside the editor canvas, false for the final output. */
  editing: boolean
}

export interface CanvasComponentDefinition<
  P extends CanvasProps = CanvasProps,
> {
  /** `<catalog>.<name>` — e.g. `email.button`, `site.container`. */
  type: string
  /** pt-BR name in the palette and layers ("Botão"). */
  label: string
  /** Hugeicons name for the palette/layers (resolved by the catalog). */
  icon: string
  /** Palette group ("Básicos", "Layout", "Vendas"…). Omit to hide from the palette. */
  category?: string
  /** Search keywords in pt-BR. */
  keywords?: string[]
  propsSchema: ZodType<P>
  defaultProps: () => P
  /** Children this type accepts. `false` = leaf. A function receives the
   * child type. */
  accepts: false | string[] | ((childType: string) => boolean)
  /** Parents this type may live in (default: any that accepts it). */
  parents?: string[]
  maxChildren?: number
  minChildren?: number
  /** Cannot be deleted (e-mail footer). */
  required?: boolean
  /** Only one per document. */
  unique?: boolean
  /** Prop path edited in place on double-click (TipTap on the canvas). */
  inlineText?: { path: string; rich: boolean }
  inspector: InspectorSection[]
  /** Optional fragment inserted from the palette instead of a lone node
   * (e.g. "2 colunas" inserts a row with two columns). */
  template?: () => CanvasFragment
  render: (props: CanvasRenderProps<P>) => ReactNode
}

export interface CanvasCatalog {
  /** `email` | `site`. Matches `CanvasDocument.catalog`. */
  id: string
  /** Current document version this catalog writes. */
  version: number
  rootType: string
  components: Record<string, CanvasComponentDefinition>
  /** Palette group order. */
  categories: string[]
  breakpoints: readonly CanvasBreakpoint[]
  /** Wraps the rendered tree (e-mail <Html>, site <body> styles). */
  renderDocument: (props: {
    children: ReactNode
    rootProps: CanvasProps
    editing: boolean
  }) => ReactNode
}

/** Builds a catalog, checking at boot that every `accepts`/`parents`
 * reference points to a registered type (throws on a broken catalog — a
 * programming error, not a runtime condition). */
export function defineCatalog(catalog: CanvasCatalog): CanvasCatalog {
  for (const def of Object.values(catalog.components)) {
    const refs = [
      ...(Array.isArray(def.accepts) ? def.accepts : []),
      ...(def.parents ?? []),
    ]
    for (const ref of refs) {
      if (!catalog.components[ref]) {
        throw new Error(
          `Canvas catalog "${catalog.id}": ${def.type} references unknown type ${ref}`,
        )
      }
    }
  }
  if (!catalog.components[catalog.rootType]) {
    throw new Error(
      `Canvas catalog "${catalog.id}": root type ${catalog.rootType} is not registered`,
    )
  }
  return catalog
}
