import type { IconSvgElement } from '@hugeicons/react'
import type { ComponentType, ReactNode } from 'react'
import type { ZodType } from 'zod'
import type {
  CanvasBreakpoint,
  CanvasDocument,
  CanvasFragment,
  CanvasNode,
  CanvasNodeId,
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
      /** One-click URL values (e.g. the e-mail's `{{campaign_link}}`). */
      quickValues?: Array<{ label: string; value: string }>
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

/** Attributes the editor needs on a component's outermost DOM element
 * (`data-canvas-id`, used for hit-testing, outlines and drop lines). Empty in
 * the final output. */
export type CanvasNodeAttributes = { 'data-canvas-id'?: string }

export interface CanvasRenderProps<P extends CanvasProps = CanvasProps> {
  node: CanvasNode<P>
  /** Spread on the component's outermost element: `<td {...attributes}>`.
   * Without it the node cannot be selected or dropped into on the canvas. */
  attributes?: CanvasNodeAttributes
  /** Rendered children, in order (already wrapped by the editor when editing). */
  children?: ReactNode
  breakpoint: CanvasBreakpoint
  /** true inside the editor canvas, false for the final output. */
  editing: boolean
  /** Editor only, for definitions with `tracksSelection`: the child on the
   * path to the selected node (the slide, tab or panel to show), or the
   * last one that was. `undefined` in the final output. */
  activeChild?: CanvasNodeId | null
  /** The child nodes, in order, for definitions with `readsChildren` (tab
   * labels, accordion titles drawn by the parent). */
  childNodes?: CanvasNode[]
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
  /**
   * What the render reads from the document besides the node itself (a
   * column's sibling widths, the body font a block inherits). The editor
   * re-renders the node whenever one of these values changes (compared
   * entry by entry with `Object.is`); without it a memoized node only
   * redraws when its own object changes.
   */
  dependsOn?: (doc: CanvasDocument, node: CanvasNode<P>) => readonly unknown[]
  /** The canvas passes `activeChild` to `render` (carousels, tabs,
   * accordions and popups show the child being edited). */
  tracksSelection?: boolean
  /** The render receives `childNodes` (it re-renders when a direct child's
   * object changes, not on deeper edits). */
  readsChildren?: boolean
  /**
   * Free positioning ("posição livre"): while `enabled` for the node's
   * props at the active breakpoint, its children are placed by x/y instead
   * of the flow. The canvas lets the selected child be dragged with snapping
   * guides and writes the responsive numbers `<childPath>.x` and
   * `<childPath>.y` of the child's props for the active breakpoint.
   */
  freeLayout?: {
    childPath: string
    enabled: (props: P, breakpoint: CanvasBreakpoint) => boolean
  }
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
  /** Icons referenced by `icon` in the definitions (palette, layers, tabs).
   * Unknown names fall back to a generic block icon. */
  icons?: Record<string, IconSvgElement>
  /** Wraps the rendered tree (e-mail <Html>, site <body> styles). */
  renderDocument: (props: {
    children: ReactNode
    rootProps: CanvasProps
    editing: boolean
  }) => ReactNode
}

/** Types a definition with its own props (render receives `node.props` as
 * `P`) and widens it for the catalog's `components` map. */
export function defineComponent<P extends CanvasProps>(
  definition: CanvasComponentDefinition<P>,
): CanvasComponentDefinition {
  return definition as unknown as CanvasComponentDefinition
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
